import { test, expect } from '@playwright/test'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'

// 끝단 검증 — AI 분석 결과가 우측 패널에 실제 렌더되고, 공급가는 검토대기까지 적재되는지.
// (200 응답이 아니라 사용자가 보는 결과 화면을 단언). 전부 is_test 태깅.

const ROOT = path.join(__dirname, '../../..')
const PDF_PATH = path.join(ROOT, '타겟금액_csp금액요청취합파일_konsttech_정준홍_260430_1.pdf')
const SHOT = path.join(os.tmpdir(), 'gpu-intake-shots')
test.beforeAll(() => { fs.mkdirSync(SHOT, { recursive: true }) })

async function gotoIntake(page: import('@playwright/test').Page) {
  await page.goto('/pricing/gpu?tab=intake')
  await expect(page.getByTestId('intake-formats')).toBeVisible({ timeout: 20_000 })
  const testChk = page.locator('label:has-text("테스트 데이터로 태깅") input[type="checkbox"]')
  await expect(testChk).toBeVisible({ timeout: 10_000 })
  if (!(await testChk.isChecked())) await testChk.check()
  await expect(testChk).toBeChecked()
}

// 분석 후 결과 패널이 채워졌는지(미리보기/탭/결과/에러) — '분석 중' 무한정체가 아님을 단언.
async function waitResult(page: import('@playwright/test').Page) {
  const result = page.locator(
    '[data-testid="supplier-preview"], [data-testid="competitor-preview"], [data-testid="multi-model-tabs"], .gpu-error-msg, [data-testid="analyze-live-log"]',
  )
  await expect(result.first()).toBeVisible({ timeout: 90_000 })
}

test('견적 텍스트 → 결과 렌더 → 영속화(검토대기 적재/시장 반영)', async ({ page }) => {
  test.setTimeout(180_000)
  await gotoIntake(page)
  // 비클라우드 공급사명으로 supplier 분류 유도(실패해도 competitor 경로로 영속화 검증)
  await page.locator('textarea.gpu-intake-textarea').fill('코어엣지 주식회사 견적서 — H100 SXM 80GB, 시간당 단가 2.10 USD, 최소약정 3개월, 재고 32장 보유')
  await page.getByRole('button', { name: /AI 분석 시작/ }).click()
  // 분류 무관 — 미리보기(공급가 또는 경쟁가)가 반드시 떠야 함
  const anyPreview = page.locator('[data-testid="supplier-preview"], [data-testid="competitor-preview"]')
  await expect(anyPreview.first()).toBeVisible({ timeout: 150_000 })
  await page.screenshot({ path: path.join(SHOT, 'r1-preview.png'), fullPage: true })

  // 영속화 — 공급가면 확정→검토대기, 경쟁가면 시장비교 반영. 둘 중 실제 떠있는 경로로 성공 메시지 단언.
  const commitBtn = page.getByTestId('supplier-commit-btn')
  if (await commitBtn.isVisible().catch(() => false)) {
    await commitBtn.click()
    await expect(page.getByText(/검토 대기 탭에 추가|검토 대기에 추가/).first()).toBeVisible({ timeout: 30_000 })
  } else {
    const reflectBtn = page.getByRole('button', { name: /시장비교에 반영/ })
    await reflectBtn.click()
    await expect(page.getByText(/시장 비교에 반영|반영되었습니다/)).toBeVisible({ timeout: 30_000 })
  }
  await page.screenshot({ path: path.join(SHOT, 'r1-persisted.png'), fullPage: true })
})

test('경쟁가 텍스트 → 경쟁사 미리보기 렌더', async ({ page }) => {
  test.setTimeout(150_000)
  await gotoIntake(page)
  await page.locator('textarea.gpu-intake-textarea').fill('RunPod H100 80GB $2.35/GPU-hr, Lambda A100 80GB $1.10/GPU-hr 시세 참고')
  await page.getByRole('button', { name: /AI 분석 시작/ }).click()
  await waitResult(page)
  // 경쟁사 미리보기 또는 결과가 떠야(에러로 끝나지 않아야)
  const ok = page.locator('[data-testid="competitor-preview"], [data-testid="supplier-preview"], [data-testid="multi-model-tabs"]')
  await expect(ok.first()).toBeVisible({ timeout: 120_000 })
  await page.screenshot({ path: path.join(SHOT, 'r2-competitor.png'), fullPage: true })
})

test('PDF(실파일) → 결과 렌더(분석 시작 실패/무한정체 없음)', async ({ page }) => {
  test.skip(!fs.existsSync(PDF_PATH), '실 PDF 없음')
  test.setTimeout(150_000)
  await gotoIntake(page)
  await page.setInputFiles('#gpu-file-input-v2', PDF_PATH)
  await expect(page.getByTestId('image-thumbs')).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: /AI 분석 시작/ }).click()
  await waitResult(page)
  await page.waitForTimeout(2000)
  expect(await page.getByText('AI 분석 시작 실패').count()).toBe(0)
  // 결과 또는 명시적 안내 중 하나는 반드시 — 분석버튼이 '분석 중'에서 풀렸는지로 종료 확인
  await expect(page.getByRole('button', { name: /AI 분석 시작/ })).toBeEnabled({ timeout: 120_000 })
  await page.screenshot({ path: path.join(SHOT, 'r3-pdf-result.png'), fullPage: true })
})
