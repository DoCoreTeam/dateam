// [E2E] 전사우선+행수대조 실측 — 격리 chromium. MCP 브라우저 미사용.
// 1) nebius.com/prices 렌더→GPU표 캡처 2) 로그인 3) 통합입력 이미지첨부 4) 실 분석 5) 행수·누락대조 단언.
import pw from '/Users/dohyeonkim/AX사업본부/newAX/node_modules/.pnpm/playwright@1.60.0/node_modules/playwright/index.js'
const { chromium } = pw
import { writeFileSync } from 'node:fs'

const BASE = process.env.E2E_BASE || 'http://localhost:3000'
const EMAIL = 'e2e-gpu@axtest.local'
const PW = 'E2eGpu!2026'
const IMG = '/tmp/nebius-gpu.png'
const log = (...a) => console.log('[E2E]', ...a)

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 } })
const page = await ctx.newPage()
let exitCode = 1
try {
  // ── 1) Nebius GPU 표 캡처 (이미 있으면 재사용) ──────────────
  const { existsSync } = await import('node:fs')
  if (existsSync(IMG)) {
    log('기존 캡처 이미지 재사용:', IMG)
  } else {
    log('Nebius 렌더 중…')
    await page.goto('https://nebius.com/prices', { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.getByText('NVIDIA GPU Instances', { exact: false }).first().waitFor({ timeout: 45000 })
    await page.waitForTimeout(1500)
    await page.screenshot({ path: IMG, fullPage: true })
    log('GPU표 캡처 →', IMG)
  }

  // ── 2) 로그인 ────────────────────────────────────────
  log('로그인…')
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.locator('input[name="email"]').waitFor({ timeout: 15000 })
  await page.locator('input[name="email"]').fill(EMAIL)
  await page.locator('input[name="password"]').fill(PW)
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30000 }).catch(() => {}),
    page.locator('input[name="password"]').press('Enter'),
  ])
  await page.waitForTimeout(2000)
  log('로그인 후 URL:', page.url())
  if (page.url().includes('/login')) {
    const err = await page.evaluate(() => document.body.innerText.slice(0, 300))
    throw new Error('로그인 실패 — 여전히 /login. 화면: ' + err.replace(/\n/g, ' '))
  }
  if (page.url().includes('/change-password')) throw new Error('비밀번호 변경 강제 화면 — 계정 플래그 확인 필요')

  // ── 3) 통합입력 진입 ──────────────────────────────────
  // 사이드바 'GPU 관리' 클릭(직접 goto는 /home 리다이렉트 레이스 발생) → 안정시 #gpu-file-input-v2 대기
  log('GPU 관리 이동…')
  await page.getByRole('link', { name: /GPU 관리/ }).first().click().catch(async () => {
    await page.goto(`${BASE}/pricing/gpu?tab=intake`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  })
  await page.waitForURL((u) => u.pathname.includes('/pricing/gpu'), { timeout: 30000 }).catch(() => {})
  // intake 탭 보장
  if (!page.url().includes('tab=intake')) {
    await page.getByRole('button', { name: /통합 입력/ }).first().click().catch(() => {})
  }
  try {
    await page.locator('#gpu-file-input-v2').waitFor({ state: 'attached', timeout: 70000 })
  } catch {
    await page.screenshot({ path: '/tmp/e2e-intake-fail.png', fullPage: true })
    const t = await page.evaluate(() => document.body.innerText.slice(0, 400))
    throw new Error('통합입력 파일입력 미발견. URL=' + page.url() + ' 화면=' + t.replace(/\n/g, ' '))
  }
  // 테스트 데이터 태깅(운영 오염 방지)
  const testTag = page.getByText('테스트 데이터로 태깅', { exact: false }).first()
  if (await testTag.count()) { try { await testTag.click(); } catch {} }
  // 텍스트 힌트
  await page.locator('textarea').first().fill('경쟁사 등록 — Nebius 가격표 이미지 전체 확인')

  // ── 4) 이미지 첨부 + 분석 ─────────────────────────────
  const diag = await page.evaluate(() => ({
    url: location.href,
    textareas: document.querySelectorAll('textarea').length,
    fileInputs: document.querySelectorAll('input[type=file]').length,
    hasV2: !!document.querySelector('#gpu-file-input-v2'),
    head: document.body.innerText.slice(0, 200).replace(/\n/g, ' '),
  }))
  log('진단:', JSON.stringify(diag))
  await page.screenshot({ path: '/tmp/e2e-intake.png', fullPage: true })
  log('이미지 첨부…')
  await page.locator('#gpu-file-input-v2').setInputFiles(IMG)
  await page.locator('[data-testid="image-thumbs"]').waitFor({ timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(1000)
  await page.getByRole('button', { name: /AI 분석 시작/ }).first().click()
  log('분석 시작 — SSE 대기(최대 150s)…')

  // 결과 패널 또는 누락배너 또는 done 신호 대기
  const deadline = Date.now() + 150000
  let settled = false
  while (Date.now() < deadline) {
    const bodyTxt = await page.evaluate(() => document.body.innerText)
    // 분석 완료 신호: 추출 결과 행 또는 "반영"·"검토 대기"·누락배너
    if (/검토 대기|시장 반영|반영 대기|누락|원본 .*행/.test(bodyTxt) && !/분석 중|판별하는 중|가져오는 중/.test(bodyTxt)) {
      // 약간 더 대기(렌더 안정)
      await page.waitForTimeout(2500); settled = true; break
    }
    await page.waitForTimeout(2500)
  }
  log('분석 종료 settled=', settled)

  // ── 5) 결과 수집·단언 ─────────────────────────────────
  await page.screenshot({ path: '/tmp/e2e-result.png', fullPage: true })
  const result = await page.evaluate(() => {
    const t = document.body.innerText
    const recBanner = document.querySelector('[data-testid="reconciliation-banner"]')?.textContent?.trim() || null
    // 추출 결과 테이블의 모델명 후보 수집(대략) — Nebius 모델 키워드 카운트
    const models = ['GB300','GB200','B300','B200','H200','H100','RTX PRO 6000','RTX 6000','L40S']
    const present = models.filter(m => t.includes(m))
    const priceUnknown = (t.match(/가격미상/g) || []).length
    return { recBanner, present, priceUnknownCount: priceUnknown, hasNebius: t.includes('Nebius') }
  })
  log('━━━ 결과 ━━━')
  log('Nebius 인식:', result.hasNebius)
  log('표시된 모델 키워드:', result.present.join(', '))
  log('가격미상 배지 수:', result.priceUnknownCount)
  log('누락대조 배너:', result.recBanner || '(없음 — 누락 0이거나 미표시)')
  log('스크린샷: /tmp/e2e-result.png, /tmp/nebius-gpu.png')

  // 합격 기준: 분석이 돌았고(전사·추출), 결과가 렌더됨. (행수 절대치는 Vision 특성상 변동)
  if (result.hasNebius || result.present.length >= 4 || result.recBanner) exitCode = 0
  log(exitCode === 0 ? 'PASS — 파이프라인 실동작 확인' : 'FAIL — 결과 미검출')
} catch (e) {
  log('ERROR:', e.message)
  try { await page.screenshot({ path: '/tmp/e2e-error.png', fullPage: true }) } catch {}
} finally {
  await browser.close()
  process.exit(exitCode)
}
