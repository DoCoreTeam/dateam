import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { dismissGlobalModals } from './_helpers'

/**
 * 조직 삭제 이관 실브라우저 검사 (P0019 I08)
 *
 * 실제 조직도에 일회용 부서 둘을 잠깐 만들었다가 검사 끝에 지운다.
 * 진짜 부서는 건드리지 않는다.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const admin: any = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
)

const ROOT = 'f2325a00-78f9-4386-b37c-ac9f8b3bd76a'
const FROM = 'I08 일회용 지울부서'
const TO = 'I08 일회용 받을부서'
let fromId = ''
let toId = ''
let eventId = ''
let actorId = ''

test.beforeAll(async () => {
  const { data: actor } = await admin.from('profiles').select('id').eq('role', 'admin').is('deleted_at', null).limit(1).single()
  actorId = actor.id
  const { data, error } = await admin.from('org_nodes').insert([
    { type: 'department', name: FROM, parent_id: ROOT, display_order: 9998 },
    { type: 'department', name: TO, parent_id: ROOT, display_order: 9999 },
  ]).select('id, name')
  if (error) throw error
  fromId = data.find((n: { name: string }) => n.name === FROM).id
  toId = data.find((n: { name: string }) => n.name === TO).id

  const { data: ev, error: evErr } = await admin.from('calendar_events').insert({
    user_id: actorId, title: 'I08 일회용 일정', start_at: new Date().toISOString(), department_id: fromId,
  }).select('id').single()
  if (evErr) throw evErr
  eventId = ev.id
})

test.afterAll(async () => {
  if (eventId) await admin.from('calendar_events').delete().eq('id', eventId)
  for (const id of [fromId, toId].filter(Boolean)) {
    await admin.from('org_nodes').delete().eq('id', id)
  }
})

async function deleteButtonOf(page: import('@playwright/test').Page, name: string) {
  const label = page.getByText(name, { exact: true }).first()
  const card = label.locator('xpath=ancestor::*[@aria-roledescription="draggable"][1]')
  return card.locator('button[title="삭제"]').first()
}

test('기록이 붙은 조직은 건수를 보이고 갈 곳을 물은 뒤 옮기고 지운다', async ({ page }) => {
  await page.goto('/admin/members?tab=org')
  await dismissGlobalModals(page)

  await (await deleteButtonOf(page, FROM)).click()

  // 감사 기준: 표별 건수가 보인다
  await expect(page.getByRole('heading', { name: '조직 삭제' })).toBeVisible()
  await expect(page.getByText('일정 1건')).toBeVisible()

  // 감사 기준: 대상을 안 고르면 삭제가 안 눌린다
  const deleteBtn = page.getByRole('dialog').getByRole('button', { name: '옮기고 삭제' })
  await expect(deleteBtn).toBeDisabled()

  await page.locator('#org-transfer-target').selectOption({ label: TO })
  await expect(deleteBtn).toBeEnabled()
  await deleteBtn.click()

  // 감사 기준: 외래키 오류가 안 뜨고 실제로 지워진다
  await expect(page.getByRole('heading', { name: '조직 삭제' })).toBeHidden({ timeout: 15000 })
  await expect(page.getByText('violates foreign key constraint')).toHaveCount(0)

  await page.waitForTimeout(1500)
  const { data: gone } = await admin.from('org_nodes').select('id').eq('id', fromId).maybeSingle()
  expect(gone).toBeNull()
  const { data: moved } = await admin.from('calendar_events').select('department_id').eq('id', eventId).single()
  expect(moved.department_id).toBe(toId)
})

test('기록이 0건인 조직은 물어보지 않고 바로 지운다', async ({ page }) => {
  // 앞 검사에서 일정이 넘어왔으니 다시 떼어 0건으로 만든다
  await admin.from('calendar_events').update({ department_id: null }).eq('id', eventId)

  await page.goto('/admin/members?tab=org')
  await dismissGlobalModals(page)
  await (await deleteButtonOf(page, TO)).click()

  await expect(page.getByText('붙어 있는 기록 0건')).toBeVisible()
  await expect(page.locator('#org-transfer-target')).toHaveCount(0)
  // 조직도 카드의 삭제 단추도 이름이 '삭제'라 창 안으로 범위를 좁힌다
  const deleteBtn = page.getByRole('dialog').getByRole('button', { name: '삭제', exact: true })
  await expect(deleteBtn).toBeEnabled()
  await deleteBtn.click()

  await expect(page.getByRole('heading', { name: '조직 삭제' })).toBeHidden({ timeout: 15000 })
  await page.waitForTimeout(1500)
  const { data: gone } = await admin.from('org_nodes').select('id').eq('id', toId).maybeSingle()
  expect(gone).toBeNull()
})
