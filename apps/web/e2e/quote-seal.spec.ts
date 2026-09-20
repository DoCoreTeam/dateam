import { test, expect } from '@playwright/test'
import * as path from 'path'
import { dismissGlobalModals } from './_helpers'

/*
  직인 — **올렸으면 찍히고 안 올렸으면 문구가 선다.**

  왜 실브라우저인가: 이 기능의 판정은 「둘 중 하나만 뜬다」이고, 그건 렌더된 화면에서만
  참·거짓이 갈린다. 타입도 단위 테스트도 도장과 「(직인생략)」이 나란히 뜨는 것을 못 잡는다.

  시험이 만든 견적은 **id 로** 되돌린다 — 제목으로 지우면 사람이 만든 같은 제목의 것을 지운다.
  설정의 직인도 시험 전 값으로 되돌린다.
*/

const SEAL_KEY = 'quote.supplier.seal'
// 붉은 1x1 PNG — 실제 도장 대신. 「그림이 그 자리에 있나」만 보면 되므로 작을수록 좋다
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const SEAL_FIXTURE = path.join(__dirname, 'fixtures', 'seal.png')
const SEAL_IMG = 'img[alt="직인"]'
const SEAL_OMITTED = '(직인생략)'

test('직인을 올리면 찍히고, 없으면 (직인생략) 이 선다', async ({ page }) => {
  test.setTimeout(180_000)

  const before = await (await page.request.get('/api/crm/settings')).json() as
    { items?: { key: string; value: string | null }[] }
  const hadSeal = before.items?.find((i) => i.key === SEAL_KEY)
  expect(hadSeal, '설정에 직인 항목이 있어야 한다 — 없으면 올릴 자리가 없다').toBeTruthy()

  const deals = await (await page.request.get('/api/crm/deals?limit=1')).json() as { items?: { id: string }[] }
  const dealId = deals.items?.[0]?.id
  expect(dealId, '견적을 붙일 딜이 필요하다').toBeTruthy()

  const made: string[] = []
  try {
    // ── ① 직인 없이 만든 견적 → 문구 ──────────────────────────
    await page.request.patch('/api/crm/settings', { data: { key: SEAL_KEY, value: '' } })
    const plain = await (await page.request.post('/api/crm/quotes', {
      data: { dealId, title: 'E2E 직인 없음' },
    })).json() as { id: string }
    made.push(plain.id)

    await page.goto(`/crm/quotes/${plain.id}`)
    await dismissGlobalModals(page)
    await expect(page.getByText(SEAL_OMITTED)).toBeVisible({ timeout: 30_000 })
    await expect(page.locator(SEAL_IMG)).toHaveCount(0)

    // ── ② 직인을 올리고 만든 견적 → 도장 ──────────────────────
    await page.request.patch('/api/crm/settings', { data: { key: SEAL_KEY, value: PNG } })
    const stamped = await (await page.request.post('/api/crm/quotes', {
      data: { dealId, title: 'E2E 직인 있음' },
    })).json() as { id: string }
    made.push(stamped.id)

    await page.goto(`/crm/quotes/${stamped.id}`)
    await dismissGlobalModals(page)
    await expect(page.locator(SEAL_IMG)).toBeVisible({ timeout: 30_000 })
    // **둘이 함께 뜨지 않는다** — 도장과 문구가 나란히 있으면 문서가 스스로 흐려진다
    await expect(page.getByText(SEAL_OMITTED)).toHaveCount(0)

    // 인쇄에서도 남는다 — 화면에서만 찍히는 도장은 도장이 아니다
    await page.emulateMedia({ media: 'print' })
    await expect(page.locator(SEAL_IMG)).toBeVisible()
    await page.emulateMedia({ media: 'screen' })

    // ── ③ 굳었다: 설정에서 내려도 ②의 견적은 그대로 ────────────
    await page.request.patch('/api/crm/settings', { data: { key: SEAL_KEY, value: '' } })
    await page.goto(`/crm/quotes/${stamped.id}`)
    await dismissGlobalModals(page)
    await expect(page.locator(SEAL_IMG)).toBeVisible({ timeout: 30_000 })
  } finally {
    // 설정을 시험 전으로 — 원래 비어 있었으면 비운 채로 둔다
    await page.request.patch('/api/crm/settings', {
      data: { key: SEAL_KEY, value: hadSeal?.value ?? '' },
    }).catch(() => {})
    for (const id of made) {
      await page.request.delete(`/api/crm/quotes/${id}`).catch(() => {})
      await page.request.delete(`/api/crm/quotes/${id}?mode=purge`).catch(() => {})
    }
  }
})

/*
  **설정 화면에서 진짜로 올려 본다.**

  API 로만 값을 심어 확인하면 「올릴 자리가 있나」를 한 번도 안 본 것이 된다 —
  설정 정의만 있고 화면이 그 kind 를 못 그리면 사용자는 영원히 못 올린다.
  실제로 그 반대 방향의 사고가 있었다: 값·상수는 다 있는데 화면이 안 불러 기능이 없었다.
*/
test('설정 화면에서 직인 파일을 올릴 수 있다', async ({ page }) => {
  test.setTimeout(180_000)
  const before = await (await page.request.get('/api/crm/settings')).json() as
    { items?: { key: string; value: string | null }[] }
  const had = before.items?.find((i) => i.key === SEAL_KEY)?.value ?? ''

  try {
    await page.goto('/crm/settings')
    await dismissGlobalModals(page)
    // 설정은 「영업 단계」 탭에서 열린다 — 견적 탭으로 옮겨야 공급자 정보 카드가 선다
    await page.getByRole('tab', { name: '견적' }).click()

    // 입력칸 id 는 설정 키에서 온다 — 정의가 빠지면 이 칸 자체가 없다
    const file = page.locator(`input[type="file"][id="set-${SEAL_KEY}"]`)
    await expect(file, '설정 화면에 직인 올리는 칸이 없다').toBeAttached({ timeout: 30_000 })
    await file.setInputFiles(SEAL_FIXTURE)

    // 고르기만 해서는 설정이 아니다 — 저장까지 눌러야 값이 남는다
    const row = page.locator(
      `xpath=//input[@id="set-${SEAL_KEY}"]/ancestor::div[contains(@class,"row")][1]`,
    )
    await row.getByRole('button', { name: '저장', exact: true }).click()

    await expect.poll(async () => {
      const after = await (await page.request.get('/api/crm/settings')).json() as
        { items?: { key: string; value: string | null; masked?: string | null }[] }
      const row = after.items?.find((i) => i.key === SEAL_KEY)
      return (row?.masked ?? row?.value ?? '').length
    }, { timeout: 30_000, message: '올렸는데 설정에 값이 안 남았다' }).toBeGreaterThan(0)
  } finally {
    await page.request.patch('/api/crm/settings', { data: { key: SEAL_KEY, value: had } }).catch(() => {})
  }
})
