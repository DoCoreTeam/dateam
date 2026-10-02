import { test, expect } from '@playwright/test'

/**
 * 제품 대화상자가 실제로 뜨고, 취소가 먹고, 확정이 먹는다 (정책 U-7 · F-10)
 *
 * **왜 이것이 이 판의 결정적 확인인가**: `useAskDialog` 는 `{dialog}` 를 렌더하지 않으면
 * 물어도 아무것도 안 뜨고 Promise 가 영원히 안 풀린다 — 화면이 조용히 멈춘다.
 * 79곳을 옮겼으니 「뜬다·취소가 먹는다·확정이 먹는다」를 눈으로 봐야 한다.
 * tsc·lint·단위 시험은 이 셋을 하나도 증명하지 못한다.
 */
test.setTimeout(300_000)
const STAMP = `__e2e_ask_${process.env.E2E_STAMP ?? 'x'}`

async function clearModals(page: import('@playwright/test').Page) {
  for (let i = 0; i < 8 && await page.locator('.modal-backdrop').count() > 0; i += 1) {
    await page.keyboard.press('Escape'); await page.waitForTimeout(400)
  }
}

test('거래처 삭제 — 우리 대화상자가 뜨고 취소하면 안 지워지고 확정하면 지워진다', async ({ page }) => {
  const native: string[] = []
  page.on('dialog', async (d) => { native.push(d.message()); await d.dismiss() })
  await page.setViewportSize({ width: 1440, height: 900 })

  await page.goto('/accounts', { waitUntil: 'domcontentloaded' })
  await clearModals(page)
  const made = await page.evaluate(async (name) => {
    const r = await fetch('/api/accounts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, industry: '시험', website: '' }),
    })
    return { ok: r.ok, body: await r.json().catch(() => null) }
  }, STAMP)
  expect(made.ok).toBeTruthy()
  const id = made.body?.id
  expect(id, 'id 를 못 받아 되돌릴 수 없다').toBeTruthy()

  /**
   * 살아 있나. **한 건 조회 창구는 GET 이 없다** — 처음엔 `GET /api/accounts/{id}` 로 쟀는데
   * 405 가 와서 「지워졌다」로 읽혔고, 취소가 멀쩡한데 시험이 빨개졌다.
   * 지금은 목록에서 id 를 찾는다 — 그 창구는 실재하고, 돌려주는 모양은 실측으로
   * `{ items, nextCursor, hasMore }` 다(짐작한 `accounts`·`data` 키는 없었다).
   */
  const alive = async () => page.evaluate(async (i) => {
    const r = await fetch('/api/accounts')
    if (!r.ok) return `목록을 못 읽음 ${r.status}`
    const j = await r.json().catch(() => null)
    const rows = Array.isArray(j) ? j : (j?.items ?? [])
    return rows.some((a: { id?: string }) => a?.id === i) ? 'alive' : 'gone'
  }, id)

  try {
    await page.reload({ waitUntil: 'domcontentloaded' })
    await clearModals(page)
    await page.getByText(STAMP, { exact: false }).first().click()
    await page.waitForTimeout(1000)

    const delBtn = page.getByRole('button', { name: '삭제', exact: true }).first()
    await expect(delBtn, '상세에 삭제 단추가 없다').toBeVisible({ timeout: 30_000 })

    // ── ① 우리 대화상자가 뜬다
    await delBtn.click()
    const title = page.getByText('거래처를 삭제할까요?', { exact: false })
    await expect(title, '우리 대화상자가 안 떴다 — {dialog} 를 안 그렸을 수 있다').toBeVisible({ timeout: 15_000 })
    const bodyText = await page.locator('.modal-card, [class*="askDialog"], [role="dialog"]').first().innerText()
    console.log('DIALOG_BODY', bodyText.replace(/\n+/g, ' | ').slice(0, 160))
    expect(bodyText, '본문이 무엇이 사라지는지 안 말한다').toContain(STAMP)

    // ── ② 취소하면 아무 일도 안 일어난다 (실제 경로인 「취소」 단추를 누른다 —
    //     Escape 는 대화상자와 그 뒤 상세 패널을 함께 닫아 다음 단계가 막힌다)
    // 상세 패널도 role="dialog" 라서 그 안에 ask 대화상자가 들어앉는다.
    // 두 「삭제」가 같은 컨테이너에 잡히므로 ask 대화상자의 **바닥**으로 좁힌다
    const foot = page.locator('[class*="foot"]').filter({ hasText: '취소' }).last()
    await foot.getByRole('button', { name: '취소', exact: true }).click()
    await expect(title, '취소했는데 대화상자가 안 닫혔다').toBeHidden({ timeout: 15_000 })
    const afterCancel = await alive()
    console.log('AFTER_CANCEL', afterCancel)
    expect(afterCancel, '취소했는데 지워졌다').toBe('alive')

    // ── ③ 확정하면 지워진다
    await delBtn.click()
    await expect(title).toBeVisible({ timeout: 15_000 })
    const foot2 = page.locator('[class*="foot"]').filter({ hasText: '취소' }).last()
    await foot2.getByRole('button', { name: '삭제', exact: true }).click()
    await expect(title, '확정했는데 대화상자가 안 닫혔다').toBeHidden({ timeout: 20_000 })
    await page.waitForTimeout(1500)
    const afterConfirm = await alive()
    console.log('AFTER_CONFIRM', afterConfirm)
    expect(afterConfirm, '확정했는데 안 지워졌다').toBe('gone')

    // ── ④ 새로고침해도 지워진 채로다
    await page.reload({ waitUntil: 'domcontentloaded' })
    await clearModals(page)
    await page.waitForTimeout(1500)
    const stillListed = await page.getByText(STAMP, { exact: false }).count()
    console.log('AFTER_RELOAD 목록에 남은 수', stillListed)
    expect(stillListed, '새로고침하니 지운 것이 되살아났다').toBe(0)
  } finally {
    await page.evaluate(async (i) => { await fetch(`/api/accounts/${i}`, { method: 'DELETE' }).catch(() => {}) }, id)
  }
  console.log('NATIVE_DIALOGS', native.length)
  expect(native, '브라우저 기본 대화상자가 떴다').toEqual([])
})

/** ⑩ 좁은 화면에서도 대화상자가 안 터진다 (U-8) — 1440 에서 0 이어도 390 에서 터지는 전례가 있다 */
test('좁은 화면에서 확인창이 안 터진다', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/accounts', { waitUntil: 'domcontentloaded' })
  await clearModals(page)
  const made = await page.evaluate(async (name) => {
    const r = await fetch('/api/accounts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, industry: '시험', website: '' }),
    })
    return (await r.json().catch(() => null))?.id
  }, `${STAMP}_narrow`)
  expect(made, 'id 를 못 받아 되돌릴 수 없다').toBeTruthy()
  try {
    await page.reload({ waitUntil: 'domcontentloaded' })
    await clearModals(page)
    await page.getByText(`${STAMP}_narrow`, { exact: false }).first().click()
    await page.waitForTimeout(1000)
    await page.getByRole('button', { name: '삭제', exact: true }).first().click()
    const title = page.getByText('거래처를 삭제할까요?', { exact: false })
    await expect(title).toBeVisible({ timeout: 15_000 })
    // 가로로 삐져나가지 않는가 — 바닥 단추가 화면 안에 들어오나
    const metrics = await page.evaluate(() => {
      const foots = [...document.querySelectorAll('[class*="foot"]')]
      const f = foots[foots.length - 1] as HTMLElement | undefined
      const r = f?.getBoundingClientRect()
      return {
        bodyOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        footRight: r ? Math.round(r.right) : null,
        vw: window.innerWidth,
      }
    })
    console.log('NARROW', JSON.stringify(metrics))
    expect(metrics.bodyOverflow, '좁은 화면에서 쪽이 가로로 넘친다').toBeLessThanOrEqual(1)
    expect(metrics.footRight!, '확인창 바닥 단추가 화면 밖으로 나갔다').toBeLessThanOrEqual(metrics.vw)
    const foot = page.locator('[class*="foot"]').filter({ hasText: '취소' }).last()
    await foot.getByRole('button', { name: '취소', exact: true }).click()
    await expect(title).toBeHidden({ timeout: 15_000 })
  } finally {
    await page.evaluate(async (i) => { await fetch(`/api/accounts/${i}`, { method: 'DELETE' }).catch(() => {}) }, made)
  }
})
