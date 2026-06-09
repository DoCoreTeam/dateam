#!/usr/bin/env node
/**
 * gcube-price-check.mjs
 *
 * gcube.ai 가격표 파싱 → 우리 gpu_products 비교 → DB 기록
 *
 * 사용:
 *   node scripts/gcube-price-check.mjs           # DB 기록 포함 실행
 *   node scripts/gcube-price-check.mjs --dry-run  # 파싱/비교만, DB 미기록
 *
 * 필요 환경변수:
 *   NEXT_PUBLIC_SUPABASE_URL   (또는 SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * 실행 환경:
 *   Node.js 18+ (ESM), @playwright/test devDep 이용 → playwright 패키지 직접 사용
 *   로컬 또는 GitHub Actions 권장 (Vercel 서버리스 환경에서는 Chromium 바이너리 제약으로 실행 불가)
 */

import { chromium } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

// ============================================================================
// 설정
// ============================================================================

const DRY_RUN = process.argv.includes('--dry-run')
const GCUBE_URL = 'https://gcube.ai/ko/price'
/** 탭 클릭 후 행 렌더 대기 타임아웃(ms) */
const RENDER_TIMEOUT_MS = 15_000
/** 가격 구간 비교: 우리가 low ~ high 범위 안에 있으면 match */
const MATCH_TOLERANCE_PCT = 0   // 정확히 구간 내 = match

// ============================================================================
// 환경변수
// ============================================================================

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('[gcube-check] FATAL: 환경변수 누락 — NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요')
  process.exit(1)
}

// ============================================================================
// 타입 정의
// ============================================================================

/**
 * @typedef {{ label: string, model: string, gpuCount: number, lowKrw: number, highKrw: number }} GcubeRow
 * @typedef {{ id: string, model_name: string, gpu_count: number, strategic_price_krw: number | null }} OurProduct
 * @typedef {{ productId: string, gcubeRow: GcubeRow, ourProduct: OurProduct, status: string, ourPriceKrw: number | null }} CompareResult
 */

// ============================================================================
// 파싱 로직
// ============================================================================

/**
 * 가격 문자열 → 숫자 (콤마 제거)
 * "10,500" → 10500
 * @param {string} s
 * @returns {number}
 */
function parseKrw(s) {
  return Number(s.replace(/,/g, '').trim())
}

/**
 * gcube 모델명 정규화 — 공백 제거 소문자 비교용
 * "B200 NVL" → "b200nvl"
 * @param {string} s
 * @returns {string}
 */
function normalizeModel(s) {
  return s.toLowerCase().replace(/\s+/g, '').replace(/-/g, '')
}

/**
 * Playwright로 gcube 가격표 파싱
 * @returns {Promise<GcubeRow[]>}
 */
async function fetchGcubeRows() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()

  try {
    await page.goto(GCUBE_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 })

    // "가격표" 탭 클릭 — 텍스트로 찾기
    const priceTabSelector = 'button:has-text("가격표"), a:has-text("가격표"), [role="tab"]:has-text("가격표")'
    const priceTab = page.locator(priceTabSelector).first()

    const tabFound = await priceTab.count()
    if (tabFound === 0) {
      throw new Error('gcube 페이지에서 "가격표" 탭을 찾을 수 없습니다. 사이트 구조 변경 가능성.')
    }

    await priceTab.click()

    // 가격 행 렌더 대기 — "원/hr" 텍스트가 포함된 요소가 나타날 때까지
    await page.waitForSelector('*:has-text("원/hr")', { timeout: RENDER_TIMEOUT_MS })

    // 페이지 전체 텍스트에서 가격 행 파싱
    /** @type {GcubeRow[]} */
    const rows = await page.evaluate(() => {
      /**
       * 요소의 텍스트를 재귀로 수집 (줄바꿈 정리)
       * @param {Element} el
       * @returns {string}
       */
      function getText(el) {
        return el.innerText.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim()
      }

      const results = []
      // "원/hr" 또는 "원 ~ " 패턴을 포함하는 행 컨테이너를 찾는다
      // gcube 실측 구조: 각 상품 행이 tr 또는 div 기반
      const candidates = Array.from(document.querySelectorAll('tr, [class*="row"], [class*="item"], [class*="card"], [class*="product"]'))

      for (const el of candidates) {
        const text = getText(el)

        // 가격 패턴 확인: "숫자원 ~ 숫자원/hr" 포함 여부
        if (!/[\d,]+원\s*~\s*[\d,]+원\/hr/.test(text)) continue

        // 모델명 + gpu_count 추출
        // 패턴: (TIER\d|Best)? <모델명> x <장수>
        // gcube 렌더는 'TIER1B200'처럼 TIER 접두와 모델 사이 공백이 없을 수 있음 → \s* 허용.
        // 'Best' 추천카드는 대문자 X 사용 → [xX] 둘 다 허용.
        const modelMatch = text.match(/(?:TIER\d\s*|Best\s+)?([A-Za-z0-9]+(?:\s+[A-Za-z0-9]+)*?)\s+[xX]\s+(\d+)/)
        if (!modelMatch) continue

        const model = modelMatch[1].trim()
        const gpuCount = parseInt(modelMatch[2], 10)

        // 가격 추출: 저 ~ 고
        const priceMatch = text.match(/([\d,]+)원\s*~\s*([\d,]+)원\/hr/)
        if (!priceMatch) continue

        const lowKrw = Number(priceMatch[1].replace(/,/g, ''))
        const highKrw = Number(priceMatch[2].replace(/,/g, ''))

        // 견고성: 0/NaN, low>high(파싱오류), 비정상 상한(1억원/hr 초과) 차단
        if (isNaN(lowKrw) || isNaN(highKrw) || lowKrw <= 0 || highKrw <= 0) continue
        if (lowKrw > highKrw) continue
        if (highKrw > 100_000_000) continue

        // label은 DB 비대화 방지로 500자 상한(외부 사이트 응답 신뢰 안 함)
        results.push({ label: text.slice(0, 500), model, gpuCount, lowKrw, highKrw })
      }

      return results
    })

    return rows
  } finally {
    await browser.close()
  }
}

/**
 * 중복 dedupe: model(정규화)+gpuCount 기준 첫 번째 행만 유지
 * @param {GcubeRow[]} rows
 * @returns {GcubeRow[]}
 */
function dedupeRows(rows) {
  const seen = new Set()
  return rows.filter(row => {
    const key = `${normalizeModel(row.model)}:${row.gpuCount}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// ============================================================================
// 비교 로직
// ============================================================================

/**
 * @param {GcubeRow[]} gcubeRows
 * @param {OurProduct[]} ourProducts
 * @returns {CompareResult[]}
 */
function compareAll(gcubeRows, ourProducts) {
  const gcubeMap = new Map()
  for (const row of gcubeRows) {
    gcubeMap.set(`${normalizeModel(row.model)}:${row.gpuCount}`, row)
  }

  /** @type {CompareResult[]} */
  const results = []

  for (const p of ourProducts) {
    const key = `${normalizeModel(p.model_name)}:${p.gpu_count}`
    const gcubeRow = gcubeMap.get(key)

    if (!gcubeRow) {
      // gcube에 해당 모델 없음
      results.push({
        productId: p.id,
        gcubeRow: null,
        ourProduct: p,
        status: 'not_found',
        ourPriceKrw: p.strategic_price_krw,
      })
      continue
    }

    const ourPrice = p.strategic_price_krw

    let status
    if (ourPrice == null) {
      status = 'our_unset'
    } else if (ourPrice >= gcubeRow.lowKrw && ourPrice <= gcubeRow.highKrw) {
      status = 'match'
    } else {
      status = 'mismatch'
    }

    results.push({
      productId: p.id,
      gcubeRow,
      ourProduct: p,
      status,
      ourPriceKrw: ourPrice,
    })
  }

  // gcube에는 있지만 우리 DB에 없는 모델은 현재 무시 (not_found는 우리 DB 기준)

  return results
}

// ============================================================================
// DB 기록
// ============================================================================

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {CompareResult[]} results
 * @param {Date} checkedAt
 */
async function persistResults(supabase, results, checkedAt) {
  const isoCheckedAt = checkedAt.toISOString()

  // gcube_price_checks bulk insert (not_found 포함 모두 기록)
  const checksInsert = results
    .filter(r => r.gcubeRow !== null || r.status === 'not_found')
    .map(r => ({
      product_id: r.productId,
      checked_at: isoCheckedAt,
      gcube_label: r.gcubeRow?.label ?? null,
      gcube_model: r.gcubeRow?.model ?? r.ourProduct.model_name,
      gcube_gpu_count: r.gcubeRow?.gpuCount ?? r.ourProduct.gpu_count,
      gcube_low_krw: r.gcubeRow?.lowKrw ?? 0,
      gcube_high_krw: r.gcubeRow?.highKrw ?? 0,
      our_price_krw: r.ourPriceKrw,
      status: r.status,
      note: r.status === 'not_found' ? 'gcube 가격표에서 해당 모델 미발견' : null,
    }))

  if (checksInsert.length > 0) {
    const { error: insertErr } = await supabase
      .from('gcube_price_checks')
      .insert(checksInsert)

    if (insertErr) {
      throw new Error(`gcube_price_checks insert 실패: ${insertErr.message}`)
    }
  }

  // gpu_products 캐시 컬럼 update (product별로 최신 상태 반영)
  for (const r of results) {
    if (r.status === 'not_found' && r.gcubeRow === null) {
      // gcube에 없음 → 캐시 상태만 not_found로 업데이트
      const { error } = await supabase
        .from('gpu_products')
        .update({
          gcube_last_status: 'not_found',
          gcube_last_checked_at: isoCheckedAt,
          gcube_last_low_krw: null,
          gcube_last_high_krw: null,
        })
        .eq('id', r.productId)

      if (error) {
        console.error(`[gcube-check] gpu_products 캐시 업데이트 실패 (${r.productId}):`, error.message)
      }
      continue
    }

    const { error } = await supabase
      .from('gpu_products')
      .update({
        gcube_last_status: r.status,
        gcube_last_checked_at: isoCheckedAt,
        gcube_last_low_krw: r.gcubeRow?.lowKrw ?? null,
        gcube_last_high_krw: r.gcubeRow?.highKrw ?? null,
      })
      .eq('id', r.productId)

    if (error) {
      console.error(`[gcube-check] gpu_products 캐시 업데이트 실패 (${r.productId}):`, error.message)
    }
  }
}

// ============================================================================
// 메인
// ============================================================================

async function main() {
  console.log(`[gcube-check] 시작 ${DRY_RUN ? '(DRY-RUN 모드 — DB 미기록)' : ''}`)

  // ── 1. gcube 파싱 ──────────────────────────────────────────────────────────
  console.log('[gcube-check] gcube.ai 가격표 파싱 중...')
  let rawRows
  try {
    rawRows = await fetchGcubeRows()
  } catch (err) {
    console.error('[gcube-check] 파싱 실패:', err.message)
    process.exit(2)
  }

  const gcubeRows = dedupeRows(rawRows)
  console.log(`[gcube-check] gcube 파싱 완료 — ${gcubeRows.length}개 행 (원본 ${rawRows.length}개, 중복 제거 후 ${gcubeRows.length}개)`)

  if (gcubeRows.length === 0) {
    console.error('[gcube-check] 경고: gcube에서 유효한 가격 행을 0개 파싱했습니다. 사이트 구조 변경 가능성 확인 필요.')
    process.exit(2)
  }

  // ── 2. 우리 상품 조회 ──────────────────────────────────────────────────────
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: ourProducts, error: productErr } = await supabase
    .from('gpu_products')
    .select('id, model_name, gpu_count, strategic_price_krw')
    .is('deleted_at', null)

  if (productErr) {
    console.error('[gcube-check] gpu_products 조회 실패:', productErr.message)
    process.exit(2)
  }

  console.log(`[gcube-check] 우리 상품 ${ourProducts.length}개 조회 완료`)

  // ── 3. 비교 ────────────────────────────────────────────────────────────────
  const results = compareAll(gcubeRows, ourProducts)

  const summary = {
    total: results.length,
    match: results.filter(r => r.status === 'match').length,
    mismatch: results.filter(r => r.status === 'mismatch').length,
    not_found: results.filter(r => r.status === 'not_found').length,
    our_unset: results.filter(r => r.status === 'our_unset').length,
  }

  console.log('[gcube-check] 비교 결과:')
  console.log(`  총 ${summary.total}개: match=${summary.match}, mismatch=${summary.mismatch}, not_found=${summary.not_found}, our_unset=${summary.our_unset}`)

  // 상세 출력
  for (const r of results) {
    const gcubeInfo = r.gcubeRow
      ? `gcube=[${r.gcubeRow.lowKrw.toLocaleString()}~${r.gcubeRow.highKrw.toLocaleString()}원]`
      : 'gcube=없음'
    const ourInfo = r.ourPriceKrw != null ? `our=${r.ourPriceKrw.toLocaleString()}원` : 'our=미설정'
    console.log(`  [${r.status.padEnd(9)}] ${r.ourProduct.model_name} x${r.ourProduct.gpu_count}  ${gcubeInfo}  ${ourInfo}`)
  }

  // ── 4. DB 기록 (dry-run이면 스킵) ─────────────────────────────────────────
  if (DRY_RUN) {
    console.log('[gcube-check] DRY-RUN 완료 — DB 기록 없음')
    return
  }

  console.log('[gcube-check] DB 기록 중...')
  const checkedAt = new Date()

  try {
    await persistResults(supabase, results, checkedAt)
  } catch (err) {
    console.error('[gcube-check] DB 기록 실패:', err.message)
    process.exit(2)
  }

  console.log(`[gcube-check] 완료 — ${checkedAt.toISOString()}`)
}

main().catch(err => {
  console.error('[gcube-check] 예기치 못한 오류:', err)
  process.exit(2)
})
