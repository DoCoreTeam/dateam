import { test, expect } from '@playwright/test'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'

// v0.7.197 체인지로그 — 어드민 가져오기/추가/게시 + 버전 클릭 모달 끝단 검증.
// 테스트 전용 버전 0.0.0-e2e 로 추가→게시→모달표시→삭제(정리). git 가져오기 초안은 비공개라 유지.
const SHOT = path.join(os.tmpdir(), 'changelog-shots')
const TEST_VER = '0.0.0-e2e'
test.beforeAll(() => { fs.mkdirSync(SHOT, { recursive: true }) })

test('어드민: git에서 가져오기 → 목록 채워짐', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/admin/changelog')
  await expect(page.getByRole('heading', { name: '업데이트 내역' })).toBeVisible({ timeout: 20_000 })
  const importResp = page.waitForResponse((r) => r.url().includes('/api/admin/changelog/import') && r.request().method() === 'POST', { timeout: 60_000 })
  await page.getByRole('button', { name: /git에서 가져오기/ }).click()
  const resp = await importResp
  console.log('IMPORT status=', resp.status())
  await expect(page.locator('table.table-card tbody tr').first()).toBeVisible({ timeout: 20_000 })
  await page.screenshot({ path: path.join(SHOT, 'admin-imported.png'), fullPage: true })
  expect(resp.status()).toBe(200)
})

test('어드민: 추가 → 게시 → 버전 클릭 모달 표시 → 삭제', async ({ page }) => {
  test.setTimeout(120_000)
  // 사전 정리(멱등) — 이전 실패 런 잔여 TEST_VER 제거
  const pre = await (await page.request.get(`/api/admin/changelog?q=${encodeURIComponent(TEST_VER)}`)).json().catch(() => ({}))
  for (const it of (pre.items ?? [])) { if (it.version === TEST_VER) await page.request.delete(`/api/admin/changelog/${it.id}`) }

  await page.goto('/admin/changelog')
  await expect(page.getByRole('heading', { name: '업데이트 내역' })).toBeVisible({ timeout: 20_000 })

  // 추가(게시 체크) — 테스트 버전. 모달 다이얼로그로 스코프 한정(툴바 입력과 충돌 방지).
  await page.getByRole('button', { name: /^추가$/ }).click()
  const dlg = page.getByRole('dialog', { name: '업데이트 항목 편집' })
  await expect(dlg).toBeVisible({ timeout: 10_000 })
  await dlg.locator('input.input-field').first().fill(TEST_VER)
  await dlg.locator('textarea.input-field').fill('E2E 검증용 변경항목')
  await dlg.getByRole('checkbox').check() // 게시
  const createResp = page.waitForResponse((r) => r.url().endsWith('/api/admin/changelog') && r.request().method() === 'POST')
  await dlg.getByRole('button', { name: /^저장$/ }).click()
  expect((await createResp).status()).toBe(201)

  // 검색으로 확인
  await page.locator('input.input-field[placeholder*="검색"]').fill(TEST_VER)
  await page.getByRole('button', { name: /^검색$/ }).click()
  await expect(page.getByText(`v${TEST_VER}`)).toBeVisible({ timeout: 10_000 })
  await page.screenshot({ path: path.join(SHOT, 'admin-added.png'), fullPage: true })

  // 버전 클릭 → 모달에 게시된 테스트 버전 표시
  await page.locator('.app-version-btn').first().click()
  const modal = page.getByRole('dialog', { name: '업데이트 내역' })
  await expect(modal).toBeVisible({ timeout: 10_000 })
  await expect(modal.getByText(`v${TEST_VER}`)).toBeVisible({ timeout: 10_000 })
  await page.screenshot({ path: path.join(SHOT, 'public-modal.png'), fullPage: true })
  await page.keyboard.press('Escape')

  // 정리 — 테스트 행 삭제
  page.on('dialog', (d) => d.accept())
  await page.locator('input.input-field[placeholder*="검색"]').fill(TEST_VER)
  await page.getByRole('button', { name: /^검색$/ }).click()
  await expect(page.getByText(`v${TEST_VER}`)).toBeVisible({ timeout: 10_000 })
  const delResp = page.waitForResponse((r) => r.url().includes('/api/admin/changelog/') && r.request().method() === 'DELETE')
  await page.locator('table.table-card tbody tr', { hasText: TEST_VER }).getByTitle('삭제').click()
  expect((await delResp).status()).toBe(200)
})
