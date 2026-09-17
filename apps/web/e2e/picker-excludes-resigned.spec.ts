import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { dismissGlobalModals } from './_helpers'

/** 퇴사자가 사람 고르는 목록에서 사라진다 (P0019 I09) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const admin: any = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
)

const NAME = '고르기검사 일회용'
let userId = ''

test.beforeAll(async () => {
  const { data, error } = await admin.auth.admin.createUser({
    email: `loop-picker-${Date.now()}@dataalliance.test`,
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

test('퇴사 전에는 조직도 구성원 고르기에 뜨고 퇴사하면 사라진다', async ({ page }) => {
  // 조직도 관리 → 회사 노드에 하위 추가 → 구성원 선택 목록
  await page.goto('/admin/members?tab=org')
  await dismissGlobalModals(page)
  await page.locator('button[title="하위 추가"]').first().click()
  await expect(page.getByRole('heading', { name: '노드 추가' })).toBeVisible()
  await page.getByRole('combobox').first().selectOption('person').catch(() => {})
  await expect(page.getByRole('dialog').getByText(NAME, { exact: false }).first()).toHaveCount(1)

  // 퇴사시킨다
  await admin.from('member_employment').upsert(
    { user_id: userId, resigned_on: '2026-09-17' }, { onConflict: 'user_id' })

  await page.goto('/admin/members?tab=org')
  await dismissGlobalModals(page)
  await page.locator('button[title="하위 추가"]').first().click()
  await expect(page.getByRole('heading', { name: '노드 추가' })).toBeVisible()
  await page.getByRole('combobox').first().selectOption('person').catch(() => {})
  await expect(page.getByRole('dialog').getByText(NAME, { exact: false })).toHaveCount(0)
})
