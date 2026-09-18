import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { dismissGlobalModals } from './_helpers'

/**
 * 퇴사 예정일은 그날이 와야 효력이 생긴다 (P0021 I01a)
 *
 * 실측 사고: 9월 30일 퇴사로 적은 사람이 9월 18일에 이미 로그인을 못 했다.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const admin: any = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
)

const NAME = '퇴사예정 일회용'
let userId = ''

function kstToday(offsetDays = 0): string {
  const d = new Date(new Date().toLocaleDateString('sv', { timeZone: 'Asia/Seoul' }) + 'T00:00:00Z') // kst-ok
  d.setUTCDate(d.getUTCDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

test.beforeAll(async () => {
  const { data, error } = await admin.auth.admin.createUser({
    email: `loop-sched-${Date.now()}@dataalliance.test`,
    password: 'Throwaway!2026', email_confirm: true, user_metadata: { name: NAME },
  })
  if (error) throw error
  userId = data.user.id
  await admin.from('profiles').upsert({ id: userId, name: NAME, role: 'member' }, { onConflict: 'id' })
})

test.afterAll(async () => {
  if (!userId) return
  await admin.from('member_employment').delete().eq('user_id', userId)
  await admin.from('profiles').delete().eq('id', userId)
  await admin.auth.admin.deleteUser(userId)
})

test('앞날 퇴사일은 재직으로 두고 로그인도 열어 둔다', async ({ page }) => {
  const future = kstToday(12)

  await page.goto(`/admin/members/${userId}`)
  await dismissGlobalModals(page)
  await page.locator('#emp-resigned').fill(future)
  await page.getByRole('button', { name: '저장' }).click()
  await expect(page.getByText('저장됨')).toBeVisible()
  await page.waitForTimeout(900)

  // 감사 기준: 로그인이 안 막힌다
  const { data: authAfter } = await admin.auth.admin.getUserById(userId)
  expect(authAfter.user.banned_until ?? null, '앞날 퇴사일인데 로그인이 막혔다').toBeNull()

  // 감사 기준: 재직 목록에 남고 「퇴사 예정 날짜」가 붙는다
  await page.goto(`/admin/members?tab=users&q=${encodeURIComponent(NAME)}`)
  await dismissGlobalModals(page)
  const row = page.locator('tbody tr', { hasText: NAME })
  await expect(row).toHaveCount(1)
  await expect(row.getByText(`퇴사 예정 ${future}`)).toBeVisible()

  // 감사 기준: 퇴사자 탭에는 아직 없다
  await page.goto(`/admin/members?tab=resigned&q=${encodeURIComponent(NAME)}`)
  await dismissGlobalModals(page)
  await expect(page.locator('tbody tr', { hasText: NAME })).toHaveCount(0)
})

test('퇴사일이 오늘이 되면 막히고 퇴사자 탭으로 간다', async ({ page }) => {
  await page.goto(`/admin/members/${userId}`)
  await dismissGlobalModals(page)
  await page.locator('#emp-resigned').fill(kstToday(0))
  await page.getByRole('button', { name: '저장' }).click()
  await expect(page.getByText('저장됨')).toBeVisible()
  await page.waitForTimeout(900)

  const { data: authAfter } = await admin.auth.admin.getUserById(userId)
  expect(authAfter.user.banned_until ?? null, '퇴사일이 왔는데 로그인이 안 막혔다').not.toBeNull()

  await page.goto(`/admin/members?tab=resigned&q=${encodeURIComponent(NAME)}`)
  await dismissGlobalModals(page)
  await expect(page.locator('tbody tr', { hasText: NAME })).toHaveCount(1)
})

test('앞날로 되돌리면 걸려 있던 차단이 풀린다', async ({ page }) => {
  await page.goto(`/admin/members/${userId}`)
  await dismissGlobalModals(page)
  await page.locator('#emp-resigned').fill(kstToday(20))
  await page.getByRole('button', { name: '저장' }).click()
  await expect(page.getByText('저장됨')).toBeVisible()
  await page.waitForTimeout(900)

  const { data: authAfter } = await admin.auth.admin.getUserById(userId)
  expect(authAfter.user.banned_until ?? null, '앞날로 고쳤는데 차단이 남았다').toBeNull()
})
