import { test, expect, type Page } from '@playwright/test'

/**
 * 막힌 안내에서 바로 고치러 간다 (P0133)
 *
 * 실데이터는 읽기만 한다. 템플릿 목록과 끝내기 결과만 응답을 바꿔 막힌 상태를 만든다 —
 * 템플릿을 지우거나 미팅을 끝내서 만들면 남의 데이터가 바뀐다.
 */

async function getJson<T>(page: Page, url: string): Promise<T> {
  return page.evaluate(async (u) => (await fetch(u)).json(), url) as Promise<T>
}

async function quietModals(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try { localStorage.setItem('changelog_seen_version', '999.999.999') } catch { /* 저장소 막힘 */ }
  })
}

test('설정 주소의 탭 값이 그 탭을 연다', async ({ page }) => {
  await page.goto('/crm/settings?tab=contract')
  await expect(page.getByText('계약서 템플릿', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('사업 유형', { exact: true })).toHaveCount(0)
})

test('템플릿이 없다는 안내의 단추가 계약 탭을 연다', async ({ page }) => {
  await quietModals(page)
  await page.goto('/crm')
  const { items } = await getJson<{ items: { dealId: string | null; status: string }[] }>(page, '/api/crm/quotes?limit=100')
  // 계약서 만들기 단추는 보냄과 수락 견적에만 선다
  const dealId = items.find((q) => q.dealId && ['SENT', 'ACCEPTED'].includes(q.status))?.dealId
  test.skip(!dealId, '보낸 견적이 있는 딜이 없다')

  await page.route('**/api/crm/contract-templates', (r) =>
    r.request().method() === 'GET' ? r.fulfill({ json: { items: [] } }) : r.continue())
  await page.goto(`/crm/deals/${dealId}`)
  await page.getByRole('button', { name: '계약서 만들기' }).first().click()
  const go = page.getByRole('link', { name: '계약서 템플릿 만들기' })
  await expect(go).toBeVisible()
  await go.click()
  await expect(page).toHaveURL(/\/crm\/settings\?tab=contract$/, { timeout: 30_000 })
  await expect(page.getByText('계약서 템플릿', { exact: true }).first()).toBeVisible()
})

test('미팅 되묻기 「어느 회사와 만난 건가요?」가 회사 고르기 창을 연다', async ({ page }) => {
  await quietModals(page)
  await page.goto('/crm')
  const { items } = await getJson<{ items: { id: string }[] }>(page, '/api/crm/meetings?limit=5')
  const meetingId = items[0]?.id
  test.skip(!meetingId, '미팅이 없다')

  await page.route(`**/api/crm/meetings/${meetingId}/finish`, (r) =>
    r.request().method() === 'GET'
      ? r.fulfill({ json: {
        running: false, stage: null, error: null, failedSteps: [], jobId: 'j', endedAt: new Date().toISOString(),
        steps: [{ key: 'end', status: 'done', detail: '미팅을 끝냈어요' }],
        questions: [
          { key: 'meeting.company', ask: '어느 회사와 만난 건가요?', why: '이유', href: `/crm/meetings/${meetingId}#mf-company` },
          { key: 'meeting.deal', ask: '이 회사의 어떤 건인가요?', why: '이유', href: `/crm/meetings/${meetingId}#mf-deal` },
        ],
      } })
      : r.continue())
  await page.goto(`/crm/meetings/${meetingId}`)
  await page.getByRole('button', { name: '어느 회사와 만난 건가요?' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/crm/meetings/${meetingId}$`))
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '이 회사의 어떤 건인가요?' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
})
