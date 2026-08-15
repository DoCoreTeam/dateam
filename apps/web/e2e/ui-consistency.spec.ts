import { test, expect, type Page } from '@playwright/test'
import { dismissGlobalModals } from './_helpers'

// 렌더된 화면의 **치수 일관성** 검사.
//
// 왜 E2E인가: 여기서 잡는 것들은 정적 분석으로는 보이지 않는다. 클래스도 토큰도 다 맞는데
//   **실제로 그려 놓고 보면 어긋나 있는** 종류다. 사용자가 직접 짚은 두 가지가 그랬다:
//     · "표 높이만 해도 변하자나 같은 값인데"  → /ci/inbox 탭을 옮기면 행이 79px ↔ 87px로 출렁였다
//     · "드롭다운이랑 버튼 쪽이랑 위아래 안맞는거 안보여?" → 셀렉트가 버튼보다 10px 아래에 있었다
//   tsc·단위·design:check가 전부 초록인 채로 통과하던 것들이다.

/** 로그인 세션이 아니면 검사 자체가 무의미하다 — graceful skip. */
async function ready(page: Page, url: string): Promise<boolean> {
  await page.goto(url)
  if (page.url().includes('/login')) return false
  await dismissGlobalModals(page)
  await page.waitForLoadState('networkidle')
  return true
}

const heights = (page: Page, selector: string) =>
  page.locator(selector).evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)))

/** 가장 흔한 값 = 그 목록의 기본 리듬. 제목이 길어 두 줄이 되는 행은 소수이고, 그건 정상이다. */
function baseHeight(list: number[]): number {
  const count = new Map<number, number>()
  for (const h of list) count.set(h, (count.get(h) ?? 0) + 1)
  let best = list[0]
  count.forEach((n, h) => { if (n > (count.get(best) ?? 0)) best = h })
  return best
}

test('수집함: 탭을 옮겨도 표의 기본 행 높이가 같다', async ({ page }) => {
  test.setTimeout(90_000)
  test.skip(!(await ready(page, '/ci/inbox')), '인증 세션 없음')
  const all = await heights(page, 'table tbody tr')
  test.skip(all.length === 0, '수집함이 비어 있어 행 높이를 비교할 수 없음')

  test.skip(!(await ready(page, '/ci/inbox?tab=review')), '인증 세션 없음')
  const review = await heights(page, 'table tbody tr')
  test.skip(review.length === 0, '검토 필요 항목이 없어 비교할 수 없음')

  // 긴 제목이 두 줄로 접히는 행은 정상(내용이 많으면 커진다). 기본 리듬이 탭마다 달라지면 안 된다.
  expect(baseHeight(review), `탭마다 기본 행 높이가 다르다 (전체 ${baseHeight(all)}px vs 검토 ${baseHeight(review)}px)`)
    .toBe(baseHeight(all))
})

test('수집함: 행 안의 컨트롤이 행 높이를 좌우하지 않는다', async ({ page }) => {
  test.setTimeout(90_000)
  test.skip(!(await ready(page, '/ci/inbox?tab=review')), '인증 세션 없음')
  test.skip((await page.locator('table tbody tr').count()) === 0, '검토 필요 항목 없음')

  // 셀렉트·버튼 묶음이 접히면 그 행만 커진다(실측: 주제 칸 61px·작업 칸 96px → 행 87·121px).
  // 컨트롤 칸은 항상 썸네일보다 낮아야 한다 = 행 높이는 콘텐츠가 정하지 컨트롤이 정하지 않는다.
  const bad = await page.locator('table tbody tr').evaluateAll((rows) => {
    const head = Array.from(document.querySelectorAll('table thead th')).map((t) => (t.textContent ?? '').trim())
    const cellH = (td: Element) => Math.round(Array.from(td.children)
      .reduce((m, c) => Math.max(m, c.getBoundingClientRect().height), 0))
    return rows.flatMap((tr) => {
      const tds = Array.from(tr.querySelectorAll('td'))
      const thumb = tds[head.indexOf('썸네일')]
      if (!thumb) return []
      const limit = cellH(thumb)
      return ['주제', '작업']
        .map((name) => ({ name, td: tds[head.indexOf(name)] }))
        .filter((c) => c.td && cellH(c.td) > limit)
        .map((c) => `${c.name} ${cellH(c.td)}px > 썸네일 ${limit}px`)
    })
  })
  expect(bad, `컨트롤이 접혀 행을 키우고 있다:\n  ${bad.join('\n  ')}`).toEqual([])
})

test('채널 상세: 같은 줄의 셀렉트와 버튼이 같은 높이·같은 바닥선', async ({ page }) => {
  test.setTimeout(90_000)
  test.skip(!(await ready(page, '/ci/monitoring')), '인증 세션 없음')

  const firstRow = page.locator('table tbody tr').first()
  test.skip((await firstRow.count()) === 0, '등록된 채널이 없어 상세를 열 수 없음')
  await firstRow.click()
  await page.waitForURL(/\/ci\/channels\//, { timeout: 20_000 })
  await dismissGlobalModals(page)

  const box = await page.locator('#ch-window').boundingBox()
  const btn = await page.getByRole('button', { name: /채널 정보 새로고침/ }).boundingBox()
  expect(box && btn, '수집 기간 셀렉트 또는 새로고침 버튼을 찾지 못함').toBeTruthy()

  // 라벨이 붙은 컨트롤과 라벨 없는 버튼이 같은 줄에 설 때 center 정렬이면 라벨 높이만큼 밀린다.
  expect(Math.round(box!.height), '셀렉트와 버튼의 높이가 다르다').toBe(Math.round(btn!.height))
  expect(Math.abs((box!.y + box!.height) - (btn!.y + btn!.height)), '바닥선이 어긋난다').toBeLessThanOrEqual(1)
})
