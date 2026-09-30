import { test, expect } from '@playwright/test'
import { dismissGlobalModals } from './_helpers'

/**
 * 서버에 안 닿는 동안 화면이 그렇다고 말하나 — 실브라우저
 *
 * **왜 실브라우저인가 (실측 2026-09-30)**: 사용자가 전날 열어 둔 CRM 첫 화면에서
 * 「녹음 시작」을 눌렀고, 화면에 뜬 말이 **「Failed to fetch」** 였다. 서버는 내려가 있었고
 * 화면만 살아 있었다 — 딜이 「32일째」라고 적혀 있었는데 그날 서버가 세면 33일째였다.
 * 그동안 화면은 한 마디도 하지 않았다.
 *
 * 그 침묵은 소스를 읽어서는 안 보인다. 「그려지는가」는 화면에서만 셀 수 있다.
 *
 * **서버를 끄지 않는다.** dev 서버(:3000)는 여러 세션이 나눠 쓰므로 끄면 남의 작업이 끊긴다.
 * 대신 브라우저에서 재는 창구 하나만 끊는다 — 화면이 겪는 일은 똑같다.
 */

const BAR = '[role="status"]'

// 기본 30초로는 모자란다 — 「연속 2회 실패해야 말한다」를 실제로 기다려야 하고,
// dev 서버는 이 화면을 처음 컴파일한다
test.setTimeout(180_000)

test('서버에 안 닿으면 배너가 뜨고, 다시 이으면 스스로 사라진다', async ({ page }) => {
  // `networkidle` 를 기다리지 않는다 — 이 화면은 스스로 계속 묻는 자리가 있어
  // 영원히 조용해지지 않고, waitForLoadState 는 테스트 시간을 통째로 먹는다(실측).
  await page.goto('/crm/today', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: '오늘', exact: true })).toBeVisible({ timeout: 60_000 })
  await dismissGlobalModals(page)
  await dismissGlobalModals(page)

  // ① 닿는 동안은 「서버에 닿지 않음」이 없다 — 늘 떠 있으면 아무도 안 본다
  await expect(page.locator(BAR).filter({ hasText: '서버에 닿지 않음' })).toHaveCount(0)

  // ② 재는 창구를 끊는다. abort 는 브라우저에게 「Failed to fetch」와 같은 일이다
  await page.route('**/api/ping', (route) => route.abort())

  const down = page.locator(BAR).filter({ hasText: '서버에 닿지 않음' })
  // 연속 2회 실패해야 말한다 — 첫 어긋남까지 최대 30초, 그 뒤로는 8초 간격
  await expect(down).toBeVisible({ timeout: 90_000 })

  // ③ 안 닿는다고만 하면 모자란다 — 화면의 값이 언제 것인지 말해야 한다
  await expect(down).toContainText('지금 보이는 값은 마지막으로 받은 것이에요')

  // ④ 다시 이으면 아무것도 안 눌러도 사라진다 — 「다시 시도」를 찾아 누르게 하지 않는다
  await page.unroute('**/api/ping')
  await expect(down).toHaveCount(0, { timeout: 60_000 })
})
