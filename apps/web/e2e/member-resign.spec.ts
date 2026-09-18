import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { dismissGlobalModals } from './_helpers'

/**
 * 퇴사 처리 · 구성원 상세 실브라우저 검사 (P0019 I04 I05)
 *
 * 실데이터를 건드리지 않는다 — 일회용 계정을 만들고 검사 끝에 지운다.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const admin: any = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
)

const NAME = '퇴사검사 일회용'
let userId = ''

test.beforeAll(async () => {
  const { data, error } = await admin.auth.admin.createUser({
    email: `loop-resign-${Date.now()}@dataalliance.test`,
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

test('퇴사 처리하면 재직 목록에서 빠지고 퇴사자 탭으로 옮겨진다', async ({ page }) => {
  await page.goto(`/admin/members?tab=users&q=${encodeURIComponent(NAME)}`)
  await dismissGlobalModals(page)

  const row = page.locator('tbody tr', { hasText: NAME })
  await expect(row).toHaveCount(1)

  // 감사 기준: 행을 누르면 상세로 간다 — 제목 칸이 진짜 링크여야 새 탭·키보드가 산다
  await expect(row.locator(`a[href="/admin/members/${userId}"]`).first()).toHaveCount(1)

  // 감사 기준: 관리 메뉴 안에 퇴사 단추가 있다
  await row.getByRole('button', { name: `${NAME} 작업 더보기` }).click()
  const resignBtn = row.getByRole('button', { name: '퇴사 처리' })
  await expect(resignBtn).toBeVisible()
  await resignBtn.click()
  await expect(row.getByText('기록은 그대로 남습니다')).toBeVisible()
  await row.getByRole('button', { name: '확인' }).click()

  // 감사 기준: 재직 목록에서 사라진다 (이름순으로 훑을 때 끼어들지 않는다)
  await page.waitForTimeout(1200)
  await page.goto(`/admin/members?tab=users&q=${encodeURIComponent(NAME)}`)
  await dismissGlobalModals(page)
  await expect(page.locator('tbody tr', { hasText: NAME })).toHaveCount(0)

  // 감사 기준: 퇴사자 탭에 있고 퇴사일이 보이고 단추가 되돌리기로 바뀐다
  await page.goto(`/admin/members?tab=resigned&q=${encodeURIComponent(NAME)}`)
  await dismissGlobalModals(page)
  const resignedRow = page.locator('tbody tr', { hasText: NAME })
  await expect(resignedRow).toHaveCount(1)
  await expect(resignedRow.getByText(/\d{4}-\d{2}-\d{2}/)).toBeVisible()
  await resignedRow.getByRole('button', { name: `${NAME} 작업 더보기` }).click()
  await expect(resignedRow.getByRole('button', { name: '퇴사 취소' })).toBeVisible()
  await expect(resignedRow.getByRole('button', { name: '퇴사 처리' })).toHaveCount(0)
  await page.keyboard.press('Escape')

  // 감사 기준: 뜻이 겹치는 거르개는 도구줄에 없다
  await expect(page.getByRole('combobox', { name: '재직 여부' })).toHaveCount(0)
})

test('구성원 상세가 계정과 재직 기록을 보여 주고 입사일을 고쳐 남긴다', async ({ page }) => {
  await page.goto(`/admin/members/${userId}`)
  await dismissGlobalModals(page)

  await expect(page.getByRole('heading', { name: NAME })).toBeVisible()
  await expect(page.getByText('계정', { exact: true })).toBeVisible()
  await expect(page.getByText('재직 기록', { exact: true })).toBeVisible()
  await expect(page.getByText('소속', { exact: true })).toBeVisible()

  // 퇴사 처리로 들어간 퇴사일이 상세에도 보인다
  await expect(page.locator('#emp-resigned')).not.toHaveValue('')

  await page.locator('#emp-hired').fill('2024-03-04')
  await page.getByRole('button', { name: '저장' }).click()
  await expect(page.getByText('저장됨')).toBeVisible()

  await page.reload()
  await dismissGlobalModals(page)
  await expect(page.locator('#emp-hired')).toHaveValue('2024-03-04')

  // 상세에서 퇴사일을 지우면 되돌리기와 같은 일이 된다
  await page.locator('#emp-resigned').fill('')
  await page.getByRole('button', { name: '저장' }).click()
  await expect(page.getByText('저장됨')).toBeVisible()
  await page.waitForTimeout(800)

  const { data } = await admin.from('member_employment').select('hired_on, resigned_on').eq('user_id', userId).maybeSingle()
  expect(data?.hired_on).toBe('2024-03-04')
  expect(data?.resigned_on).toBeNull()
  const { data: authAfter } = await admin.auth.admin.getUserById(userId)
  expect(authAfter.user.banned_until ?? null).toBeNull()
})
