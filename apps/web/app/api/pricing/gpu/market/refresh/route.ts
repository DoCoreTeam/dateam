import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { saveCompetitorPrices, type CompetitorPriceItem } from '@/lib/gpu/competitor-import'
import { getGeminiConfig, fetchUrlText, loadSpecContext } from '@/lib/gpu/extract-helpers'
import { extractCompetitorObservations } from '@/lib/gpu/extract-pipeline'
import type { FxKrwMap } from '@/lib/gpu/normalize-money'
import { kstTodayKey } from '@/lib/datetime/kst'

// P4 통합(v0.7.372) — 자동 수집(하루 1회) 경로를 review/stream(사용자 수동 입력)과 동일 SSOT로 통일한다.
//   과거 이 라우트는 독자 CLASSIFY_PROMPT로 AI에게 직접 분류·추출을 맡겼다(AI 구조화 관측·완전성 게이트·
//   결정론 합집합 보완 없음) — 같은 데이터가 어느 문으로 들어오냐에 따라 다르게 처리되는 버그 공급원이었다.
//   지금은 review/stream이 쓰는 lib/gpu/extract-pipeline.ts(extractCompetitorObservations)를 그대로 호출한다.
//   SSOT: 시간계수=lib/gpu/hours.ts, 통화환산=lib/gpu/normalize-money.ts, 세그먼트판정=lib/gpu/observation-classify.ts,
//   AI 관측 검증+산술=lib/gpu/observation-contract.ts, 완전성 게이트=lib/gpu/completeness-reconcile.ts.

// POST /api/pricing/gpu/market/refresh
// DB에 저장된 URL들을 AI로 분석해서 market_prices 업데이트
export async function POST(req: Request) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error

  // 자동 수집 모드(?auto=1) — 그날 첫 접속자가 1회만 구동. run_date(KST) 멱등키로 하루 1회·경합방지. (헌법 제10조)
  const isAuto = new URL(req.url).searchParams.get('auto') === '1'
  const runDate = kstTodayKey()  // KST 기준 '오늘'

  const adminClient = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = adminClient as any

  if (isAuto) {
    // 오늘 실행 기록을 선점(INSERT). 기본키 충돌=이미 누군가 오늘 돌림 → 조용히 스킵.
    const { error: claimErr } = await db.from('market_refresh_runs')
      .insert({ run_date: runDate, status: 'running', trigger_source: 'first-visit' })
    if (claimErr) {
      // 23505=unique_violation → 이미 오늘 돌았음(정상 스킵). 그 외(DB 장애 등)는 원인을 서버 로그로 남긴다(가시성).
      if (claimErr.code && claimErr.code !== '23505') console.error('[gpu/market/refresh] auto claim 실패:', claimErr)
      return NextResponse.json({ skipped: true, reason: claimErr.code === '23505' ? 'already_ran_today' : 'claim_failed', run_date: runDate })
    }
  }

  // Gemini 설정(SSOT — review/stream과 동일 org_content META 조회 재사용, 복사본 금지)
  const { apiKey, model } = await getGeminiConfig(adminClient)

  if (!apiKey) {
    if (isAuto) await db.from('market_refresh_runs').update({ status: 'error', finished_at: new Date().toISOString(), error: 'AI 키가 설정되지 않았습니다' }).eq('run_date', runDate)
    return NextResponse.json({ error: 'AI 키가 설정되지 않았습니다' }, { status: 500 })
  }

  // 활성 매핑 + 경쟁사 URL 조회
  const { data: mappings, error: mapErr } = await db
    .from('competitor_product_mapping')
    .select(`
      id, competitor_url,
      competitors!competitor_id(id, name, pricing_url)
    `)
    .eq('is_active', true)

  if (mapErr) {
    if (isAuto) await db.from('market_refresh_runs').update({ status: 'error', finished_at: new Date().toISOString(), error: '매핑 조회 실패' }).eq('run_date', runDate)
    return NextResponse.json({ error: mapErr.message }, { status: 500 })
  }

  // URL 수집: competitor_url 우선, 없으면 pricing_url
  const urlSet = new Map<string, string>() // url → competitor name
  for (const m of (mappings ?? [])) {
    const compUrl = m.competitor_url as string | null
    const pricingUrl = m.competitors?.pricing_url as string | null
    const compName = m.competitors?.name as string ?? 'unknown'
    const url = compUrl || pricingUrl
    if (url && !urlSet.has(url)) {
      urlSet.set(url, compName)
    }
  }

  if (urlSet.size === 0) {
    if (isAuto) await db.from('market_refresh_runs').update({ status: 'done', finished_at: new Date().toISOString(), urls_checked: 0, prices_updated: 0 }).eq('run_date', runDate)
    return NextResponse.json({
      message: '분석할 URL이 없습니다. 경쟁사에 pricing_url을 등록하거나 매핑에 competitor_url을 추가하세요.',
      urls_checked: 0,
      prices_updated: 0,
    })
  }

  const results: {
    url: string; competitor: string; prices_found: number
    held?: number; rejected?: number; fx_unresolved?: number; components_saved?: number
    completeness_uncovered?: number; ai_rejected?: number; error?: string
  }[] = []
  let totalPricesUpdated = 0

  // 다통화 환율맵(fx_rates_multi SSOT) — 통화환산은 100% 코드가 한다(amountToKrw). AI 자체환산 폐기.
  //   KRW=그대로, USD=fx_rates.usd_krw(폴백 1400), 그 외는 fx_rates_multi(krw_per_1)에 있을 때만 지원.
  const { data: fxRow } = await db.from('fx_rates').select('usd_krw').order('rate_date', { ascending: false }).limit(1).maybeSingle()
  const krwPerUsd = typeof fxRow?.usd_krw === 'number' && fxRow.usd_krw > 0 ? fxRow.usd_krw : 1400
  const { data: fxMultiRows } = await db.from('fx_rates_multi')
    .select('currency, krw_per_1, rate_date').order('rate_date', { ascending: false }).limit(60)
  const fxMap: FxKrwMap = { KRW: 1, USD: krwPerUsd }
  let fxRateDate: string | null = null
  for (const r of (fxMultiRows ?? []) as Array<{ currency: string; krw_per_1: number; rate_date: string }>) {
    if (fxRateDate === null) fxRateDate = r.rate_date
    if (r.rate_date === fxRateDate && fxMap[r.currency] === undefined) fxMap[r.currency] = r.krw_per_1
  }

  // 보유 스펙 카탈로그 + 카탈로그 모델명 목록(SSOT — review/stream과 동일 로직) — AI 관측의 catalog_match 검증용.
  const specContext = await loadSpecContext(adminClient)
  const { data: catRows } = await db.from('gpu_products').select('model_name').is('deleted_at', null).limit(500)
  const catalogModelNames = Array.from(new Set(((catRows ?? []) as Array<{ model_name: string | null }>)
    .map((c) => (c.model_name ?? '').trim()).filter(Boolean)))

  for (const [url, compName] of Array.from(urlSet.entries())) {
    try {
      // 본문 수집 SSOT(review/stream과 동일) — 표 구조 보존 파서 + JS렌더 사이트 헤드리스 폴백.
      //   구 로컬 구현(15k 절단·word-soup)은 폐기.
      const { text: pageText } = await fetchUrlText(url)
      if (!pageText) {
        console.error('[gpu/market/refresh] 페이지 로드 실패:', url)
        results.push({ url, competitor: compName, prices_found: 0, error: '페이지 로드 실패' })
        continue
      }

      // 추출 SSOT(P4 통합) — review/stream과 동일한 AI 구조화 관측+검증+완전성 게이트. 자동 수집 경로엔
      //   전사 기반 결정론 후보가 없으므로 deterministicItems는 미주입(합집합 보완 없음, AI 단독 소스).
      const pipeline = await extractCompetitorObservations({
        apiKey, model, sourceText: pageText, specContext, catalogNames: catalogModelNames,
        provider: compName, sourceUrl: url, krwPerUsd, fxMap, fxDate: fxRateDate,
      })

      if (pipeline.items.length === 0) {
        results.push({
          url, competitor: compName, prices_found: 0,
          ...(pipeline.aiRejected.length ? { ai_rejected: pipeline.aiRejected.length } : {}),
        })
        continue
      }

      const built = pipeline.items as unknown as CompetitorPriceItem[]
      // 무음 소실 금지 — 원본 금액은 있는데 통화 미지원(fx_rates_multi에 없는 통화)이라 price_usd가
      //   null로 보류된 건수를 saveCompetitorPrices 진입 전에 여기서 집계해 노출한다.
      //   (saveCompetitorPrices는 price_usd falsy면 held/rejected 집계 없이 조용히 continue하므로 여기서 세지 않으면 무음 드롭이 된다)
      const fxUnresolved = built.filter((it) => it.price_usd == null && it.obs?.amount != null).length
      const componentsSaved = built.reduce((sum, it) => sum + (it.components?.length ?? 0), 0)

      // H1 게이트(validateCompetitorItem)는 saveCompetitorPrices 내부에서 강제 — 자동 크롤 경로도 GPU 아님·이상가 차단.
      const { saved, held, rejected } = await saveCompetitorPrices(db, built, { sourceUrl: url, confidence: 80 })
      results.push({
        url, competitor: compName, prices_found: saved.length,
        ...(held.length ? { held: held.length } : {}),
        ...(rejected.length ? { rejected: rejected.length } : {}),
        ...(fxUnresolved ? { fx_unresolved: fxUnresolved } : {}),
        ...(componentsSaved ? { components_saved: componentsSaved } : {}),
        ...(!pipeline.completeness.complete ? { completeness_uncovered: pipeline.completeness.uncovered.length } : {}),
        ...(pipeline.aiRejected.length ? { ai_rejected: pipeline.aiRejected.length } : {}),
      })
      totalPricesUpdated += saved.length
    } catch (err) {
      console.error('[gpu/market/refresh] url fetch/parse 실패:', url, err)  // 상세는 서버 로그만
      results.push({ url, competitor: compName, prices_found: 0, error: err instanceof Error ? err.message : '수집 실패' })
    }
  }

  // 무음 실패 방지(fire-and-forget 경로라 실패가 화면에 안 뜬다) — 실패·보류 요약을 run 기록+서버 로그에 남긴다.
  const failedUrls = results.filter((r) => !!r.error)
  const heldTotal = results.reduce((s, r) => s + (r.held ?? 0), 0)
  const rejectedTotal = results.reduce((s, r) => s + (r.rejected ?? 0), 0)
  const fxUnresolvedTotal = results.reduce((s, r) => s + (r.fx_unresolved ?? 0), 0)
  const completenessUncoveredTotal = results.reduce((s, r) => s + (r.completeness_uncovered ?? 0), 0)
  const aiRejectedTotal = results.reduce((s, r) => s + (r.ai_rejected ?? 0), 0)
  const hasIssues = failedUrls.length > 0 || heldTotal > 0 || rejectedTotal > 0 || fxUnresolvedTotal > 0
    || completenessUncoveredTotal > 0 || aiRejectedTotal > 0
  const issueSummary = hasIssues
    ? JSON.stringify({
        failed_urls: failedUrls.map((r) => ({ url: r.url, error: r.error })),
        held: heldTotal, rejected: rejectedTotal, fx_unresolved: fxUnresolvedTotal,
        completeness_uncovered: completenessUncoveredTotal, ai_rejected: aiRejectedTotal,
      })
    : null
  if (issueSummary) console.error('[gpu/market/refresh] 부분 실패/보류 요약:', issueSummary)
  // 전체 URL이 전부 실패(저장 0건 + 전 URL 오류)면 상태를 error로 — 그 외(일부만 실패/보류)는 done 유지하되 error 필드에 요약 기록.
  const allFailed = urlSet.size > 0 && totalPricesUpdated === 0 && failedUrls.length === urlSet.size

  if (isAuto) {
    await db.from('market_refresh_runs').update({
      status: allFailed ? 'error' : 'done',
      finished_at: new Date().toISOString(),
      urls_checked: urlSet.size,
      prices_updated: totalPricesUpdated,
      ...(issueSummary ? { error: issueSummary } : {}),
    }).eq('run_date', runDate)
  }

  return NextResponse.json({
    urls_checked: urlSet.size,
    prices_updated: totalPricesUpdated,
    results,
  })
}
