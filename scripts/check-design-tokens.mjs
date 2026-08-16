#!/usr/bin/env node
// 디자인 토큰 가드 — 인라인 style 하드코딩 색/치수 + rgba/raw-input/미정의토큰 재유입 검사.
// 사용: node scripts/check-design-tokens.mjs  (CI/pre-commit 연결). 잔여 발견 시 exit 1.
// 정책(DECISION-20260609-guard-ratchet): hex는 즉시 하드페일. rgba/raw-input/미정의토큰은
//   baseline ratchet — 기존 위반(.design-guard-baseline.json)은 추적만, baseline에 없는 신규만 차단.
//   baseline 재생성: node scripts/check-design-tokens.mjs --update-baseline
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
// 상태 문구·이름색 판정은 화면 스캐너와 **같은 정의**를 쓴다(scripts/ui-phrases.mjs = SSOT).
import { EMPTY, LOADING, NAMED_COLOR_RE, NAMED_COLOR_PROP_RE, isSelfMadeStateText, stripComments } from './ui-phrases.mjs'
// 커밋 문맥의 판정 범위 — 공유 작업 트리에서 남의 진행 중 파일을 내 판정에 섞지 않는다.
import { commitScope, readFromHead } from './git-scope.mjs'

const ALLOW_HEX = new Set([
  '#fcd34d', '#ffffff', '#0a0a0a', '#f8f8f6', '#efede8',
  '#ec4899', '#fbcfe8',
])
const roots = ['apps/web/app', 'apps/web/components']
// CSS 본체도 스캔한다 — 예전에는 app/components의 .tsx만 봐서 globals.css의
// font-size:7px 같은 §3-1 위반이 통과 중이었다(v0.7.438 실측).
const CSS_FILE = 'apps/web/app/globals.css'
const BASELINE_PATH = 'scripts/.design-guard-baseline.json'
const UPDATE = process.argv.includes('--update-baseline')
// --commit-scope: 판정 대상을 **커밋된 상태 + 이번 커밋에 담기는 파일**로 좁힌다(pre-commit 훅 전용).
// 없으면 종전대로 작업 트리 전체를 본다(수동 `pnpm design:check`·CI — CI는 애초에 깨끗한 체크아웃이라 동일).
const COMMIT_SCOPE = process.argv.includes('--commit-scope')
const SCOPE = COMMIT_SCOPE ? commitScope() : { skip: new Set(), fromHead: new Set() }

/**
 * 판정에 쓸 파일 내용. `--commit-scope`에서
 *   남의 untracked → null(대상 아님) · 남의 수정 → HEAD 내용 · 그 밖 → 디스크.
 */
function readSource(path) {
  if (SCOPE.skip.has(path)) return null
  if (SCOPE.fromHead.has(path)) return readFromHead(path)
  return existsSync(path) ? readFileSync(path, 'utf8') : null
}

// globals.css에 새로 들어와도 되는 클래스 = 시스템 공용 프리미티브 prefix.
// 여기 없는 prefix로 새 최상위 규칙을 만들면 "화면 전용 CSS"로 보고 차단한다
// (§0-1: 새 도메인 스타일은 해당 폴더의 CSS Module).
const SHARED_CSS_PREFIXES = new Set([
  'app', 'shell', 'dock', 'list', 'page', 'nb', 'seg', 'skel', 'filter', 'slide',
  'detail', 'quickadd', 'card', 'input', 'label', 'table', 'responsive', 'tape',
  'btn', 'badge', 'empty', 'error', 'state', 'modal', 'toast', 'sr', 'mobile',
  'desktop', 'text', 'sidebar', 'settings', 'chip', 'form', 'grid', 'stack',
  'sort', // 정렬 아이콘/헤더 — 목록형 화면 공통 프리미티브
  'inline', // inline-error — 폼·버튼 옆 한 줄 오류(components/ui/InlineError)
])
const MIN_FONT_PX = 10

function walk(d, a) {
  for (const e of readdirSync(d)) {
    const p = join(d, e); const s = statSync(p)
    if (s.isDirectory()) { if (p.includes('/api') || e === 'node_modules' || e === '.next') continue; walk(p, a) }
    else if (/\.(tsx)$/.test(e)) a.push(p)
  }
}

const files = []
for (const r of roots) walk(r, files)

/**
 * `components/ui/` 안에서 실제로 쓰이는 클래스 이름들.
 *
 * globals.css에 새 클래스가 들어오면 "화면 전용"으로 보고 막는데, **공용 부품의 스타일**은
 * globals.css가 있어야 할 자리다(`.list-toolbar`·`.list-cards`·`.btn-*`가 이미 거기 있다).
 * 예전엔 이걸 손으로 관리하는 prefix 목록으로 갈랐다 — 목록이 현실과 어긋나면
 * 만드는 사람은 매번 "새로 만드는 쪽"을 택하게 된다(CLAUDE.md §0이 지적한 바로 그 실패).
 * 그래서 목록 대신 **사실**로 가른다: 그 클래스를 공용 부품이 쓰고 있으면 시스템 CSS다.
 */
const uiComponentClasses = new Set()
for (const f of files) {
  if (!f.includes('components/ui/')) continue
  const text = readSource(f)
  if (text === null) continue
  for (const m of text.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{'([^']*)'\})/g)) {
    for (const cls of (m[1] ?? m[2] ?? m[3] ?? '').split(/[\s${}?:'"]+/)) {
      if (/^[a-z][a-z0-9-]*$/.test(cls)) uiComponentClasses.add(cls)
    }
  }
}

const hardHex = []          // 즉시 차단
const swrMutate = []        // 즉시 차단 — swr 모듈 레벨 전역 mutate import
const ratchet = []          // baseline 대조 대상 {key, desc}

// swr 모듈 레벨 전역 mutate import 금지 — SWRProvider 영속캐시 인스턴스를 못 건드려 "저장 후
// 새로고침해야 목록 반영" 회귀를 유발(v0.7.178/0.7.180 사고). 반드시 useSWRConfig().mutate 사용.
// import {...} from 'swr' 구문(import x, {...} 포함, 멀티라인 허용 — 세미콜론 미포함)에 mutate가 있으면 차단.
// (정상: import { useSWRConfig } 후 const { mutate } = useSWRConfig() — import에 mutate 토큰 없음 → 미검출)
const swrMutateRe = /import\s+[^;]*?from\s+['"]swr['"]/g

const hexRe = /#[0-9a-fA-F]{6}\b/g
const rgbaRe = /\brgba?\(/g
// 미정의 토큰: 크기성인데 --text-* (정의 안 됨, --fs-* 써야 함). --text/--text-muted/--text-faint는 정의됨.
const badTokenRe = /var\(--text-(xs|sm|md|lg|xl|2xl|3xl)\b/g
// raw 입력 판정에서 빼는 것 — lib/ui/form-field-contract.test.ts와 같은 기준을 쓴다.
//   ① 네이티브 위젯(checkbox·radio·range·color): 필드 배경·보더가 렌더와 싸운다.
//   ② 안 보이는 입력(type=hidden, display:none): 스타일이 무의미하다.
// (보이는 type="file"은 정상 필드다 — /ci/assets 실화면에서 옆 텍스트 입력과 같은 상자로 렌더된다)
const NATIVE_WIDGET_RE = /type=["'](?:checkbox|radio|range|color)["']/
const INVISIBLE_INPUT_RE = /type=["']hidden["']|display:\s*['"]none['"]/
// input-field 외에 filter-bar 전용 스타일 클래스(filter-search/filter-select)도 정식 필드 디자인으로 인정.
const FIELD_CLASS_RE = /\b(?:input-field|filter-search|filter-select)\b/
// z-index 하드코딩 — 레이어 순서는 --z-* 토큰만이 진실이어야 겹침 사고를 막는다.
const zIndexRe = /zIndex: *['"]?[0-9]/g

/** JSX 여는 태그 전체를 잘라낸다. `onClick={() => x}`의 `>`에 속지 않도록 중괄호 깊이를 센다. */
function openTag(text, start) {
  let depth = 0
  for (let i = start; i < text.length && i < start + 4000; i++) {
    const c = text[i]
    if (c === '{') depth++
    else if (c === '}') depth--
    else if (c === '>' && depth === 0) return text.slice(start, i + 1)
  }
  return text.slice(start, start + 4000)
}

/**
 * input-field 없이 브라우저 기본으로 렌더되는 입력.
 * 태그를 통째로 잘라 판정한다 — 줄 단위로 보면 여러 줄에 걸친 태그의
 * `type="file"`·`display:'none'`을 못 봐서 정상 입력을 위반으로 센다.
 */
function rawInputHits(text) {
  const hits = []
  for (const m of text.matchAll(/<(input|select|textarea)\b/g)) {
    const tag = openTag(text, m.index)
    if (FIELD_CLASS_RE.test(tag)) continue
    if (NATIVE_WIDGET_RE.test(tag) || INVISIBLE_INPUT_RE.test(tag)) continue
    hits.push({ tag: m[1], line: text.slice(0, m.index).split('\n').length })
  }
  return hits
}

/** `<button ... style={{`  = 공용 버튼(NbButton·.btn-*)을 안 쓰고 그 자리에서 만든 버튼 */
function inlineStyledTags(text, tagName) {
  const hits = []
  const re = new RegExp(`<${tagName}\\b`, 'g')
  for (const m of text.matchAll(re)) {
    const tag = openTag(text, m.index)
    if (/style=\{\{/.test(tag)) hits.push(text.slice(0, m.index).split('\n').length)
  }
  return hits
}

for (const f of files) {
  const text = readSource(f)
  if (text === null) continue
  // 주석 속 예시 문구는 위반이 아니다 — 판정 전에 걷어낸다.
  const lines = stripComments(text).split('\n')
  for (const m of text.matchAll(swrMutateRe)) {
    if (/\{[^}]*\bmutate\b[^}]*\}/.test(m[0])) {
      const lineNo = text.slice(0, m.index).split('\n').length
      swrMutate.push(`${f}:${lineNo}  swr 전역 mutate import 금지 → useSWRConfig().mutate 사용`)
    }
  }
  lines.forEach((line, i) => {
    for (const m of line.matchAll(hexRe)) {
      if (!ALLOW_HEX.has(m[0].toLowerCase())) hardHex.push(`${f}:${i + 1}  hex ${m[0]}`)
    }
    if (/\b[0-9.]+px solid #[0-9a-fA-F]{3,6}\b/.test(line)) hardHex.push(`${f}:${i + 1}  border literal(width+color)`)
    for (const m of line.matchAll(rgbaRe)) ratchet.push({ key: `${f}::rgba`, desc: `${f}:${i + 1}  rgba 인라인색` })
    for (const m of line.matchAll(badTokenRe)) ratchet.push({ key: `${f}::badtoken::${m[0]}`, desc: `${f}:${i + 1}  미정의 토큰 ${m[0]})` })
    for (const m of line.matchAll(zIndexRe)) ratchet.push({ key: `${f}::zindex`, desc: `${f}:${i + 1}  z-index 하드코딩 → var(--z-*)` })
    for (const m of line.matchAll(NAMED_COLOR_RE)) ratchet.push({ key: `${f}::namedcolor`, desc: `${f}:${i + 1}  이름색/3자리hex ${m[0]} → 토큰` })
    for (const m of line.matchAll(NAMED_COLOR_PROP_RE)) ratchet.push({ key: `${f}::namedcolor`, desc: `${f}:${i + 1}  이름색 ${m[0]} → 토큰` })
    // 상태 문구는 **JSX 텍스트 노드일 때만** 자작으로 센다.
    // 줄 단위로 문구만 찾으면 `<EmptyState title="…없어요">` 같은 정상 사용까지 위반으로 세어
    // 숫자가 부풀고(실제 4곳 → 22곳 보고 사고) 완료 판정이 불가능해진다.
    if (isSelfMadeStateText(line, LOADING)) ratchet.push({ key: `${f}::loadingtext`, desc: `${f}:${i + 1}  로딩 문구 자작 → SkelPage/SkelList/AXDotLoader` })
    if (isSelfMadeStateText(line, EMPTY)) ratchet.push({ key: `${f}::emptytext`, desc: `${f}:${i + 1}  빈 상태 문구 자작 → EmptyState` })
  })
  for (const hit of rawInputHits(text)) {
    ratchet.push({ key: `${f}::rawinput::${hit.tag}`, desc: `${f}:${hit.line}  raw <${hit.tag}> (input-field 누락)` })
  }
  for (const ln of inlineStyledTags(text, 'button')) {
    ratchet.push({ key: `${f}::inlinebutton`, desc: `${f}:${ln}  자작 버튼(style 인라인) → NbButton / .btn-*` })
  }
  if (/borderRadius: *['"`]?(var\(--radius|[0-9])/.test(text) && /(border|background): *['"`]?(var\(|[0-9'"])/.test(text)) {
    const ln = text.split('\n').findIndex((l) => /borderRadius:/.test(l)) + 1
    ratchet.push({ key: `${f}::inlinecard`, desc: `${f}:${ln}  자작 카드 박스(인라인) → className="card"` })
  }
}

// ── globals.css — CSS 본체 (이전 가드의 진짜 사각지대) ────────────────────────
const cssSource = readSource(CSS_FILE)
if (cssSource !== null) {
  const cssLines = cssSource.split('\n')
  let selector = '(root)'
  cssLines.forEach((line, i) => {
    const sel = line.match(/^([.#][^{]*?)\s*\{/)
    if (sel) selector = sel[1].trim()
    const fs = line.match(/font-size: *([0-9.]+)(px|rem)/)
    if (fs) {
      const px = fs[2] === 'rem' ? parseFloat(fs[1]) * 16 : parseFloat(fs[1])
      if (px < MIN_FONT_PX) {
        ratchet.push({
          key: `${CSS_FILE}::tinyfont::${selector}`,
          desc: `${CSS_FILE}:${i + 1}  ${fs[0]} (${px}px) — 10px 미만 금지(§3-1) [${selector}]`,
        })
      }
    }
    // 최상위 클래스 규칙의 prefix가 공용 목록에 없으면 = 화면 전용 CSS 신규 유입
    const top = line.match(/^\.([a-zA-Z][\w-]*)/)
    if (top) {
      const prefix = top[1].split('-')[0]
      if (!SHARED_CSS_PREFIXES.has(prefix) && !uiComponentClasses.has(top[1])) {
        ratchet.push({
          key: `${CSS_FILE}::cssdomain::${top[1]}`,
          desc: `${CSS_FILE}:${i + 1}  화면 전용 CSS 신규 .${top[1]} → 도메인 폴더 CSS Module(§0-1)`,
        })
      }
    }
  })
}

// ── ratchet 대조 ────────────────────────────────────────────────────────────
// key는 `파일::유형` 단위로 묶는다(라인 이동에 견고). **개수까지 기록한다** —
// 예전 판은 key 존재 여부만 봐서, 이미 baseline에 있는 파일에는 같은 유형을 몇 개든
// 더 넣어도 통과했다(v0.7.476 실측: LoginForm.tsx에 자작 버튼을 새로 넣었는데 초록).
// 기존 화면을 고칠 때가 실제로 코드가 늘어나는 자리라, 그 구멍이 곧 "표준이 안 지켜지는" 이유였다.
const currentCounts = new Map()
for (const r of ratchet) currentCounts.set(r.key, (currentCounts.get(r.key) ?? 0) + 1)
const countsObject = () => Object.fromEntries([...currentCounts.entries()].sort(([a], [b]) => (a < b ? -1 : 1)))

if (UPDATE) {
  writeFileSync(BASELINE_PATH, JSON.stringify(countsObject(), null, 2) + '\n')
  console.log(`✅ baseline 갱신 — ${currentCounts.size}개 키 / ${ratchet.length}건 기록 (${BASELINE_PATH})`)
  process.exit(0)
}

/** 구판(배열=키 목록)도 읽는다. 개수를 모르므로 이번 실행 값으로 1회 이관한다. */
function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return { counts: new Map(), legacy: false }
  const raw = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
  if (Array.isArray(raw)) {
    const counts = new Map()
    for (const k of raw) counts.set(k, currentCounts.get(k) ?? 0) // 오늘 상태를 그대로 동결
    return { counts, legacy: true }
  }
  return { counts: new Map(Object.entries(raw)), legacy: false }
}
const { counts: baselineCounts, legacy } = loadBaseline()

// 유형별 대표 설명(개수 초과 보고에 쓴다)
const descByKey = new Map()
for (const r of ratchet) if (!descByKey.has(r.key)) descByKey.set(r.key, r.desc)

const newRatchet = []
for (const [key, count] of currentCounts) {
  const allowed = baselineCounts.get(key) ?? 0
  if (count <= allowed) continue
  const over = count - allowed
  newRatchet.push({
    key,
    desc: allowed === 0
      ? `${descByKey.get(key)}${count > 1 ? ` (${count}건)` : ''}`
      : `${descByKey.get(key)} — ${count}건으로 늘었습니다(기준 ${allowed}건, +${over})`,
  })
}

let failed = false
if (swrMutate.length) {
  failed = true
  console.error(`❌ [swr] 전역 mutate import ${swrMutate.length}건 (useSWRConfig().mutate로 교체):`)
  for (const v of swrMutate.slice(0, 40)) console.error('  ' + v)
}
if (hardHex.length) {
  failed = true
  console.error(`❌ [hex] 하드코딩 색/치수 ${hardHex.length}건:`)
  for (const v of hardHex.slice(0, 40)) console.error('  ' + v)
}
if (newRatchet.length) {
  failed = true
  console.error(`❌ [ratchet] 기준을 넘은 위반 ${newRatchet.length}곳 (토큰/공용컴포넌트 사용):`)
  for (const v of newRatchet.slice(0, 40)) console.error('  ' + v.desc)
  console.error('  → 기존 화면이라도 **지금보다 늘리는 것**은 막습니다. 줄이는 방향으로만 갑니다.')
}
if (failed) process.exit(1)

// ── 자동 조임(ratchet) ──────────────────────────────────────────────────────
// 줄어든 만큼 기준도 같이 내려간다. 안 내리면 "고쳤다가 다시 넣기"가 열려 있어서
// 잔여가 영원히 제자리를 맴돈다. 실패한 실행에서는 쓰지 않는다(부분 상태 동결 방지).
const loosened = []
for (const [key, allowed] of baselineCounts) {
  const now = currentCounts.get(key) ?? 0
  if (now < allowed) loosened.push(`${key} ${allowed}→${now}`)
}
const tracked = ratchet.length
if (legacy || loosened.length) {
  writeFileSync(BASELINE_PATH, JSON.stringify(countsObject(), null, 2) + '\n')
  if (legacy) console.log(`🔁 baseline을 개수 기준으로 이관했습니다 — ${BASELINE_PATH}도 함께 커밋하세요.`)
  if (loosened.length) {
    console.log(`🔽 baseline 자동 하향 ${loosened.length}곳 (줄어든 만큼 기준도 내림) — ${BASELINE_PATH}도 함께 커밋하세요.`)
    for (const l of loosened.slice(0, 10)) console.log('   ' + l)
  }
}
console.log(`✅ 디자인 토큰 가드 통과 — hex 0, 기준 초과 0 (추적 ${tracked}건 / ${currentCounts.size}곳 = 마이그레이션 잔여)`)
