import { test, expect } from '@playwright/test'
import { dismissGlobalModals } from './_helpers'

/**
 * 연결이 없어도 녹음이 시작되고, 돌아오면 서버로 건너간다 — 실브라우저
 *
 * **왜 실브라우저인가 (사용자 지시 2026-09-30)**: *"어떤 상황이든 누락되는게 발생되면
 * 안되는거야 오케이? 오프라인에서도 되게 만들어"*.
 *
 * 이 길은 부품 여섯을 지난다 — 입구·로컬 회의·녹음기·기기 보관·건네기·올리기.
 * 하나라도 안 이어져 있으면 소리는 기기에 남고 아무도 못 본다. 그 「이어짐」은
 * 단위 시험으로 못 센다. 그래서 끝에서 끝까지 한 번 걸어 본다.
 *
 * **서버를 끄지 않는다.** dev 서버는 여러 세션이 나눠 쓴다. 대신 브라우저에서 창구만 끊는다 —
 * 화면이 겪는 일은 똑같다.
 */

// 마이크를 실제로 연다. 가짜 장치를 물려 사람 손이 필요 없게 한다
test.use({
  permissions: ['microphone'],
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  },
})

// 배너 판정(연속 2회)과 되돌아온 뒤의 건네기를 실제로 기다린다
test.setTimeout(300_000)

const PENDING_KEY = 'newax.pending-meetings'

test('연결이 없어도 녹음이 시작되고, 이으면 회의가 서버로 건너간다', async ({ page }) => {
  await page.goto('/crm/today', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: '오늘', exact: true })).toBeVisible({ timeout: 60_000 })
  await dismissGlobalModals(page)
  await dismissGlobalModals(page)

  /*
    **화면이 다 뜬 뒤에 끊는다.** 뜨는 도중에 끊으면 이 화면은 아직 첫 조회 중이라
    로딩 표시에 머물고, 눌러야 할 단추가 아예 안 나온다(실측: 그래서 한 번 실패했다).
    실제로 겪는 일도 이 순서다 — 열어 둔 화면에서 연결이 끊긴다.
  */
  const startButton = page.getByRole('button', { name: '녹음 시작' })
  await expect(startButton).toBeVisible({ timeout: 90_000 })

  // 시작 전에 기기를 비워 둔다 — 남의 판이 남겨 둔 것이 있으면 판정이 흐려진다
  await page.evaluate((k) => window.localStorage.removeItem(k), PENDING_KEY)

  const urlBefore = page.url()

  /*
    ① 창구를 끊는다. abort 는 브라우저에게 「Failed to fetch」와 같은 일이다.
    **만드는 요청만** 끊는다 — 목록 조회까지 끊으면 화면이 통째로 오류가 되어
    「녹음 입구가 오프라인에서 어떻게 동작하나」를 못 본다.
  */
  await page.route('**/api/crm/meetings**', (r) => (
    r.request().method() === 'POST' ? r.abort() : r.continue()
  ))
  await page.route('**/api/ping', (r) => r.abort())

  // ② 녹음 시작 — 화면이 안 바뀌고 그 자리에서 녹음이 돈다
  await startButton.click()

  await expect(page.getByText('연결이 없어 이 기기에 녹음하고 있어요')).toBeVisible({ timeout: 60_000 })
  expect(page.url(), '없는 주소로 옮겨 갔다 — 오프라인에서는 그 화면이 통째로 죽는다').toBe(urlBefore)

  // 상주 바가 녹음 중이라고 말하고, 갈 데가 없으므로 링크를 안 건다
  const recBar = page.locator('[role="status"]').filter({ hasText: '녹음 중' })
  await expect(recBar).toBeVisible({ timeout: 30_000 })
  await expect(recBar).toContainText('이 기기에 저장 중')
  await expect(recBar.getByRole('link', { name: /회의로/ })).toHaveCount(0)

  // 기기에 대기 회의가 남았다 — 이것이 「나중에 서버로 건너갈 것」의 근거다
  const pending = await page.evaluate((k) => window.localStorage.getItem(k), PENDING_KEY)
  expect(pending, '대기 회의를 안 적었다 — 적힌 데가 없으면 그 녹음은 주인이 없다').toContain('local_')

  // ③ 몇 초 녹음하고 끊는다. 끊어야 진행 중 구간이 기기에 떨어진다
  await page.waitForTimeout(6000)
  await recBar.getByRole('button', { name: '종료' }).click()

  // ④ 다시 잇는다. 아무것도 안 눌러도 건너가야 한다
  await page.unroute('**/api/crm/meetings**')
  await page.unroute('**/api/ping')

  await expect
    .poll(async () => page.evaluate((k) => window.localStorage.getItem(k) ?? '', PENDING_KEY), {
      timeout: 180_000,
      message: '대기 회의가 서버로 안 건너갔다',
    })
    .not.toContain('local_')

  // ⑤ 서버에 정말 생겼나 — 화면이 아니라 창구에 묻는다
  const list = await page.request.get('/api/crm/meetings?limit=5')
  expect(list.ok()).toBeTruthy()
  const body = await list.json() as { items?: { id: string; title: string }[] }
  const items = body.items ?? []
  expect(items.length, '회의 목록이 비었다').toBeGreaterThan(0)

  // ⑥ 만든 것은 **id 로** 되돌린다 — 제목으로 지우면 남의 회의를 지운다
  const mine = items[0]
  await page.request.delete(`/api/crm/meetings/${mine.id}`)
})
