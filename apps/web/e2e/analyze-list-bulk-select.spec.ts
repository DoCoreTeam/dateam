import { test, expect, type Page } from '@playwright/test'

// 목록 심층분석 — "이전 원문"·"내 분석 문서" 목록의 다중선택/일괄삭제 + 휴지통 토글 E2E.
//
// 검증 대상(사용자 요구):
//  (1) 행 체크박스로 여러 건 선택 → "선택 삭제"로 일괄 처리 가능
//  (2) 휴지통이 체크박스가 아니라 목록↔휴지통 상호배타 토글
//
// 안전장치: 실데이터를 지우지 않는다. 확인 모달까지 열어 문구·대상 건수를 검증하고 **취소**로 닫는다
// (삭제 자체의 소유·상태 검증은 lib/ai-chat/soft-delete-bulk.test.ts 단위테스트가 담당).

const LIST_URL = 'http://localhost:3000/ai-chat/analyze?tab=list'
const DOCS_URL = 'http://localhost:3000/ai-chat/analyze?tab=documents'

async function isAuthed(page: Page): Promise<boolean> {
  return !page.url().includes('/login')
}

/** 첫 접속 시 자동으로 뜨는 패치노트 모달을 닫는다(안 닫으면 backdrop이 모든 클릭을 가로챈다). */
async function dismissChangelog(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog', { name: '패치노트' })
  if (await dialog.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await dialog.getByRole('button', { name: '닫기' }).click()
    await expect(dialog).toHaveCount(0)
  }
}

/** 목록이 그려질 때까지 대기. 행이 하나도 없으면 false(선택 시나리오 skip). */
async function waitForRows(page: Page): Promise<number> {
  await page.waitForLoadState('networkidle')
  await expect(page.getByText('불러오는 중…')).toHaveCount(0, { timeout: 20_000 })
  return page.locator('table.table-base tbody tr').count()
}

for (const [label, url, testId] of [
  ['이전 원문(세션)', LIST_URL, 'bulk-delete-sessions'],
  ['내 분석 문서', DOCS_URL, 'bulk-delete-documents'],
] as const) {
  test(`${label} — 휴지통은 체크박스가 아니라 세그먼트 토글`, async ({ page }) => {
    await page.goto(url)
    if (!(await isAuthed(page))) test.skip(true, '인증 세션 없음 — auth.setup.ts 선행 필요')
    await dismissChangelog(page)

    // 구 UI(휴지통 체크박스)가 남아 있으면 실패해야 한다
    await expect(page.getByRole('checkbox', { name: '휴지통' })).toHaveCount(0)

    const active = page.getByTestId('trash-toggle-active')
    const trash = page.getByTestId('trash-toggle-deleted')
    await expect(active).toBeVisible()
    await expect(trash).toBeVisible()
    await expect(active).toHaveAttribute('aria-pressed', 'true')
    await expect(trash).toHaveAttribute('aria-pressed', 'false')

    await trash.click()
    await expect(trash).toHaveAttribute('aria-pressed', 'true')
    await expect(active).toHaveAttribute('aria-pressed', 'false')
    await expect(page).toHaveURL(/deleted=1/)

    await active.click()
    await expect(page).not.toHaveURL(/deleted=1/)
  })

  test(`${label} — 전체선택 후 선택 삭제 확인 모달까지`, async ({ page }) => {
    await page.goto(url)
    if (!(await isAuthed(page))) test.skip(true, '인증 세션 없음 — auth.setup.ts 선행 필요')
    await dismissChangelog(page)

    const rowCount = await waitForRows(page)
    test.skip(rowCount === 0, '목록이 비어 있어 선택 시나리오를 검증할 수 없음')

    // 선택 전에는 일괄 바가 없다
    await expect(page.getByTestId(testId)).toHaveCount(0)

    const rowChecks = page.locator('table.table-base tbody input.nb-row-check')
    await expect(rowChecks).toHaveCount(rowCount)

    // 1건 선택 → 일괄 바 등장
    await rowChecks.first().check()
    await expect(page.getByText('1개 선택됨')).toBeVisible()

    // 전체선택
    await page.getByTestId('nb-select-all').check()
    await expect(page.getByText(`${rowCount}개 선택됨`)).toBeVisible()

    // 선택 삭제 → 확인 모달(대상 건수 노출) → 취소(실데이터 보존)
    await page.getByTestId(testId).click()
    const dialog = page.locator('text=삭제할까요?')
    await expect(dialog).toBeVisible()
    if (rowCount > 1) await expect(page.getByText(`${rowCount}개`).first()).toBeVisible()
    await page.getByRole('button', { name: '취소' }).click()
    await expect(dialog).toHaveCount(0)

    // 선택 해제로 일괄 바가 사라진다
    await page.getByRole('button', { name: '선택 해제' }).click()
    await expect(page.getByTestId(testId)).toHaveCount(0)
  })
}
