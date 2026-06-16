import { test, expect } from '@playwright/test'

// A 검증: 일일 화면은 개인 업무만(부서업무 역류 제거), 주간보고 인용(default week)은 부서업무 포함(회귀 안전).
test('일일=개인만 / 주간보고 인용=부서 포함', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/daily')
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })

  const r = await page.evaluate(async () => {
    const j = async (u: string) => (await fetch(u).then((x) => x.json()).catch(() => []))
    const logs = await j('/api/daily/logs?date=2026-06-15')               // 일일 day뷰
    const weekPersonal = await j('/api/daily/week?start=2026-06-15&personal=1') // 일일 week뷰
    const weekDefault = await j('/api/daily/week?start=2026-06-15')        // 주간보고/캘린더 인용
    const cnt = (arr: any) => Array.isArray(arr) ? arr.filter((x) => x.task_kind === 'dept_task').length : -1
    return {
      logsDept: cnt(logs), logsTotal: Array.isArray(logs) ? logs.length : -1,
      weekPersonalDept: cnt(weekPersonal),
      weekDefaultDept: cnt(weekDefault),
    }
  })
  console.log('[A]', JSON.stringify(r))
  // 일일 day뷰·week뷰(personal): 부서업무 0건
  expect(r.logsDept).toBe(0)
  expect(r.weekPersonalDept).toBe(0)
  // 일일은 개인 업무는 있어야(공백 아님)
  expect(r.logsTotal).toBeGreaterThan(0)
  // 주간보고 인용(default): 부서업무 포함(회귀 안전) — 06-15에 dept_task 2건
  expect(r.weekDefaultDept).toBeGreaterThan(0)
})
