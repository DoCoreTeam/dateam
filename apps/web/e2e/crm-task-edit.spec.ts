import { test, expect } from '@playwright/test'

/**
 * 할 일을 만든 뒤에 고칠 수 있나 (F-10 실브라우저)
 *
 * **왜 있나**(사용자 지적 2026-10-06): *"할일도 일정 수정할 수 있어야지
 * 내용이랑 삭제만 있네 CRUD 정책 지켜"*. 서버는 처음부터 `title`·`startAt`·`dueAt` 를
 * 받고 있었고 화면만 안 불렀다 — 그래서 **저장이 실제로 남는지**가 이 확인의 전부다.
 * 화면만 바뀌고 서버에 안 간 상태는 새로고침 전까지 똑같아 보인다.
 *
 * 만들고 → 고치고 → 새로고침해서 남았나 보고 → 지운다.
 * 실데이터를 안 건드리려고 **내가 만든 한 건**만 다루고, 끝에 치운다.
 * (목록과 레코드 상세 패널 둘 다 본다 — 같은 모달을 쓰지만 부르는 자리가 다르다)
 */
/** 같은 이름이 겹치지 않게 — 돌릴 때마다 다른 값을 넣는다(스크립트에 시계를 두지 않는다) */
const STAMP = String(process.env.CRUD_STAMP ?? 'x')
const TITLE = `QA 수정확인 ${STAMP}`
const TITLE2 = `QA 수정확인 ${STAMP} 고침`

test('할 일의 제목·시작·마감을 만든 뒤에 고친다', async ({ page }) => {
  await page.goto('/crm/tasks')
  await expect(page.getByRole('heading', { name: '할 일' })).toBeVisible({ timeout: 20000 })

  // 만들기 — 추가 줄의 제목 칸
  await page.getByLabel('할 일', { exact: true }).first().fill(TITLE)
  await page.getByRole('button', { name: '추가', exact: true }).click()
  const row = page.locator('tr', { hasText: TITLE }).first()
  await expect(row).toBeVisible({ timeout: 15000 })

  // 만든 직후 값을 적어 둔다
  const beforeStart = (await row.locator('td').nth(2).innerText()).trim()
  const beforeDue = (await row.locator('td').nth(3).innerText()).trim()
  console.log('[만든 뒤] 시작=', beforeStart, '마감=', beforeDue)

  // 고치기
  await row.getByRole('button', { name: `${TITLE} 수정` }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()

  await dialog.getByLabel('할 일', { exact: true }).fill(TITLE2)
  await dialog.getByLabel('시작', { exact: true }).fill('2026-11-02')
  await dialog.getByLabel('마감', { exact: true }).fill('2026-11-20')
  await dialog.getByRole('button', { name: '저장', exact: true }).click()
  await expect(dialog).toBeHidden({ timeout: 15000 })

  // 새로고침해도 남나 — 저장이 아니라 **화면만** 바뀐 것인지 가른다
  await page.reload()
  const row2 = page.locator('tr', { hasText: TITLE2 }).first()
  await expect(row2).toBeVisible({ timeout: 15000 })
  const afterStart = (await row2.locator('td').nth(2).innerText()).trim()
  const afterDue = (await row2.locator('td').nth(3).innerText()).trim()
  console.log('[고친 뒤] 시작=', afterStart, '마감=', afterDue)

  expect(afterStart).toContain('2026-11-02')
  expect(afterDue).toContain('2026-11-20')

  // 날짜 비우기가 «안 정함»으로 가나
  await row2.getByRole('button', { name: `${TITLE2} 수정` }).click()
  const d2 = page.getByRole('dialog')
  await d2.getByLabel('마감', { exact: true }).fill('')
  await d2.getByRole('button', { name: '저장', exact: true }).click()
  await expect(d2).toBeHidden({ timeout: 15000 })
  await page.reload()
  const row3 = page.locator('tr', { hasText: TITLE2 }).first()
  await expect(row3).toBeVisible({ timeout: 15000 })
  console.log('[마감 비운 뒤] 마감=', (await row3.locator('td').nth(3).innerText()).trim())

  // 치운다 — 내가 만든 것만
  page.on('dialog', (d) => void d.dismiss())
  await row3.getByRole('button', { name: `${TITLE2} 삭제` }).click()
  await page.getByRole('button', { name: '삭제', exact: true }).last().click()
  await expect(page.locator('tr', { hasText: TITLE2 })).toHaveCount(0, { timeout: 15000 })
})

test('딜 상세의 할 일 패널에서도 고치고 지운다', async ({ page }) => {
  const title = `QA 패널확인 ${STAMP}`
  const titleFixed = `${title} 고침`

  await page.goto('/crm/deals')
  // 목록 카드/행에서 상세로 — 첫 건이면 된다(어느 딜인지는 이 확인과 무관하다)
  const first = page.locator('a[href^="/crm/deals/"]').first()
  await expect(first).toBeVisible({ timeout: 20000 })
  await first.click()
  await expect(page).toHaveURL(/\/crm\/deals\/[^/]+/, { timeout: 20000 })

  // 패널에서 하나 만든다
  const composer = page.getByLabel('다음에 할 일')
  await expect(composer).toBeVisible({ timeout: 20000 })
  await composer.fill(title)
  await page.getByRole('button', { name: '추가', exact: true }).click()

  const item = page.locator('li', { hasText: title }).first()
  await expect(item).toBeVisible({ timeout: 15000 })
  console.log('[패널 · 만든 뒤]', (await item.innerText()).replace(/\n/g, ' | '))

  // 고친다
  await item.getByRole('button', { name: `${title} 수정` }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('할 일', { exact: true }).fill(titleFixed)
  await dialog.getByLabel('마감', { exact: true }).fill('2026-12-15')
  await dialog.getByRole('button', { name: '저장', exact: true }).click()
  await expect(dialog).toBeHidden({ timeout: 15000 })

  await page.reload()
  const item2 = page.locator('li', { hasText: titleFixed }).first()
  await expect(item2).toBeVisible({ timeout: 20000 })
  const text = (await item2.innerText()).replace(/\n/g, ' | ')
  console.log('[패널 · 고친 뒤]', text)
  expect(text).toContain('2026-12-15')

  // 지운다 — 확인창을 거친다
  await item2.getByRole('button', { name: `${titleFixed} 삭제` }).click()
  await page.getByRole('button', { name: '삭제', exact: true }).last().click()
  await expect(page.locator('li', { hasText: titleFixed })).toHaveCount(0, { timeout: 15000 })
})
