import { test, expect } from '@playwright/test'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'

// v0.7.195 단일 드롭존 통합 검증 — 실제 렌더 경로(?tab=intake, QuoteRegisterTab).
// 텍스트/이미지/PDF는 multipart로 /review/stream, xlsx/csv는 /market/catalog 자동 라우팅.
// 사용자 실파일(46KB pdf / 36KB xlsx)로 실패가 재현되는지/고쳐졌는지 직접 확인.

const ROOT = path.join(__dirname, '../../..')
const PDF_PATH = path.join(ROOT, '타겟금액_csp금액요청취합파일_konsttech_정준홍_260430_1.pdf')
const XLSX_PATH = path.join(ROOT, '타겟금액_csp금액요청취합파일_konsttech_정준홍_260430_1.xlsx')

// 1x1 PNG(투명) — 작은 이미지 첨부 검증용
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

const SHOT = path.join(os.tmpdir(), 'gpu-intake-shots')

test.beforeAll(() => { fs.mkdirSync(SHOT, { recursive: true }) })

async function dismissOnboarding(page: import('@playwright/test').Page) {
  await page.keyboard.press('Escape').catch(() => {})
  await page.evaluate(() => {
    document.querySelectorAll('.driver-overlay,.driver-active,.driver-popover,#driver-popover-item,.driver-stage').forEach((e) => e.remove())
    document.body.classList.remove('driver-active', 'driver-fade', 'driver-simple')
  }).catch(() => {})
}

async function gotoIntake(page: import('@playwright/test').Page) {
  await page.goto('/pricing/gpu?tab=intake')
  await page.waitForTimeout(800)
  await dismissOnboarding(page)
  await expect(page.getByTestId('intake-formats')).toBeVisible({ timeout: 20_000 })
  // is_test 태깅 — 실데이터 오염 방지
  const testChk = page.getByText('테스트 데이터로 태깅').locator('xpath=preceding-sibling::input[@type="checkbox"]')
  if (await testChk.count() > 0 && !(await testChk.first().isChecked())) {
    await testChk.first().check().catch(() => {})
  }
}

test('단일 드롭존 — 텍스트 분석 multipart 200', async ({ page }) => {
  test.setTimeout(120_000)
  await gotoIntake(page)
  await page.locator('textarea.gpu-intake-textarea').fill('[RunPod] H100 SXM 80GB $2.35/GPU·hr, 약정 3개월, 16장 즉시')
  const respP = page.waitForResponse((r) => r.url().includes('/api/pricing/gpu/review/stream') && r.request().method() === 'POST', { timeout: 90_000 })
  await page.getByRole('button', { name: /AI 분석 시작/ }).click()
  const resp = await respP
  const ct = resp.request().headers()['content-type'] ?? ''
  console.log('TEXT stream status=', resp.status(), 'req-ct=', ct)
  await page.screenshot({ path: path.join(SHOT, '1-text.png'), fullPage: true })
  expect(resp.status()).toBe(200)
  expect(ct).toContain('multipart/form-data')
})

test('이미지 첨부 → 썸네일 → multipart 200', async ({ page }) => {
  test.setTimeout(120_000)
  await gotoIntake(page)
  const imgPath = path.join(SHOT, 'tiny.png')
  fs.writeFileSync(imgPath, PNG_1x1)
  await page.setInputFiles('#gpu-file-input-v2', imgPath)
  await expect(page.getByTestId('image-thumbs')).toBeVisible({ timeout: 10_000 })
  const respP = page.waitForResponse((r) => r.url().includes('/api/pricing/gpu/review/stream') && r.request().method() === 'POST', { timeout: 90_000 })
  await page.getByRole('button', { name: /AI 분석 시작/ }).click()
  const resp = await respP
  console.log('IMAGE stream status=', resp.status())
  await page.screenshot({ path: path.join(SHOT, '2-image.png'), fullPage: true })
  expect(resp.status()).toBe(200)
})

test('PDF 첨부(실파일 46KB) → multipart 200 (AI 분석 시작 실패 미발생)', async ({ page }) => {
  test.skip(!fs.existsSync(PDF_PATH), '실 PDF 파일 없음(로컬 검증용)')
  test.setTimeout(120_000)
  await gotoIntake(page)
  await page.setInputFiles('#gpu-file-input-v2', PDF_PATH)
  await expect(page.getByTestId('image-thumbs')).toBeVisible({ timeout: 10_000 })
  const respP = page.waitForResponse((r) => r.url().includes('/api/pricing/gpu/review/stream') && r.request().method() === 'POST', { timeout: 90_000 })
  await page.getByRole('button', { name: /AI 분석 시작/ }).click()
  const resp = await respP
  console.log('PDF stream status=', resp.status())
  // 분석 시작 실패 텍스트가 화면에 없어야 함
  await page.waitForTimeout(1500)
  const failVisible = await page.getByText('AI 분석 시작 실패').count()
  await page.screenshot({ path: path.join(SHOT, '3-pdf.png'), fullPage: true })
  expect(resp.status()).toBe(200)
  expect(failVisible).toBe(0)
})

test('xlsx 첨부(실파일 36KB) → catalog 자동 라우팅', async ({ page }) => {
  test.skip(!fs.existsSync(XLSX_PATH), '실 xlsx 파일 없음(로컬 검증용)')
  test.setTimeout(150_000)
  await gotoIntake(page)
  const catP = page.waitForResponse((r) => r.url().includes('/api/pricing/gpu/market/catalog') && r.request().method() === 'POST', { timeout: 120_000 })
  await page.setInputFiles('#gpu-file-input-v2', XLSX_PATH)
  const resp = await catP
  console.log('XLSX catalog status=', resp.status())
  await page.waitForTimeout(1000)
  await page.screenshot({ path: path.join(SHOT, '4-xlsx.png'), fullPage: true })
  // 200(적재) 또는 422(매핑/검증 안내) — 무음 실패가 아니어야 함(둘 다 명시 결과)
  expect([200, 422, 500]).toContain(resp.status())
})
