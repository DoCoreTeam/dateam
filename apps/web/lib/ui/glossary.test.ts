/**
 * 용어집 가드 — 말이 다시 갈라지지 않게 (용어집 §08 3층)
 *
 * **왜 정적 가드인가**: 정책 §2-5 (2)에 "용어는 상수로 고정한다"가 **이미 있었다.**
 * 그런데 연동 카드 한 곳에만 적용됐고 나머지는 화면마다 각자 적었다.
 * 규칙을 글로만 두면 지켜지지 않는다는 증거가 이 저장소에 이미 있는 셈이다.
 *
 * **왜 ratchet 인가**: 지금 위반이 21곳 있다. 즉시 차단으로 걸면 `pnpm test` 가 통째로 빨개져
 * 아무 일도 못 한다. 그래서 **"지금보다 늘면 차단"** 으로 건다 —
 * 새 위반은 그 자리에서 막히고, 기존 것은 그 화면을 건드릴 때 함께 정리한다(결정 4 · §2-6 (5)와 같은 방식).
 * 줄어들면 baseline 이 자동으로 내려가 되돌아가지 못한다.
 *
 * **가드는 만든 뒤 일부러 깨서 실패를 확인했다** — 부분문자열 매칭으로 위반을 통과시킨 전례가 있다(v0.7.438).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { walkFiles, read, stripComments } from './component-scan.ts'
import { BANNED_TERMS } from '../terms/action.ts'

/**
 * 경로는 **이 파일 기준**으로 잡는다 — 예전엔 `'app'` 같은 상대경로라 cwd 를 탔다.
 *
 * 그래서 저장소 루트에서 돌리면 `walkFiles('app')` 이 아무것도 못 찾아 **위반 0** 으로 보였고,
 * 아래 자동 하향이 그 0 을 그대로 저장해 **baseline 을 통째로 비웠다.** 실제로 루트에
 * `{"__labelMaps": 0, "__nameClashes": 0}` 짜리 두 번째 baseline 이 생겨 있었다
 * (실측 2026-08-31). 그 상태로 루트에서 한 번 더 돌리면 라벨맵 31개가 전부 새 위반이 된다.
 *
 * 가드가 **어디서 실행되든 같은 것을 보게** 하는 것이 먼저다 — 기준이 cwd 를 타면 기준이 아니다.
 */
const WEB = join(import.meta.dirname, '..', '..')
const BASELINE = join(WEB, 'scripts/.glossary-baseline.json')
const APP = join(WEB, 'app')
const COMPONENTS = join(WEB, 'components')

/**
 * 화면이 **읽는** 라벨 표도 스캔 대상이다.
 *
 * `lib/nav/menu.ts` 는 사이드바와 전체 메뉴가 그리는 이름의 출처인데 `app`·`components` 밖이라
 * 가드가 못 봤다. 실제로 QuickNav 의 「영업기회」를 `navLabel('/deals')` 로 바꾸자 **화면에는
 * 그대로 뜨는데** 카운트만 0이 되어 baseline 이 자동 하향으로 잠겼다(실측 2026-08-31).
 * 리터럴을 스캔 밖으로 옮기는 것은 고친 것이 아니라 **숨긴 것**이다.
 */
const NAV = join(WEB, 'lib/nav')

/** 용어집 자신과 가드는 금지어를 **정의**하는 자리라 스캔 대상이 아니다 */
const SELF = ['lib/terms/', 'lib/ui/glossary.test.ts', 'scripts/ui-phrases.mjs']

/** baseline 키는 `apps/web` 상대경로로 적는다 — 절대경로를 넣으면 기계마다 달라진다 */
const rel = (f: string): string => (f.startsWith(WEB) ? f.slice(WEB.length + 1) : f)

type Counts = Record<string, number>

function loadBaseline(): Counts {
  if (!existsSync(BASELINE)) return {}
  try { return JSON.parse(readFileSync(BASELINE, 'utf-8')) as Counts } catch { return {} }
}

function saveBaseline(c: Counts): void {
  writeFileSync(BASELINE, `${JSON.stringify(c, null, 2)}\n`)
}

/**
 * 사람에게 보이는 문자열만 본다.
 *
 * 주석은 제외한다(규칙을 설명한 주석이 위반으로 잡히면 아무도 규칙을 안 적는다).
 * 그리고 **JSX 텍스트 노드와 문자열 리터럴**만 센다 — 변수명·타입명에 들어간 영문은 대상이 아니다.
 */
function userFacingText(src: string): string[] {
  const s = stripComments(src)
  const out: string[] = []

  // 문자열 리터럴 ('…' "…" `…`)
  const lit = /'([^'\\\n]*(?:\\.[^'\\\n]*)*)'|"([^"\\\n]*(?:\\.[^"\\\n]*)*)"|`([^`\\]*(?:\\.[^`\\]*)*)`/g
  let m: RegExpExecArray | null
  while ((m = lit.exec(s)) !== null) out.push(m[1] ?? m[2] ?? m[3] ?? '')

  // JSX 텍스트 노드 (>텍스트<)
  const jsx = />([^<>{}\n]*[가-힣][^<>{}\n]*)</g
  while ((m = jsx.exec(s)) !== null) out.push(m[1])

  return out
}

function scanFiles(): string[] {
  return [...walkFiles(APP), ...walkFiles(COMPONENTS), ...walkFiles(NAV)]
    .filter((f) => !f.endsWith('.test.ts') && !f.endsWith('.test.tsx'))
    .filter((f) => !SELF.some((s) => f.includes(s)))
}

// ─────────────────────────────────────────────────────────────
// ① 금지어 — 쓰지 않기로 한 말이 화면에 새로 들어오는 것을 막는다
// ─────────────────────────────────────────────────────────────

test('금지어가 지금보다 늘지 않는다 (용어집 §07)', () => {
  const now: Counts = {}
  for (const file of scanFiles()) {
    const texts = userFacingText(read(file))
    for (const { bad } of BANNED_TERMS) {
      const n = texts.reduce((acc, t) => acc + (t.includes(bad) ? 1 : 0), 0)
      if (n > 0) now[`${rel(file)}::${bad}`] = n
    }
  }

  const base = loadBaseline()
  const grown: string[] = []
  for (const [key, n] of Object.entries(now)) {
    const was = base[key] ?? 0
    if (n > was) {
      const bad = key.split('::')[1]
      const good = BANNED_TERMS.find((t) => t.bad === bad)?.good ?? '?'
      grown.push(`${key} — ${was} → ${n} · 「${bad}」 대신 「${good}」 (lib/terms/action.ts)`)
    }
  }

  // 줄어든 것은 baseline 을 내려 되돌아가지 못하게 한다
  if (grown.length === 0) {
    const merged: Counts = {}
    for (const [k, v] of Object.entries(now)) merged[k] = v
    if (JSON.stringify(merged) !== JSON.stringify(base)) saveBaseline({ ...merged, __labelMaps: base.__labelMaps ?? 0 })
  }

  assert.equal(grown.length, 0, `금지어가 새로 들어왔습니다:\n  ${grown.join('\n  ')}`)
})

// ─────────────────────────────────────────────────────────────
// ② 라벨 맵의 자리 — 화면 안에 두면 두 번째 화면이 쓰는 순간 복붙된다
// ─────────────────────────────────────────────────────────────

const LABEL_MAP = /\b[A-Z][A-Z0-9_]*(?:_LABEL|_META)\s*:\s*Record</g

test('화면(app/) 안의 라벨 맵이 지금보다 늘지 않는다 (용어집 §00 증거2)', () => {
  let n = 0
  const where: string[] = []
  for (const file of walkFiles(APP)) {
    if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue
    const hits = stripComments(read(file)).match(LABEL_MAP)
    if (hits) { n += hits.length; where.push(`${file} (${hits.length})`) }
  }

  const base = loadBaseline()
  const was = base.__labelMaps ?? Number.POSITIVE_INFINITY
  if (n <= was) {
    const next = loadBaseline()
    next.__labelMaps = n
    saveBaseline(next)
  }

  assert.ok(
    n <= was,
    `화면 안 라벨 맵이 ${was} → ${n} 로 늘었습니다.\n` +
    `라벨 표는 lib/ 아래에 둡니다 — 모양은 lib/crm/ui/meeting-status.ts 를 따르세요.\n  ${where.join('\n  ')}`,
  )
})

// ─────────────────────────────────────────────────────────────
// ③ 같은 라벨 맵이 두 곳 이상 — 복붙은 오탈자까지 복제한다
// ─────────────────────────────────────────────────────────────

/**
 * 라벨 맵 선언을 **이름과 내용**으로 모은다.
 *
 * 둘을 구분하는 이유: 같은 이름이라도 뜻이 다르면(`STATUS_LABEL` 이 게시 상태이기도 하고
 * 공급사 상태이기도 하다) 그건 **이름 충돌**이지 복붙이 아니다. 반면 내용까지 같으면
 * **진짜 복붙**이고, 하나를 고치면 나머지가 남는다 — 해악의 크기가 다르므로 다르게 다룬다.
 */
function labelMapDecls(files: string[]): { name: string; body: string; file: string }[] {
  const out: { name: string; body: string; file: string }[] = []
  for (const file of files) {
    if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue
    const src = stripComments(read(file))
    const re = /\b([A-Z][A-Z0-9_]*(?:_LABEL|_META))\s*:\s*Record<[^=]*=\s*\{([\s\S]*?)\n\}/g
    let m: RegExpExecArray | null
    while ((m = re.exec(src)) !== null) {
      out.push({ name: m[1], body: m[2].replace(/\s+/g, ' ').trim(), file })
    }
  }
  return out
}

test('내용까지 같은 라벨 맵이 두 곳 이상에 복붙돼 있지 않다', () => {
  const byKey = new Map<string, string[]>()
  for (const d of labelMapDecls([...walkFiles(APP), ...walkFiles(COMPONENTS)])) {
    const key = `${d.name}::${d.body}`
    const list = byKey.get(key) ?? []
    if (!list.includes(d.file)) list.push(d.file)
    byKey.set(key, list)
  }

  const copied = [...byKey.entries()]
    .filter(([, files]) => files.length > 1)
    .map(([key, files]) => `${key.split('::')[0]} — ${files.join(' · ')}`)

  assert.deepEqual(copied, [],
    '같은 표가 여러 화면에 복붙돼 있습니다. 하나를 고치면 나머지가 남습니다 — lib/ 로 올리세요.\n' +
    '모양은 lib/crm/ui/meeting-status.ts 를 따릅니다.')
})

test('이름만 같은 라벨 맵이 지금보다 늘지 않는다', () => {
  const byName = new Map<string, Set<string>>()
  for (const d of labelMapDecls([...walkFiles(APP), ...walkFiles(COMPONENTS)])) {
    const set = byName.get(d.name) ?? new Set<string>()
    set.add(d.file)
    byName.set(d.name, set)
  }
  const n = [...byName.values()].filter((s) => s.size > 1).length

  const base = loadBaseline()
  const was = base.__nameClashes ?? Number.POSITIVE_INFINITY
  if (n <= was) {
    const next = loadBaseline()
    next.__nameClashes = n
    saveBaseline(next)
  }

  assert.ok(n <= was,
    `이름이 겹치는 라벨 맵이 ${was} → ${n} 로 늘었습니다.\n` +
    '이름이 겹치면 코드에서 찾을 때 엉뚱한 것이 잡힙니다 — 도메인을 이름에 넣으세요(예: DEAL_STATUS_LABEL).')
})

// ─────────────────────────────────────────────────────────────
// ④ 용어집 자체의 정합성 — 표준어가 금지어 목록에 들어가면 안 된다
// ─────────────────────────────────────────────────────────────

test('금지어 표가 자기모순이 아니다', () => {
  const bads = new Set(BANNED_TERMS.map((t) => t.bad))
  const conflicts = BANNED_TERMS.filter((t) => bads.has(t.good))
  assert.deepEqual(conflicts.map((c) => `${c.bad} → ${c.good}`), [],
    '대체어가 다시 금지어입니다 — 무한 이관이 됩니다')

  for (const t of BANNED_TERMS) {
    assert.ok(t.why.trim().length > 0, `${t.bad}: 왜 금지하는지 적혀 있지 않습니다`)
  }
})
