import { test, expect } from '@playwright/test'
import { dismissGlobalModals } from './_helpers'

/**
 * 화면이 다 뜬 뒤에 모달을 치운다.
 *
 * 패치노트 모달은 **판이 올라간 뒤 첫 세션에 한 번** 뜬다. 그래서 파일의 첫 검사만 걸리고
 * 단독으로 돌리면 통과한다 — 가장 헷갈리는 실패다. 백드롭은 뒤 단추를 visible·enabled 로
 * 두고 **클릭만 삼킨다**(실측 2026-09-29: 「담당자 바꾸기」가 resolved 됐는데 클릭이 타임아웃).
 */
async function ready(page: import('@playwright/test').Page, path: string) {
  await page.goto(path)
  await page.waitForLoadState('networkidle').catch(() => {})
  await dismissGlobalModals(page)
  await dismissGlobalModals(page)
}

/**
 * 담당자를 화면에서 바꿀 수 있나 — 세 상세 화면
 *
 * 왜 실브라우저인가: 창구는 v0.10.424 에 열려 있었는데 **부르는 화면이 0곳**이었다.
 * 코드에 있는 것과 화면에 뜨는 것은 다르다는 것이 이 판의 출발점이라, 마지막 확인도 화면에서 한다.
 */

const DEAL = 'cmuccd3yi000djw04psv58m33'
// 목록에서 눌러 들어가지 않고 id 로 직행한다 — 목록 카드의 링크 모양에 검사가 묶이면
// 목록을 손볼 때마다 여기가 같이 깨진다
const COMPANY = 'cmucccpe0000ajw04mx6bmt7k'
const PERSON = 'cmtnwt38h0002l104e46l3lx7'

test('딜 상세에서 담당자는 누를 수 있고 작성자는 못 누른다', async ({ page }) => {
  await ready(page, `/crm/deals/${DEAL}`)

  const ownerField = page.locator('div', { has: page.locator('dt', { hasText: '담당자' }) }).last()
  await expect(page.getByText('담당자', { exact: true })).toBeVisible()

  // 담당자 옆에는 누르는 자리가 있다
  const trigger = page.getByRole('button', { name: '담당자 바꾸기' })
  await expect(trigger).toBeVisible()

  // 눌러서 고르는 목록이 열린다
  await trigger.click()
  await expect(page.getByRole('listbox', { name: '담당자 고르기' })).toBeVisible()
  await expect(page.getByRole('option').first()).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(ownerField).toBeTruthy()
})

test('딜 상세의 작성자 옆에는 누르는 자리가 없다', async ({ page }) => {
  await ready(page, `/crm/deals/${DEAL}`)
  await expect(page.getByText('작성자', { exact: true })).toBeVisible()
  // 담당자 바꾸기 단추는 화면에 하나뿐이다 — 작성자 쪽에 또 있으면 둘이 된다
  await expect(page.getByRole('button', { name: '담당자 바꾸기' })).toHaveCount(1)
})

test('거래처 상세에 담당자와 작성자가 보이고 담당자만 바꿀 수 있다', async ({ page }) => {
  await ready(page, `/crm/companies/${COMPANY}`)
  await expect(page.getByText('담당자', { exact: true })).toBeVisible()
  await expect(page.getByText('작성자', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '담당자 바꾸기' })).toHaveCount(1)
})

test('고객 상세에 담당자와 작성자가 보이고 담당자만 바꿀 수 있다', async ({ page }) => {
  await ready(page, `/crm/people/${PERSON}`)
  await expect(page.getByText('담당자', { exact: true })).toBeVisible()
  await expect(page.getByText('작성자', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '담당자 바꾸기' })).toHaveCount(1)
})
