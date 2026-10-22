import { test, expect, type Page } from '@playwright/test'
import { dismissGlobalModals } from './_helpers'

/**
 * 회의를 녹음부터 시작하는 세 길 (P0154)
 *
 * 홈 단추와 사이드바 회의노트 메뉴는 CRM 권한에 따라 같은 곳으로 가야 한다.
 * 이 계정이 CRM 권한을 가졌는지는 사이드바 주소로 읽는다. 둘이 갈리면 그 자체가 결함이다.
 *
 * 녹음은 켜지 않는다. 녹음 자리(RecordingPanel 안내 문구)가 보이는 데까지만 본다.
 * 만든 기록은 id 로 영구 삭제한다. 제목으로 지우면 남의 것을 지운다.
 */

const RECORD_START = '녹음 시작'
const RECORDING_HINT = '10분마다 자동으로 저장돼요'

const AUTH_STATE = process.env.E2E_AUTH_STATE ?? 'apps/web/e2e/auth-state.json'
test.use({ storageState: AUTH_STATE })
// 개발 서버는 화면을 처음 열 때 굽는다, 기본 30초로는 첫 진입이 모자란다
test.describe.configure({ timeout: 180_000 })

type Made = { kind: 'crm' | 'notes'; id: string }
const made: Made[] = []

async function purge(page: Page, m: Made) {
  const base = m.kind === 'crm' ? `/api/crm/meetings/${m.id}` : `/api/meeting-notes/${m.id}`
  if (m.kind === 'crm') {
    const got = await page.request.get(base)
    const body = got.ok() ? await got.json().catch(() => null) : null
    const noteId = body?.noteId ?? body?.meeting?.noteId ?? null
    await page.request.delete(base)
    await page.request.delete(`${base}?mode=purge`)
    if (noteId) await purge(page, { kind: 'notes', id: String(noteId) })
    return
  }
  await page.request.delete(base)
  await page.request.delete(`${base}?mode=purge`)
}

test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: AUTH_STATE })
  const page = await ctx.newPage()
  for (const m of made) await purge(page, m).catch(() => {})
  await ctx.close()
})

function recordMade(url: string) {
  const crm = url.match(/\/crm\/meetings\/([^/?#]+)/)
  if (crm) made.push({ kind: 'crm', id: crm[1] })
  const note = url.match(/\/meeting-notes\/([^/?#]+)/)
  if (note && note[1] !== 'new') made.push({ kind: 'notes', id: note[1] })
}

test('홈 녹음 시작과 사이드바 회의노트가 같은 곳으로 간다', async ({ page }) => {
  await page.goto('/home')
  await dismissGlobalModals(page)

  const navHref = await page.locator('nav a', { hasText: '회의노트' }).first().getAttribute('href')
  expect(['/crm/meetings', '/meeting-notes']).toContain(navHref)
  const hasCrm = navHref === '/crm/meetings'
  console.log(`[F-10] 사이드바 회의노트 주소 ${navHref} (CRM 권한 ${hasCrm ? '있음' : '없음'})`)

  await page.getByRole('button', { name: RECORD_START }).first().click()
  const expected = hasCrm ? /\/crm\/meetings\/[^/?]+\?wb=transcript/ : /\/meeting-notes\/[^/?]+\?wb=transcript/
  await page.waitForURL(expected, { timeout: 60_000 })
  recordMade(page.url())
  console.log(`[F-10] 홈 녹음 시작 도착 ${page.url()}`)
  await dismissGlobalModals(page)
  await expect(page.getByText(RECORDING_HINT).first()).toBeVisible({ timeout: 30_000 })
})

test('회의노트 목록의 녹음 시작이 새 기록의 녹음 자리를 연다', async ({ page }) => {
  await page.goto('/meeting-notes')
  await dismissGlobalModals(page)
  await page.getByRole('button', { name: RECORD_START }).first().click()
  await page.waitForURL(/\/meeting-notes\/[^/?]+\?wb=transcript/, { timeout: 60_000 })
  recordMade(page.url())
  console.log(`[F-10] 회의노트 녹음 시작 도착 ${page.url()}`)
  await dismissGlobalModals(page)
  await expect(page.getByText(RECORDING_HINT).first()).toBeVisible({ timeout: 30_000 })
})

test('새 회의노트 화면에도 녹음 시작이 있다', async ({ page }) => {
  await page.goto('/meeting-notes/new')
  await dismissGlobalModals(page)
  await expect(page.getByRole('button', { name: RECORD_START }).first()).toBeVisible()
})
