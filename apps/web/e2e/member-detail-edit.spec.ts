import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { dismissGlobalModals } from './_helpers'

/**
 * 구성원 상세에서 계정을 고친다 (P0022)
 *
 * 왜 검사하나 (사용자 지적 2026-09-19): 상세에 와서 계정을 보고 있는데 고칠 방법이 없었다.
 * 목록 행에 있는 조작이 상세에 없으면 상세로 올 이유가 없다.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const admin: any = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
)

const NAME = '상세수정 일회용'
let userId = ''

test.beforeAll(async () => {
  const { data, error } = await admin.auth.admin.createUser({
    email: `loop-edit-${Date.now()}@dataalliance.test`,
    password: 'Throwaway!2026', email_confirm: true, user_metadata: { name: NAME },
  })
  if (error) throw error
  userId = data.user.id
  await admin.from('profiles').upsert({ id: userId, name: NAME, role: 'member' }, { onConflict: 'id' })
})

test.afterAll(async () => {
  if (!userId) return
  await admin.from('org_nodes').delete().eq('type', 'person').eq('user_id', userId)
  await admin.from('member_employment').delete().eq('user_id', userId)
  await admin.from('profiles').delete().eq('id', userId)
  await admin.auth.admin.deleteUser(userId)
})

test('상세에서 이름 직급 직책 역할 소속을 고쳐 저장하면 새로고침 뒤에도 남는다', async ({ page }) => {
  await page.goto(`/admin/members/${userId}`)
  await dismissGlobalModals(page)

  // 고치기 전에는 입력칸이 없다 — 읽는 화면이다
  await expect(page.locator('#acc-name')).toHaveCount(0)

  // 아래 재직 기록 카드에도 「저장」이 있어 이름만으로는 갈리지 않는다
  await page.locator('#acc-edit').click()
  await expect(page.locator('#acc-save')).toBeVisible()
  await expect(page.locator('#acc-cancel')).toBeVisible()

  await page.locator('#acc-name').fill(`${NAME} 고침`)
  await page.locator('#acc-rank').selectOption({ index: 1 })
  await page.locator('#acc-position').selectOption({ index: 1 })
  await page.locator('#acc-role').selectOption('admin')
  await page.locator('#acc-dept').selectOption({ index: 1 })
  const pickedRank = await page.locator('#acc-rank').inputValue()
  const pickedDept = await page.locator('#acc-dept').inputValue()

  await page.locator('#acc-save').click()
  await expect(page.locator('#acc-name')).toHaveCount(0)
  await page.waitForTimeout(900)

  await page.reload()
  await dismissGlobalModals(page)
  await expect(page.getByRole('heading', { name: `${NAME} 고침` })).toBeVisible()
  await expect(page.getByText('admin', { exact: true })).toBeVisible()

  const { data: after } = await admin.from('profiles').select('name, rank, role').eq('id', userId).single()
  expect(after.name).toBe(`${NAME} 고침`)
  expect(after.rank).toBe(pickedRank)
  expect(after.role).toBe('admin')
  const { data: node } = await admin.from('org_nodes').select('parent_id').eq('type', 'person').eq('user_id', userId).maybeSingle()
  expect(node?.parent_id, '소속이 조직도에 안 잡힘').toBe(pickedDept)
})

test('취소하면 고치기 전 값으로 돌아간다', async ({ page }) => {
  await page.goto(`/admin/members/${userId}`)
  await dismissGlobalModals(page)
  await page.locator('#acc-edit').click()
  await page.locator('#acc-name').fill('버릴 이름')
  await page.locator('#acc-cancel').click()
  await expect(page.locator('#acc-name')).toHaveCount(0)
  await expect(page.getByText('버릴 이름')).toHaveCount(0)

  const { data } = await admin.from('profiles').select('name').eq('id', userId).single()
  expect(data.name).not.toBe('버릴 이름')
})

test('목록 행에 있는 조작이 상세에도 전부 있다', async ({ page }) => {
  // 목록 쪽 묶음
  await page.goto(`/admin/members?tab=users&q=${encodeURIComponent(NAME)}`)
  await dismissGlobalModals(page)
  const row = page.locator('tbody tr').first()
  await row.getByRole('button', { name: /작업 더보기/ }).click()
  const inRow = await row.getByRole('button').allInnerTexts()

  // 상세 쪽 묶음
  await page.goto(`/admin/members/${userId}`)
  await dismissGlobalModals(page)
  const inDetail = (await page.getByRole('button').allInnerTexts()).map((t) => t.trim())

  for (const label of ['PW초기화', '온보딩 초기화', '퇴사 처리', '삭제']) {
    expect(inRow.some((t) => t.includes(label)), `목록에 ${label} 가 없다`).toBe(true)
    expect(inDetail.some((t) => t.includes(label)), `상세에 ${label} 가 없다`).toBe(true)
  }
})
