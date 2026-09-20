/**
 * 오래 기다리는 자리는 무엇을 하는 중인지 말한다 (사용자 지적 2026-09-20)
 *
 * *"우리 정책상 이런식으로 작업이 오래 걸리는거는 사용자 눈에 정확하게 어떤 동작중인지
 * 보이게 하는게 있을텐데?"*
 *
 * 있었다. `lib/meeting/digest-progress.ts` 가 v0.7.684 에 생겼고 미팅 끝내기가 위임해 썼다.
 * 그런데 그 규칙이 **코드 한 곳에만** 있고 정책 문서에 없어서, 옆 화면들은 그것을 못 봤다.
 * 버전 규칙이 열일곱 판 동안 안 지켜진 것과 같은 구멍이다.
 *
 * ## 목록을 손으로 적지 않는다
 *
 * 「오래 걸리는 자리」를 사람이 적으면 새 화면이 생길 때 아무도 목록에 안 넣는다.
 * 그래서 **창구의 `maxDuration` 에서 뽑는다** — 60초 이상을 선언한 창구를
 * 화면이 부르고, 그 화면에 `busy` 로 잠기는 단추가 있으면 그 자리는 «사람이 기다리는 자리»다.
 * 크론·워커 창구는 화면이 안 부르므로 저절로 빠진다.
 *
 * ## 래칫
 *
 * 아직 안 고친 자리는 `KNOWN_GAPS` 에 적혀 있다. 이 목록은 **줄어들기만 한다** —
 * 새 자리가 늘면 가드가 실패한다. 「나중에」로 미룬 것이 조용히 늘어나지 않게 하는 장치다.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..', '..')

/** 이 시간 이상을 선언한 창구는 사람이 눈으로 기다리기엔 길다 */
const LONG_MS_SECONDS = 60

/** 진행 한 줄을 그리는 것으로 인정하는 부품·함수 */
/*
  공용 부품(`<WaitProgress>`)으로 그리거나, 적어도 **공용 순수 함수**가 문구와 문턱을 정하면 인정한다.
  리드 입력처럼 이미 제 덮개(AXLoadingOverlay)를 가진 화면까지 부품을 바꿔 끼우게 하면
  멀쩡한 화면을 흔들게 된다 — 중요한 것은 «같은 말과 같은 문턱»이지 같은 태그가 아니다.
*/
const PROGRESS_MARKS = [
  'WaitProgress', 'waitProgress', 'digestProgress', 'finishProgress', 'quoteWaitProgress',
]

/**
 * 아직 공용 부품으로 안 옮긴 자리 — **줄어들기만 한다.**
 *
 * 2026-09-20 에 전수로 세니 기다리는 자리 13곳 중 11곳이 공용 부품을 안 쓰고 있었다.
 * 같은 판에서 전부 옮겨 **목록이 비었다.**
 *
 * 비었다고 지우지 않는다 — 다음에 한 곳이 빠지면 여기에 적으려는 손이 먼저 멈춰야 한다.
 * 적는 것은 «괜찮다»는 뜻이 아니라 **조용히 넘어가지 않겠다**는 뜻이고,
 * 아래 「줄어들기만 한다」 단정이 그 둘을 양쪽에서 잠근다.
 */
const KNOWN_GAPS: readonly { file: string; why: string }[] = []
const GAP_FILES = KNOWN_GAPS.map((g) => g.file)

function walk(dir: string, ext: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, ext, out)
    else if (name.endsWith(ext)) out.push(p)
  }
  return out
}

/** 60초 이상을 선언한 창구의 주소 */
function longRoutes(): Map<string, number> {
  const out = new Map<string, number>()
  for (const file of walk(join(ROOT, 'app', 'api'), 'route.ts')) {
    const m = /export const maxDuration = (\d+)/.exec(readFileSync(file, 'utf8'))
    if (!m || Number(m[1]) < LONG_MS_SECONDS) continue
    const url = file.slice(join(ROOT, 'app').length).replace(/\/route\.ts$/, '')
    out.set(url, Number(m[1]))
  }
  return out
}

/** 사람이 결과를 기다리는 자리 — 긴 창구를 부르고, 도는 동안 잠기는 단추가 있다 */
function waitingScreens(): Map<string, string[]> {
  const routes = longRoutes()
  const hits = new Map<string, string[]>()
  for (const dir of ['components', 'app']) {
    for (const file of walk(join(ROOT, dir), '.tsx')) {
      const src = readFileSync(file, 'utf8')
      if (!/disabled=\{[^}]*\b(busy|running|saving|pending|loading)\b/.test(src)) continue
      const called = [...routes.keys()].filter(
        (u) => src.includes(`'${u}'`) || src.includes(`"${u}"`) || src.includes(`\`${u}`))
      if (called.length > 0) hits.set(file.slice(ROOT.length + 1), called)
    }
  }
  return hits
}

const SCREENS = waitingScreens()

test('가드가 실제로 화면을 찾고 있다 — 경로가 틀리면 조용히 0건이 된다', () => {
  assert.ok(SCREENS.size >= 10,
    `기다리는 자리를 ${SCREENS.size}곳만 찾았다 — 훑는 규칙이 헛돌고 있다`)
  assert.ok([...SCREENS.keys()].some((f) => f.endsWith('components/ui/crm/QuoteFromFileModal.tsx')),
    '이 가드를 있게 한 그 화면을 못 찾고 있다')
})

test('★ 60초 넘게 기다리는 자리는 무엇을 하는 중인지 말한다', () => {
  const missing: string[] = []
  for (const [file, urls] of SCREENS) {
    const src = readFileSync(join(ROOT, file), 'utf8')
    if (PROGRESS_MARKS.some((m) => src.includes(m))) continue
    if (GAP_FILES.includes(file)) continue
    missing.push(`${file}  (${urls.join(', ')})`)
  }
  assert.deepEqual(missing, [],
    '오래 걸리는데 화면이 무엇을 하는 중인지 말하지 않는다.\n' +
    'components/ui/WaitProgress 와 순수 함수(quote-read-progress · digest-progress)를 쓰라.\n' +
    missing.map((m) => `  - ${m}`).join('\n'))
})

test('★ 안 고친 자리 목록은 줄어들기만 한다 — 「나중에」가 조용히 늘지 않게', () => {
  const stillMissing = [...SCREENS.keys()].filter((f) => {
    const src = readFileSync(join(ROOT, f), 'utf8')
    return !PROGRESS_MARKS.some((m) => src.includes(m))
  })
  const grew = stillMissing.filter((f) => !GAP_FILES.includes(f))
  assert.deepEqual(grew, [], `진행 표시 없는 자리가 새로 늘었다:\n${grew.join('\n')}`)

  const fixed = GAP_FILES.filter((f) => !stillMissing.includes(f))
  assert.deepEqual(fixed, [],
    `고쳐 놓고 목록에서 안 뺐다 — 목록이 사실과 달라지면 아무도 안 믿는다:\n${fixed.join('\n')}`)
})

test('★ 안 옮긴 자리마다 사유가 적혀 있다 — 사유 없는 예외는 구멍이다', () => {
  for (const g of KNOWN_GAPS) {
    assert.ok(g.why.length > 10, `${g.file} 에 사유가 없다`)
  }
})

test('★ 견적 두 자리는 같은 부품과 같은 함수를 쓴다 — 같은 성격이 화면마다 다른 말을 하면 안 된다', () => {
  for (const f of [
    'components/ui/crm/QuoteFromFileModal.tsx',
    'components/ui/crm/QuoteFillPanel.tsx',
  ]) {
    const src = readFileSync(join(ROOT, f), 'utf8')
    assert.match(src, /quoteWaitProgress\(/, `${f} 가 진행 문구를 제 손으로 짓고 있다`)
    assert.match(src, /<WaitProgress\b/, `${f} 가 공용 부품을 안 쓴다`)
  }
})
