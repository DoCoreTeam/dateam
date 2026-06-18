import { test, expect } from '@playwright/test'
import * as path from 'path'; import * as os from 'os'; import * as fs from 'fs'
const SHOT = path.join(os.tmpdir(), 'changelog-shots'); test.beforeAll(()=>fs.mkdirSync(SHOT,{recursive:true}))

test('AI 정제 버튼 — 커밋 원문(claude/Playwright)을 기능단위로 정제', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/admin/changelog')
  await expect(page.getByRole('heading', { name: '업데이트 내역' })).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: /^추가$/ }).click()
  const dlg = page.getByRole('dialog', { name: '업데이트 항목 편집' })
  await expect(dlg).toBeVisible()
  await dlg.locator('input.input-field').first().fill('0.0.0-refine')
  const ta = dlg.locator('textarea.input-field')
  await ta.fill('GPU 통합입력 단일 드롭존 통합 + multipart 전송 claude\n통합입력 끝단 E2E 추가 Playwright 검증\nE2E 테스트 격리 픽스 claude')
  const before = await ta.inputValue()
  const refineResp = page.waitForResponse((r) => r.url().includes('/api/admin/changelog/refine') && r.request().method() === 'POST', { timeout: 60_000 })
  await dlg.getByRole('button', { name: /AI 정제/ }).click()
  const resp = await refineResp
  console.log('REFINE status=', resp.status())
  await page.waitForTimeout(1500)
  const after = await ta.inputValue()
  await page.screenshot({ path: path.join(SHOT, 'refine.png'), fullPage: true })
  expect(resp.status()).toBe(200)
  expect(after).not.toBe(before)             // 정제로 내용 변경됨
  expect(after.toLowerCase()).not.toContain('claude')      // 내부 표현 제거
  expect(after).not.toContain('Playwright')                // 내부 표현 제거
})
