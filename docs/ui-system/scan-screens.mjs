#!/usr/bin/env node
// docs/ui-system/scan-screens.mjs — 화면별 UI 구성 전수 스캐너
//
// 왜: "무엇이 어디서 제각각인지"를 사람 기억이 아니라 코드에서 뽑는다.
//   화면을 하나씩 열어보며 고치면 반드시 빠뜨린다(실제로 탭이 그랬다).
//
// ⚠️ 정밀도 원칙 (v0.7.456에서 교정):
//   1판 스캐너는 **문자열이 보이면** 자작으로 셌다. 그래서 표준 부품을 제대로 쓴
//   `<EmptyState title="아직 프로젝트가 없어요" />`의 **props 값**과
//   `setError('저장에 실패했습니다')`의 **에러 메시지 리터럴**과 **주석**까지 위반으로 집계했다.
//   결과: 빈 상태 '자작 22 / 혼재 32'인데 실제 손으로 그린 빈 상태는 4곳뿐이었다.
//   지도가 과대보고하면 (a) 다 고쳐도 숫자가 안 내려가 완료를 판정할 수 없고
//   (b) 없는 위반을 쫓느라 진짜 위반이 묻힌다.
//
//   그래서 '자작'은 **화면이 직접 그린 마크업**일 때만 센다:
//     - 빈 상태·오류·로딩 → **JSX 텍스트 노드**에 문구가 있을 때만 (props 값·문자열 인자는 제외)
//     - 오류 → 손으로 만든 오류 박스 렌더(`{err && <div…`)도 포함
//     - 입력 → checkbox/radio/file 등 input-field가 의미 없는 타입 제외
//     - 카드 → radius 토큰 단독이 아니라 **표면**(radius + 배경/그림자) 동시 충족일 때만
//
// 실행: node docs/ui-system/scan-screens.mjs [--md] [--why <축>]

import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../apps/web', import.meta.url))

/** 화면 = app/** 의 page.tsx와 그 옆 View/Client 컴포넌트를 한 덩어리로 본다 */
function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '.next' || e === 'api') continue
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (e.endsWith('.tsx')) out.push(p)
  }
  return out
}

/** 주석 제거 — 주석 속 예시 문구가 위반으로 잡히던 것을 막는다 (`https://`는 보존) */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
}

/**
 * JSX 텍스트 노드에 문구가 있는가.
 * - `<div …>없습니다</div>` → 태그를 닫는 `>` 뒤에 문자열이 온다 → 자작
 * - `title="…없어요"`       → 앞에 `<`가 끼어 `>`와 이어지지 않는다 → 표준(props)
 * - `setError('…실패')`     → `(`·`'` 때문에 텍스트 노드가 아니다 → 표준(문자열 인자)
 * 여는 태그를 건너뛰지 않도록 `<`·`{`·`}`를 문자클래스에서 제외하는 게 핵심이다.
 */
function jsxText(phrase) {
  return new RegExp(`>[^<>{}]{0,100}?(?:${phrase})`)
}
/** 여러 줄로 쪼개진 JSX 텍스트 — 그 줄에 태그·속성·따옴표가 전혀 없을 때만 */
function bareText(phrase) {
  return new RegExp(`^[^<>="'\`{}()]*(?:${phrase})`)
}

// '되돌릴/삭제할 수 없습니다'는 **경고문**이지 빈 상태가 아니다 → 능력부정 동사는 뺀다.
// 단 '찾을 수 없습니다'(not found)는 빈 상태가 맞아 남긴다.
const EMPTY = '(?<!되돌릴 |취소할 |삭제할 |변경할 |사용할 |수정할 |복구할 |입력할 |선택할 )없습니다|없어요|비어 ?있습니다'
const ERROR = '실패했습니다|오류가 발생|불러오지 못|에러가 발생'
const LOADING = '로딩 ?중|불러오는 ?중'

/** 표준 부품 — 이게 보이면 그 축은 표준을 쓴다 */
const AXES = [
  {
    axis: '탭',
    std: [/SegmentedTabs/],
    custom: [/role=["']tablist["']/, /className="[^"]*\b(?:gpu-tabs|gpu-admin-tabs|artifact-tabs|gpu-udetail-tabs|home-dept-toggle)\b/],
  },
  {
    axis: '목록·표',
    std: [/ListSurface/],
    // table-card 없는 표 = 모바일 가로 스크롤. 그 자체가 위반이라 별도로 센다.
    custom: [/<table\b/, /DynamicTable/, /NbTable/],
  },
  {
    axis: '목록 도구',
    std: [/ListToolbar/],
    custom: [/filter-bar|filter-search|filter-select/, /BulkActionBar/, /TrashToggle/],
  },
  {
    axis: '페이지 이동',
    std: [/ListPager/],
    custom: [/setSize\(|nextCursor|IntersectionObserver/],
  },
  {
    axis: '목록 상태',
    std: [/useListQuery/],
    custom: [/useState<[^>]*Sort|const \[sort|const \[search|const \[filter/],
  },
  {
    axis: '페이지 헤더',
    std: [/PageHeader/],
    custom: [/<h1\b/],
  },
  {
    axis: '빈 상태',
    std: [/EmptyState/],
    custom: [jsxText(EMPTY), bareText(EMPTY)],
  },
  {
    axis: '오류',
    std: [/ErrorState/, /InlineError/],
    // 문자열 리터럴(setError('…'))이 아니라 **오류 UI를 손으로 그린 것**만 센다
    // `{error && <div><ErrorState …/></div>}`처럼 감싸기만 한 것은 표준이다 → 같은 줄에 표준이 있으면 뺀다
    custom: [jsxText(ERROR), bareText(ERROR), /\{\s*\w*[Ee]rr(?:or)?\w*\s*(?:&&|\?)\s*(?:\(\s*)?<(?![A-Za-z]*(?:ErrorState|InlineError))(?!.*(?:ErrorState|InlineError))/],
  },
  {
    axis: '로딩',
    std: [/Skel(?:Page|Card|List)|AXDotLoader/],
    custom: [jsxText(LOADING), bareText(LOADING), /animation: ?'spin/, /\bLoader2\b/],
  },
  {
    axis: '모달·패널',
    std: [/NbModal|SlidePanel|DetailSheet/],
    custom: [/position: ?'fixed'[^}]*inset/, /role="dialog"/],
  },
  {
    axis: '버튼',
    std: [/NbButton|btn-primary|btn-ghost/],
    custom: [/<button style=\{\{/],
  },
  {
    axis: '카드',
    std: [/className="card|className=\{`card/],
    // radius 토큰만으로는 뱃지·아바타·버튼까지 잡힌다 → '표면'일 때만: radius + (배경|그림자)
    custom: [/border(?:Radius)?: ?'?var\(--radius[^)]*\)[^\n]*(?:background: ?'?var\(--(?:color-surface|surface-bg)|boxShadow: ?'?var\(--shadow)/,
             /(?:background: ?'?var\(--(?:color-surface|surface-bg)[^\n]*|boxShadow: ?'?var\(--shadow[^\n]*)border(?:Radius)?: ?'?var\(--radius/],
  },
  {
    axis: '입력',
    std: [/input-field/],
    // checkbox·radio·file·hidden은 input-field 대상이 아니다(모양이 다른 컨트롤)
    custom: [/<(?:input|select|textarea)(?![^>]*input-field)(?![^>]*type=["'](?:checkbox|radio|file|hidden|submit|button|range|color)["'])[^>]*>/],
  },
]

const files = walk(join(ROOT, 'app'))
/** 화면 키 = 라우트 폴더 */
const screens = new Map()
for (const f of files) {
  const rel = relative(ROOT, f)
  const route = rel.replace(/^app/, '').replace(/\/[^/]+\.tsx$/, '') || '/'
  const key = route.replace(/\((\w+)\)/g, '').replace(/\/+/g, '/') || '/'
  const src = stripComments(readFileSync(f, 'utf8'))
  const entry = screens.get(key) ?? { files: [], lines: [] }
  entry.files.push(rel)
  for (const [i, line] of src.split('\n').entries()) entry.lines.push({ file: rel, no: i + 1, line })
  screens.set(key, entry)
}

/** 축 판정은 **줄 단위**로 한다 — 파일 전체를 이으면 여는 태그를 건너뛰어 오탐이 난다 */
function hit(patterns, lines) {
  const out = []
  for (const l of lines) if (patterns.some((r) => r.test(l.line))) out.push(l)
  return out
}

const rows = []
const evidence = new Map() // `${route}|${axis}` → 자작 근거 줄
for (const [route, { files: fs_, lines }] of [...screens].sort()) {
  const cells = AXES.map(({ axis, std, custom }) => {
    const hasStd = hit(std, lines).length > 0
    const customHits = hit(custom, lines)
    if (customHits.length) evidence.set(`${route}|${axis}`, customHits)
    if (hasStd && !customHits.length) return '표준'
    if (hasStd && customHits.length) return '혼재'
    if (customHits.length) return '자작'
    return '-'
  })
  rows.push({ route, files: fs_.length, cells })
}

// 축별 집계 — 어디부터 손대야 하는지 숫자로 나온다
const summary = AXES.map((a, i) => {
  const c = { 표준: 0, 혼재: 0, 자작: 0 }
  for (const r of rows) if (r.cells[i] in c) c[r.cells[i]]++
  return { axis: a.axis, ...c }
})

const whyIdx = process.argv.indexOf('--why')
if (whyIdx !== -1) {
  // 왜 자작으로 판정됐는지 근거 줄을 보여준다 — 오탐 재발을 사람이 눈으로 확인할 수 있게
  const want = process.argv[whyIdx + 1]
  let n = 0
  for (const [key, hits] of [...evidence].sort()) {
    const [route, axis] = key.split('|')
    if (want && axis !== want) continue
    const cell = rows.find((r) => r.route === route)?.cells[AXES.findIndex((a) => a.axis === axis)]
    if (cell !== '자작' && cell !== '혼재') continue
    console.log(`\n=== ${route} · ${axis} (${cell}, ${hits.length}건)`)
    for (const h of hits.slice(0, 12)) console.log(`   ${h.file}:${h.no}  ${h.line.trim().slice(0, 120)}`)
    n += hits.length
  }
  console.log(`\n총 ${n}건`)
} else if (process.argv.includes('--md')) {
  const head = `| 화면 | ${AXES.map((a) => a.axis).join(' | ')} |`
  const sep = `|---|${AXES.map(() => '---').join('|')}|`
  const body = rows.map((r) => `| \`${r.route}\` | ${r.cells.join(' | ')} |`).join('\n')
  const sum = [`| 축 | 표준 | 혼재 | 자작 |`, `|---|---|---|---|`,
    ...summary.map((s) => `| ${s.axis} | ${s.표준} | ${s.혼재} | ${s.자작} |`)].join('\n')
  writeFileSync(fileURLToPath(new URL('./SCREEN-MAP.md', import.meta.url)),
`# 화면 × UI 축 지도 (자동 생성)

\`node docs/ui-system/scan-screens.mjs --md\`로 다시 만든다. **손으로 고치지 않는다.**
근거가 궁금하면 \`node docs/ui-system/scan-screens.mjs --why '빈 상태'\`로 판정 줄을 본다.

- **표준** = 공용 부품을 쓴다 · **자작** = 화면이 직접 그린다 · **혼재** = 둘 다 있다(이관 중)
- '자작'은 **화면이 직접 그린 마크업**만 센다. 표준 부품에 넘긴 props 문자열(\`title="…없어요"\`)이나
  에러 메시지 리터럴(\`setError('…실패했습니다')\`)은 위반이 아니다 — 1판이 이걸 세서 과대보고했다.

## 축별 현황

${sum}

## 화면별

${head}
${sep}
${body}
`)
  console.log('SCREEN-MAP.md 생성')
} else {
  console.table(summary)
}
