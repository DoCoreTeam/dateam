// lib/ui/card-standard.test.ts — **카드 여백 표준** 가드
//
// 왜 생겼나(실측 v0.7.676, 사용자 지적):
//   「모든 걸 구현할때마다 AI웹 검색 한도 저쪽 영역처럼 디자인을 다 깨버리네?
//     왜 계속 동일한 이슈야 앞으로 절대 만들지마」
//
// /ci/trends?tab=signals 의 수집 상태 줄이 **computed padding 0px** 로 렌더돼
// 글과 버튼이 카드 가장자리에 붙어 있었다. 원인은 화면이 아니라 **부품**이었다 —
// globals.css 의 `.card` 가 배경·모서리·그림자·테두리는 정하면서 **안쪽 여백은 안 정해서**,
// 여백을 174개 호출처 전부가 손으로 적고 있었다(실측: 손으로 적은 값 11가지 · 아예 안 적은 곳 28곳).
// 잊으면 조용히 깨지고, tsc·lint·design:check 어느 것도 그 누락을 보지 못했다.
//
// 더 나쁜 것은 **여백 없음이 두 가지 뜻을 겸했다**는 점이다:
//   ① 전면(full-bleed)형이다 — 안에 자기 여백을 가진 머리줄·표가 들어간다
//   ② 적는 걸 잊었다        — 그냥 깨진 것
// 같은 신호가 둘을 뜻하니 사람도 기계도 구분할 수 없었다. **그 모호함이 재발의 뿌리다.**
//
// 그래서 셋을 잠근다:
//   · `.card` 는 자기 여백을 스스로 갖는다(`--card-pad`)      → 잊어도 안 깨진다
//   · 전면형은 `.card-flush` 로 **말로** 밝힌다               → ①과 ②가 구분된다
//   · 화면이 카드 여백을 0 으로 되돌리지 않는다               → 침묵의 회귀를 막는다

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { walkFiles, read } from './component-scan.ts'

const GLOBALS = 'app/globals.css'

/**
 * 주석은 지우되 **줄 수는 보존**한다.
 * 공용 `stripComments` 는 블록 주석을 통째로 없애 줄이 밀린다 — 그러면 위반을 알려 주는
 * `파일:줄` 이 실제 파일과 어긋나서, 고치러 간 사람이 엉뚱한 줄을 본다(실측: 553 → 537).
 */
function stripKeepLines(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
}

function sources(): { file: string; src: string }[] {
  return [...walkFiles('app', ['.tsx']), ...walkFiles('components', ['.tsx'])]
    .map((file) => ({ file, src: stripKeepLines(read(file)) }))
}

/**
 * 그 줄의 `className` 이 `card` 를 **낱말로** 갖는가.
 * `card-header`·`table-card`·`card-flush` 는 다른 낱말이므로 낱말 단위로 쪼개 비교한다
 * (정규식 `\bcard\b` 는 하이픈을 경계로 봐서 `card-header` 까지 잡는다 — 그래서 쓰지 않는다).
 */
function hasCardClass(line: string): boolean {
  for (const m of line.matchAll(/className=\{?[`"]([^`"]*)[`"]/g)) {
    if (m[1].split(/[\s${}]+/).includes('card')) return true
  }
  return false
}

test('카드 부품이 자기 안쪽 여백을 갖는다 — 화면에 떠넘기지 않는다', () => {
  // 이 셋 중 하나라도 사라지면 v0.7.676 이전 상태로 되돌아간다:
  // 여백이 없는 카드가 «전면형인지 잊은 것인지» 알 수 없어지고, 잊으면 화면이 깨진다.
  const css = read(GLOBALS)

  assert.match(css, /--card-pad:\s*[^;]+;/,
    `globals.css 에 --card-pad 토큰이 없다. 카드 여백은 토큰 한 곳에서 정한다(§1).`)

  assert.match(css, /:where\(\.card\)\s*\{[^}]*padding:\s*var\(--card-pad\)/,
    `globals.css 의 .card 가 기본 여백을 잃었다.\n`
    + `  :where(.card) { padding: var(--card-pad); } 를 되살릴 것.\n`
    + `  특정도 0(:where)이라야 이미 자기 값을 적어 둔 화면들이 그대로 이긴다(무회귀).`)

  assert.match(css, /\.card-flush\s*\{[^}]*padding:\s*0/,
    `.card-flush 가 없다. 전면(full-bleed) 카드가 여백 0 을 «말로» 밝힐 방법이 사라진다.`)
})

test('화면이 카드 여백을 0 으로 되돌리지 않는다 — 전면형이면 card-flush 로 밝힌다', () => {
  // 인라인 `padding: 0` 은 «전면형이다»와 «여백을 없애고 싶다»를 구분해 주지 않는다.
  // v0.7.676 에서 5곳을 card-flush 로 이관하고 **0건에서 잠갔다.**
  const offenders: string[] = []
  for (const { file, src } of sources()) {
    src.split('\n').forEach((line, i) => {
      if (!hasCardClass(line)) return
      if (/\bcard-flush\b/.test(line)) return
      if (/padding:\s*['"`]?0['"`]?\s*[,}]/.test(line)) offenders.push(`${file}:${i + 1}`)
    })
  }
  assert.deepEqual(offenders, [],
    `카드에 인라인 padding: 0 을 주었다. 전면형이면 className 에 card-flush 를 더할 것:\n  ${offenders.join('\n  ')}`)
})

test('전면형 표시는 카드에만 붙는다 — card-flush 홀로 쓰면 배경도 테두리도 없다', () => {
  // `.card-flush` 는 여백만 0 으로 만드는 **수식어**다. 단독으로 쓰면 «카드처럼 보이는데
  // 카드가 아닌» 상자가 또 하나 생긴다 — 이 저장소가 반복해 온 자작 카드(476건)의 시작점이다.
  const offenders: string[] = []
  for (const { file, src } of sources()) {
    src.split('\n').forEach((line, i) => {
      if (!/\bcard-flush\b/.test(line)) return
      if (!hasCardClass(line)) offenders.push(`${file}:${i + 1}`)
    })
  }
  assert.deepEqual(offenders, [],
    `card-flush 를 card 없이 썼다. className="card card-flush" 형태로 쓸 것:\n  ${offenders.join('\n  ')}`)
})

/**
 * **여백 규칙이 실제로 그 태그에 닿는가.**
 *
 * v0.7.676 은 `:where(.card)` 로 기본 여백을 줬고, 그 안전성 근거는 «`.card` 는
 * div·section·li·article·details 에만 쓰인다» 였다. 그 전제가 **깨졌다**(v0.7.716):
 * 카드를 눌러 표를 여는 화면이 생기면서 카드가 `<button>` 이 됐고, Tailwind preflight 의
 * `button{padding:0}`(특정도 0,0,1)이 `:where()`(특정도 0)를 이겨 /crm/reports 지표 카드
 * 8장이 **computed padding 0px** 로 렌더됐다(사용자 지적: 「디자인 다 깨졌자나」).
 *
 * 앞의 세 테스트는 **규칙이 있는지**만 봤다 — 규칙이 있는데도 화면이 깨졌으니
 * 그것만으로는 부족하다. 여기서는 **쓰이는 태그마다 규칙이 닿는지**를 본다.
 */
const PREFLIGHT_ZEROES_PADDING = ['button', 'ul', 'ol', 'menu', 'fieldset', 'legend', 'input', 'textarea', 'select'] as const

/** `<Link>` 는 `<a>` 로 렌더된다 — CSS 가 보는 이름으로 맞춘다 */
const RENDERS_AS: Record<string, string> = { Link: 'a' }

/**
 * 전역 `card` 클래스가 붙은 여는 태그의 이름을 모은다.
 *
 * 태그를 통째로 정규식으로 잡지 않는다 — 속성 안의 `onClick={() => …}` 의 `>` 가
 * 태그 끝으로 읽혀 뒤쪽 `className` 을 놓친다(조용한 통과). 대신 `className` 을 먼저
 * 찾고 **왼쪽으로 가장 가까운 여는 꺾쇠**를 거슬러 올라간다.
 */
function tagsUsingCard(): Map<string, string[]> {
  const found = new Map<string, string[]>()
  for (const { file, src } of sources()) {
    for (const m of src.matchAll(/className=\{?[`"]([^`"]*)[`"]/g)) {
      if (!m[1].split(/[\s${}]+/).includes('card')) continue
      const open = src.lastIndexOf('<', m.index)
      if (open < 0) continue
      const name = /^<([A-Za-z][A-Za-z0-9]*)/.exec(src.slice(open, open + 40))?.[1]
      if (!name) continue
      const tag = RENDERS_AS[name] ?? name
      const at = found.get(tag) ?? []
      at.push(`${file}:${src.slice(0, m.index).split('\n').length}`)
      found.set(tag, at)
    }
  }
  return found
}

test('카드 여백이 태그에 실제로 닿는다 — preflight 가 되돌리는 태그는 특정도를 올려 덮는다', () => {
  const css = read(GLOBALS)

  // 짝 규칙: `:where(button, a, …).card { padding: var(--card-pad) }`
  // `.card` 가 `:where()` **밖**에 있어야 특정도가 (0,1,0) 이 되어 preflight 를 이긴다.
  const rule = css.match(/:where\(([^)]*)\)\.card\s*\{[^}]*padding:\s*var\(--card-pad\)/)
  assert.ok(rule,
    `globals.css 에 «누를 수 있는 카드»의 여백 규칙이 없다.\n`
    + `  :where(button, a, …).card { padding: var(--card-pad); } 를 되살릴 것.\n`
    + `  .card 를 :where() 밖에 두어야 특정도(0,1,0)로 preflight 의 button{padding:0}(0,0,1)을 이긴다.`)

  const covered = new Set(rule[1].split(',').map((t) => t.trim()))
  const uncovered: string[] = []
  for (const [tag, at] of tagsUsingCard()) {
    if (!(PREFLIGHT_ZEROES_PADDING as readonly string[]).includes(tag)) continue
    if (covered.has(tag)) continue
    uncovered.push(`<${tag}> — ${at.slice(0, 3).join(', ')}${at.length > 3 ? ` 외 ${at.length - 3}곳` : ''}`)
  }
  assert.deepEqual(uncovered, [],
    `전역 card 를 붙였는데 preflight 가 그 태그의 여백을 0 으로 되돌린다.\n`
    + `  globals.css 의 :where(...).card 목록에 태그를 더하거나, 다른 태그를 쓸 것:\n  ${uncovered.join('\n  ')}`)
})
