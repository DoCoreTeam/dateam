import { test, expect } from '@playwright/test'
const SRC = 'cbceef6f-6465-4712-a307-d316fb922abe'
const DEPT = '026cf8db-c4a6-40c0-ac01-f29821a13dc7'
test('일일→부서 승격(참조, 멱등)', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/daily'); await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })
  const r = await page.evaluate(async ({ SRC, DEPT }) => {
    const p1 = await fetch('/api/work/promote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceLogId: SRC, departmentId: DEPT }) })
    const b1 = await p1.json().catch(() => ({}))
    const p2 = await fetch('/api/work/promote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceLogId: SRC, departmentId: DEPT }) })
    const b2 = await p2.json().catch(() => ({}))
    return { ok1: p1.ok, id: b1.id, ok2: p2.ok, err2: b2.error }
  }, { SRC, DEPT })
  console.log('[promote]', JSON.stringify(r))
  expect(r.ok1).toBeTruthy()           // 1차 승격 성공
  expect(r.id).toBeTruthy()
  expect(r.ok2).toBeFalsy()            // 2차=멱등 차단(이미 승격됨)
})
