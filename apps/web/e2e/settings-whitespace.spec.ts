import { test, expect, type Page } from '@playwright/test'
import { dismissGlobalModals } from './_helpers'

/**
 * 설정 카드의 «빈 자리»를 잰다.
 *
 * 왜 자를 먼저 만드나: 「카드가 허전하다」는 눈으로 보면 화면마다 판정이 갈린다.
 *   실측 2026-09-20 영업 CRM 설정은 카드 높이 합 8,634px 중 3,732px(43%)이 빈 자리였는데,
 *   그 자리는 `align-items: stretch` 가 짧은 카드를 옆 카드 높이에 맞춰 늘려서 생긴 것이었다.
 *   내용이 없는데 테두리만 아래로 내려간 자리다 — 사람이 세지 않으면 다시 늘어난다.
 *
 * 무엇을 빈 자리로 세나: 카드 안 마지막 내용의 바닥부터 카드 안여백 안쪽 바닥까지.
 *   카드가 스스로 갖는 안여백(padding)은 빈 자리가 아니다 — 그건 설계다.
 *
 * 문턱 5%: 0% 는 불가능하다(줄 높이와 글꼴 하강부가 남는다). 카드 스무 개에
 *   한 줄씩 남는 정도가 5% 언저리이고, 그 위는 눈에 보이는 빈 상자다.
 */
const MAX_EMPTY_RATIO = 0.05

interface Whitespace {
  cards: number
  totalHeight: number
  emptyHeight: number
  ratio: number
  /** 빈 자리가 큰 카드부터 — 어디를 고쳐야 하는지 검사가 말해 준다 */
  worst: { title: string; empty: number; height: number }[]
}

async function measureSettingsWhitespace(page: Page): Promise<Whitespace> {
  return page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll<HTMLElement>('.settings-card'))
      .filter((el) => el.offsetParent !== null && el.getBoundingClientRect().height > 0)

    let totalHeight = 0
    let emptyHeight = 0
    const worst: { title: string; empty: number; height: number }[] = []

    for (const card of cards) {
      const rect = card.getBoundingClientRect()
      const pad = parseFloat(getComputedStyle(card).paddingBottom) || 0

      // 마지막 «내용»의 바닥. 자식이 없으면 카드 위쪽을 바닥으로 본다(통째로 빈 카드)
      let contentBottom = rect.top
      for (const child of Array.from(card.querySelectorAll<HTMLElement>('*'))) {
        const r = child.getBoundingClientRect()
        if (r.height === 0 && r.width === 0) continue
        if (r.bottom > contentBottom) contentBottom = r.bottom
      }

      const empty = Math.max(0, rect.bottom - pad - contentBottom)
      totalHeight += rect.height
      emptyHeight += empty
      const title = card.querySelector('.settings-card-title')?.textContent?.trim() ?? '(제목 없음)'
      worst.push({ title, empty: Math.round(empty), height: Math.round(rect.height) })
    }

    worst.sort((a, b) => b.empty - a.empty)
    return {
      cards: cards.length,
      totalHeight: Math.round(totalHeight),
      emptyHeight: Math.round(emptyHeight),
      ratio: totalHeight === 0 ? 0 : emptyHeight / totalHeight,
      worst: worst.slice(0, 5),
    }
  })
}

function report(where: string, m: Whitespace): string {
  const lines = m.worst.map((w) => `    ${w.empty}px 빔 / ${w.height}px — ${w.title}`)
  return [
    `${where}: 카드 ${m.cards}개, 높이 합 ${m.totalHeight}px 중 빈 자리 ${m.emptyHeight}px `
      + `(${(m.ratio * 100).toFixed(1)}%, 문턱 ${MAX_EMPTY_RATIO * 100}%)`,
    ...lines,
  ].join('\n')
}

async function openSettings(page: Page, path: string): Promise<void> {
  // 실측 조건을 고정한다 — 폭이 바뀌면 열 수가 바뀌고 빈 자리도 같이 바뀐다
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(path)
  await dismissGlobalModals(page)
  await page.locator('.settings-card').first().waitFor({ state: 'visible', timeout: 15000 })
  // 카드 안의 값이 서버에서 늦게 오면 높이가 더 자란다 — 멎은 뒤에 잰다
  await page.waitForLoadState('networkidle').catch(() => {})
}

test('콘텐츠 인텔리전스 설정 — 카드가 빈 자리를 남기지 않는다', async ({ page }) => {
  await openSettings(page, '/ci/settings')
  const m = await measureSettingsWhitespace(page)
  expect(m.cards, '잴 카드가 없다 — 화면이 안 떴거나 선택자가 바뀌었다').toBeGreaterThan(0)
  expect(m.ratio, report('/ci/settings', m)).toBeLessThanOrEqual(MAX_EMPTY_RATIO)
})

/** 관리자 설정은 탭마다 다른 카드가 뜬다 — 탭 하나가 통과해도 옆 탭은 늘어나 있을 수 있다 */
for (const tab of ['branding', 'ai', 'integrations', 'system']) {
  test(`관리자 설정 ${tab} 탭 — 카드가 빈 자리를 남기지 않는다`, async ({ page }) => {
    await openSettings(page, `/admin/settings?tab=${tab}`)
    const m = await measureSettingsWhitespace(page)
    expect(m.cards, '잴 카드가 없다 — 화면이 안 떴거나 선택자가 바뀌었다').toBeGreaterThan(0)
    expect(m.ratio, report(`/admin/settings?tab=${tab}`, m)).toBeLessThanOrEqual(MAX_EMPTY_RATIO)
  })
}

test('영업 CRM 설정 — 카드가 빈 자리를 남기지 않는다', async ({ page }) => {
  await openSettings(page, '/crm/settings')
  const m = await measureSettingsWhitespace(page)
  expect(m.cards, '잴 카드가 없다 — 화면이 안 떴거나 선택자가 바뀌었다').toBeGreaterThan(0)
  expect(m.ratio, report('/crm/settings', m)).toBeLessThanOrEqual(MAX_EMPTY_RATIO)
})
