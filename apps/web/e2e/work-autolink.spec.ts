import { test, expect } from '@playwright/test'

// 업무 자동 연관 연결 — 실데이터 파이프라인 검증(인증 세션으로 run → GET 확인).
const LOG_IDS = [
  'cbceef6f-6465-4712-a307-d316fb922abe',
  '3a11fc81-6969-42d2-b7ed-9815c5f76a24',
  '45f8554d-e5bf-41b6-8519-0cfb1f432f18',
  '3a3e3c1d-3a65-46a8-86f8-e9e80e38e347',
  '8ed8d313-330a-4234-b02f-eb7119979d3e',
]

test('autolink 파이프라인 — 실 업무 자동 연결 생성', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/daily')
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })

  const out = await page.evaluate(async (ids) => {
    const results: any[] = []
    for (const logId of ids) {
      const run = await fetch('/api/work/autolink', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logId, action: 'run' }),
      }).then((r) => r.json()).catch((e) => ({ error: String(e) }))
      const list = await fetch(`/api/work/autolink?logId=${logId}`).then((r) => r.json()).catch(() => ({}))
      results.push({ logId: logId.slice(0, 8), run, rel: (list.relations || []).length, ent: (list.entities || []).length })
    }
    return results
  }, LOG_IDS)
  console.log('[autolink]', JSON.stringify(out, null, 2))

  // 최소 1건은 ok로 실행돼야 함(연결 0건이어도 ok=true 정상)
  expect(out.every((r: any) => r.run?.ok === true)).toBeTruthy()
  const totalLinks = out.reduce((s: number, r: any) => s + r.rel + r.ent, 0)
  console.log('[autolink] 총 생성 연결:', totalLinks)
})
