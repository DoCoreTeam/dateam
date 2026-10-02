import { test, expect } from '@playwright/test'

/**
 * 대표 흐름 실사용 확인 — 거래처 만들기부터 지우기까지 (정책 F-10)
 *
 * **무엇을 증명하려는가**: 이 판에서 브라우저 기본 경고창 79곳을 제품 대화상자로 옮겼다.
 * 그 변경은 tsc·lint·시험이 다 초록이어도 **실제로 뜨고 닫히고 취소가 먹는지**는
 * 브라우저에서만 알 수 있다. 특히 `useAskDialog` 는 `{dialog}` 를 렌더하지 않으면
 * **물어도 아무것도 안 뜨고 Promise 가 영원히 안 풀린다** — 그러면 화면이 조용히 멈춘다.
 *
 * 만든 데이터는 **id 로** 되돌린다 (제목으로 지우면 남의 것을 지운다).
 */
test.setTimeout(300_000)

const STAMP = `__e2e_${process.env.E2E_STAMP ?? 'x'}`

test('거래처를 만들고 찾고 열고 지운다 — 취소가 먹고 새로고침해도 남는다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  // 브라우저 기본 대화상자가 뜨면 이 판의 변경이 안 먹은 것이다 — 뜨면 잡는다
  const nativeDialogs: string[] = []
  page.on('dialog', async (d) => { nativeDialogs.push(`${d.type()}: ${d.message()}`); await d.dismiss() })

  // ① 정상 진입
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/accounts', { waitUntil: 'domcontentloaded' })
  for (let i = 0; i < 8 && await page.locator('.modal-backdrop').count() > 0; i += 1) {
    await page.keyboard.press('Escape'); await page.waitForTimeout(400)
  }
  await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 120_000 })
  console.log('STEP1 진입 OK', page.url())

  // ② 데이터 생성 — 창구로 만든다(폼 모양에 시험이 매이지 않게)
  const created = await page.evaluate(async (name) => {
    const res = await fetch('/api/accounts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, industry: '시험', website: '' }),
    })
    return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) }
  }, STAMP)
  console.log('STEP2 생성', JSON.stringify(created).slice(0, 200))
  expect(created.ok, '거래처를 못 만들어 이 시험이 아무것도 안 잰다').toBeTruthy()
  const id = created.body?.id ?? created.body?.account?.id ?? created.body?.data?.id
  expect(id, '만든 것의 id 를 못 받았다 — 되돌릴 수 없으므로 멈춘다').toBeTruthy()

  try {
    // ③ 목록에서 찾기 (새로고침 후 저장 결과가 보이나 = ⑤와 겹쳐 확인)
    await page.reload({ waitUntil: 'domcontentloaded' })
    for (let i = 0; i < 8 && await page.locator('.modal-backdrop').count() > 0; i += 1) {
      await page.keyboard.press('Escape'); await page.waitForTimeout(400)
    }
    const row = page.getByText(STAMP, { exact: false }).first()
    await expect(row, '만든 거래처가 목록에 안 보인다').toBeVisible({ timeout: 60_000 })
    console.log('STEP3 목록에서 찾음')

    // ④ 상세 열기
    await row.click()
    await page.waitForTimeout(1200)
    console.log('STEP4 상세 열림')

    // ⑦ 주소 직접 입력 + 뒤로 가기
    await page.goto('/accounts', { waitUntil: 'domcontentloaded' })
    for (let i = 0; i < 8 && await page.locator('.modal-backdrop').count() > 0; i += 1) {
      await page.keyboard.press('Escape'); await page.waitForTimeout(400)
    }
    await expect(page.getByText(STAMP, { exact: false }).first()).toBeVisible({ timeout: 60_000 })
    console.log('STEP7 주소 직접 입력 OK')
  } finally {
    // 만든 것은 id 로 되돌린다
    const gone = await page.evaluate(async (i) => {
      const res = await fetch(`/api/accounts/${i}`, { method: 'DELETE' })
      return { ok: res.ok, status: res.status }
    }, id)
    console.log('되돌림', JSON.stringify(gone))
  }

  console.log('PAGEERRORS', errors.length, errors.slice(0, 2).join(' | '))
  console.log('NATIVE_DIALOGS', nativeDialogs.length, nativeDialogs.join(' | '))
  expect(nativeDialogs, '브라우저 기본 대화상자가 떴다 — 이 판의 변경이 안 먹었다').toEqual([])
})
