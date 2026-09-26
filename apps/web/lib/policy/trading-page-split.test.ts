/**
 * 한 화면이 다시 쌓이지 않게 — **패널 수를 센다**
 *
 * **왜** (사용자 지적 2026-09-27: 「지금 화면 스크롤은 너무 과한데?」):
 *   `/trading` 한 장이 패널 **12개** + 최근 실행 + 설정 묶음 15개(값 88개)를 세로로 쌓고
 *   있었다. 매일 보는 것은 신호 세 줄인데 그 셋을 보려고 나머지 전부를 지나야 했다.
 *
 *   한 번 나눠 놓아도 다음 기능은 **있는 화면에 한 줄 더 붙이는 쪽**이 언제나 더 쉽다.
 *   그래서 열두 개가 됐던 것이지 누가 잘못 판단한 것이 아니다. 쉬운 쪽을 막지 않으면
 *   같은 자리에 같은 것이 다시 쌓인다.
 *
 * ## 무엇을 세나
 *
 * 화면 파일이 **직접 그리는 절(카드)**의 수다. 패널 부품을 부르는 자리와 자기가 여는
 * `<section>` 을 함께 센다 — 둘 다 사용자에게는 「스크롤해야 할 칸 하나」로 보인다.
 *
 * 상한은 **여섯**이다. 지금 가장 많은 화면이 셋이라 두 배의 여유가 있고,
 * 여섯을 넘으면 그건 화면 하나가 아니라 목록이다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { TRADING_APP_DIR } from './app-dirs.ts'

const WEB = join(import.meta.dirname, '..', '..')
const ROOT = join(WEB, TRADING_APP_DIR)

/** 한 화면이 그려도 되는 절의 수 */
const MAX_PANELS = 6

/**
 * 더 그려도 되는 화면과 **왜**. 「나중에 나눈다」는 사유가 아니다 —
 * 그건 지금 나누라는 뜻이고, 여기 적는 것은 앞으로도 한 화면인 자리다.
 */
const WHY_LONG: Readonly<Record<string, string>> = {}

function pages(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) pages(full, out)
    else if (name === 'page.tsx') out.push(full)
  }
  return out
}

/**
 * 이 화면이 그리는 절의 수.
 *
 * **여는 태그만 센다** — 닫는 태그까지 세면 두 배가 되고, 자기 닫힘 부품
 * (`<SignalPanel ... />`)은 닫는 태그가 없어 섞으면 셈이 아예 안 맞는다.
 */
function panelCount(src: string): number {
  const components = src.match(/<[A-Z][A-Za-z0-9]*(Panel|List|Coverage|Runs)\b/g) ?? []
  const sections = src.match(/<section\b/g) ?? []
  return components.length + sections.length
}

test('한 화면에 패널이 쌓이지 않는다', () => {
  const found = pages(ROOT)
  assert.ok(found.length >= 5, `트레이딩 화면을 ${found.length}개밖에 못 찾았다 — 규칙이 헛돈다`)

  const heavy = found
    .map((f) => ({ rel: relative(WEB, f), n: panelCount(readFileSync(f, 'utf8')) }))
    .filter((x) => x.n > MAX_PANELS)
    .filter((x) => !(x.rel in WHY_LONG))

  assert.deepEqual(
    heavy.map((x) => `${x.rel} (${x.n}칸)`),
    [],
    `한 화면에 ${MAX_PANELS}칸을 넘게 쌓았다 — 사이드바에 자리를 하나 더 내거나 WHY_LONG 에 사유를 적는다`,
  )
})

test('사이드바 자리마다 실제 화면이 있다 — 갈 곳 없는 줄이 없다', async () => {
  const { TRADING_NAV } = await import('../trading/nav/groups.ts')
  const urls = new Set(
    pages(ROOT).map((f) => {
      const dir = relative(WEB, f).replace(/\/page\.tsx$/, '')
      return `/${dir.slice(TRADING_APP_DIR.length - 'trading'.length)}`.replace('//', '/')
    }),
  )
  const dead = TRADING_NAV.map((n) => n.href).filter((h) => !urls.has(h))
  assert.deepEqual(dead, [], `사이드바에 있는데 화면이 없다 — 눌러 놓고 아무 일도 안 난다: ${dead.join(', ')}`)
})

test('화면마다 사이드바에 자리가 있다 — 숨은 화면이 없다', async () => {
  const { TRADING_NAV } = await import('../trading/nav/groups.ts')
  const inNav = new Set(TRADING_NAV.map((n) => n.href))
  const hidden = pages(ROOT)
    .map((f) => {
      const dir = relative(WEB, f).replace(/\/page\.tsx$/, '')
      return `/${dir.slice(TRADING_APP_DIR.length - 'trading'.length)}`.replace('//', '/')
    })
    .filter((u) => !inNav.has(u))
  assert.deepEqual(hidden, [], `메뉴에 없는 화면이다 — 주소를 아는 사람만 들어간다: ${hidden.join(', ')}`)
})

test('메뉴 이름을 화면이 직접 안 적는다', () => {
  /**
   * 사이드바와 화면 제목이 같은 상수를 읽어야 한다(§2-3-3 N-4).
   * 화면이 제목을 직접 적으면 사이드바에서 부르는 이름과 갈리고,
   * 사용자는 그 둘을 다른 화면으로 읽는다.
   */
  for (const f of pages(ROOT)) {
    const src = readFileSync(f, 'utf8')
    const header = /<PageHeader[\s\S]{0,200}?title=\{([^}]+)\}/.exec(src)
    assert.ok(header, `${relative(WEB, f)} 에 PageHeader title 이 없다`)
    assert.match(
      header[1],
      /TRADING_NAV_LABEL\./,
      `${relative(WEB, f)} 가 제목을 직접 적는다 — lib/terms 의 TRADING_NAV_LABEL 을 쓴다`,
    )
  }
})
