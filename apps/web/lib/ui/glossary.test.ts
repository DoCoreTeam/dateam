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

/*
  `lib/nav/menu.ts`(사이드바 이름의 출처)는 예전에 따로 들였다. 이제 `libWordFiles` 가
  `lib` 를 통째로 보므로 그 안에 들어 있다 — 자리를 따로 적어 두면 목록이 둘이 되고,
  한쪽만 고치면 그 자리가 조용히 규칙 밖에 남는다.
*/

/**
 * **`lib` 아래에서 화면이 읽어 가는 말을 전부 본다.**
 *
 * 왜 이름으로 안 고르나 (실측 2026-10-03): 예전엔 파일 이름에 `terms`·`labels` 가 든 것만
 * 봤다. 그런데 화면 글은 이름과 무관한 자리에도 산다 — `lib/crm/domain/report-axis.ts` 의
 * `LENS_HINT` 두 줄이 「—」를 달고 화면에 떠 있었고 가드는 그 파일을 **아예 안 봤다.**
 * 같은 판에서 새로 만든 `metric-labels.ts` 가 걸린 것은 이름에 labels 가 들어갔기
 * 때문이고 그건 운이다. 규칙이 운에 걸리면 규칙이 아니다.
 *
 * 그래서 **한글이 든 `lib` 파일을 다 본다.** 빼는 것은 아래 `LIB_SKIP` 에 사유와 함께
 * 한 줄씩 적는다 — 빼는 이유가 코드에 없으면 다음 사람이 그 자리를 다시 들인다.
 *
 * 사용자 지적 2026-10-01: *"워딩과 키워드가 다 용어집을 따르지 않고 그냥 생각나는대로 만들어내네"*
 */
const HANGUL = /[가-힣]/

/**
 * `lib` 에서 빼는 자리와 **그 사유**.
 *
 * 「나중에 고친다」는 사유가 아니다. 그건 아래 기준값이 세는 쪽이다.
 */
const LIB_SKIP: { readonly re: RegExp; readonly why: string }[] = [
  { re: /^lib\/changelog\//, why: '이미 사용자에게 나간 발표 기록이다. 지난 판의 문구를 고치는 것은 제품을 고치는 것이 아니다' },
  { re: /^lib\/gemini-lead\.ts$/, why: 'AI 에게 주는 프롬프트다. 사람이 읽는 화면 글이 아니라 모델에게 주는 말이다' },
  { re: /^lib\/api-docs\/registry\.ts$/, why: '폐기된 말을 설명하는 자리다. 「영업기회가 아니라 딜」이라고 적으려면 그 말이 본문에 나와야 한다' },
]

function libWordFiles(): string[] {
  return walkFiles(join(WEB, 'lib'))
    .filter((f) => !f.endsWith('.test.ts') && !f.endsWith('.test.tsx'))
    .filter((f) => !SELF.some((x) => f.includes(x)))
    .filter((f) => !LIB_SKIP.some(({ re }) => re.test(rel(f))))
    // 한글이 없는 파일은 볼 것이 없다. 전부 읽는 대신 한 번 걸러 가드가 빨리 돈다
    .filter((f) => HANGUL.test(read(f)))
}

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
 * **서버 로그는 화면 글이 아니다.**
 *
 * `console.warn('[feature] 한도 — 재시도 없이 다음 모델로')` 같은 줄은 개발자가 터미널에서
 * 읽는 말이고 사용자에게 안 보인다. 화면 글과 같은 규칙으로 재면 로그를 쓸 때마다
 * 용어집을 뒤져야 하고, 그러면 아무도 로그를 안 남긴다 — 그쪽이 더 나쁘다.
 *
 * 로그 **한 줄 전체**를 지운다. 괄호 안만 지우려 들면 여러 줄에 걸친 로그에서 틀린다.
 */
function withoutLogs(src: string): string {
  return src
    .split('\n')
    .map((line) => (/console\.(log|warn|error|info|debug|trace)\s*\(/.test(line) ? '' : line))
    .join('\n')
}

/**
 * 사람에게 보이는 문자열만 본다.
 *
 * 주석은 제외한다(규칙을 설명한 주석이 위반으로 잡히면 아무도 규칙을 안 적는다).
 * 그리고 **JSX 텍스트 노드와 문자열 리터럴**만 센다 — 변수명·타입명에 들어간 영문은 대상이 아니다.
 */
function userFacingText(src: string): string[] {
  const s = withoutLogs(stripComments(src))
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
  return [...walkFiles(APP), ...walkFiles(COMPONENTS), ...libWordFiles()]
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

  /*
    줄어든 것은 baseline 을 내려 되돌아가지 못하게 한다.

    **다른 규칙의 기준값을 지우지 않는다.** 예전에는 이 자리가 baseline 을 처음부터 다시
    쓰면서 `__labelMaps` 하나만 손으로 옮겼다. 그래서 `__nameClashes` 는 매 실행마다
    사라졌고, 뒤이어 도는 그 규칙이 기준값을 못 찾아 **늘어도 안 걸렸다**
    (실측 2026-10-04: 새로 더한 「—」 기준값도 같은 이유로 227 로 조용히 올라갔다).
    `__` 로 시작하는 기록은 다른 규칙의 것이므로 통째로 옮긴다.
  */
  if (grown.length === 0) {
    const merged: Counts = {}
    for (const [k, v] of Object.entries(now)) merged[k] = v
    const bookkeeping = Object.fromEntries(Object.entries(base).filter(([k]) => k.startsWith('__')))
    const next = { ...merged, ...bookkeeping }
    if (JSON.stringify(next) !== JSON.stringify(base)) saveBaseline(next)
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

/**
 * 「—」를 0 으로 잠그는 자리.
 *
 * **두 층으로 건다.** 화면 코드(`app`·`components`)와 용어집·문구 파일은 예전부터 0 이라
 * 그대로 0 으로 잠근다. 범위를 `lib` 전체로 넓히면서 새로 보이게 된 자리는 실측 234줄이라
 * (2026-10-03) 즉시 차단으로 걸면 `pnpm test` 가 통째로 빨개져 아무 일도 못 한다.
 * 그래서 넓힌 쪽은 **지금보다 늘면 차단**으로 걸고 줄면 기준이 자동으로 내려간다.
 *
 * 한 층으로 합치지 않는 이유: 합치면 「0 이던 자리」가 기준값 안에 섞여, 화면 코드에
 * 「—」를 하나 더 넣어도 다른 자리에서 하나 지우면 통과한다.
 */
const DASH_STRICT = /^(app|components)\/|^lib\/terms\/|^lib\/nav\/|(terms|labels)[^/]*\.tsx?$/

test('★ 화면 문구에 「—」를 쓰지 않는다 (용어집 §0-1)', () => {
  /*
    사용자 지적(2026-09-09): "— <-- 이거 쓰지 말랬지".
    「—」로 이어 붙인 부연은 한 줄을 두 줄로 만들 뿐 새 사실을 더하지 않는다.
    문장이 끝났으면 마침표로 끊고, 라벨 뒤 설명이면 콜론을 쓴다.
    값이 없다는 표시로 「—」 한 글자만 쓰는 것은 기호라 대상이 아니다.
  */
  /*
    문자열 리터럴만 보면 **여러 줄에 걸친 JSX 글**을 놓친다. 실측: 미팅 상세의
    「따라잡습니다 — 제목은 그대로 둡니다」가 가드 0곳인데 화면에는 그대로 있었다.
    그래서 주석을 걷어낸 뒤 **줄 단위**로 본다. 값 없음 표시(한 글자)는 기호라 뺀다.
  */
  const strict: string[] = []
  const wide: string[] = []
  const files = [...scanFiles(), ...walkFiles(join(WEB, 'lib/terms'))]
  const PLACEHOLDER = /(['"`>{(\[:,]\s*)—(\s*['"`<})\],])/g
  for (const file of files) {
    if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue
    // API 라우트의 긴 문자열은 AI 프롬프트다. 사람이 읽는 화면 문구가 아니라 대상이 아니다
    if (rel(file).startsWith('app/api/')) continue
    withoutLogs(stripComments(read(file))).split('\n').forEach((line, i) => {
      if (!line.includes('—') || !/[가-힣]/.test(line)) return
      if (!line.replace(PLACEHOLDER, '$1$2').includes('—')) return
      const where = `${rel(file)}:${i + 1}  ${line.trim().slice(0, 70)}`
      if (DASH_STRICT.test(rel(file))) strict.push(where)
      else wide.push(where)
    })
  }

  assert.deepEqual(strict, [], `화면 문구에 「—」가 남아 있다:\n${strict.join('\n')}`)

  /*
    넓힌 쪽은 기준값으로 건다. **줄면 그만큼 내려가** 되돌아가지 못한다 —
    용어집 가드의 다른 규칙과 같은 방식이다.
  */
  const base = loadBaseline()
  const was = base.__emDashWide ?? Number.POSITIVE_INFINITY
  if (wide.length <= was) {
    const next = loadBaseline()
    next.__emDashWide = wide.length
    saveBaseline(next)
  }
  assert.ok(
    wide.length <= was,
    `lib 의 「—」가 ${was} → ${wide.length} 로 늘었습니다. 문장이 끝났으면 마침표로 끊습니다:\n`
    + wide.slice(0, 12).join('\n'),
  )
})

test('금지어 표가 자기모순이 아니다', () => {
  const bads = new Set(BANNED_TERMS.map((t) => t.bad))
  const conflicts = BANNED_TERMS.filter((t) => bads.has(t.good))
  assert.deepEqual(conflicts.map((c) => `${c.bad} → ${c.good}`), [],
    '대체어가 다시 금지어입니다 — 무한 이관이 됩니다')

  for (const t of BANNED_TERMS) {
    assert.ok(t.why.trim().length > 0, `${t.bad}: 왜 금지하는지 적혀 있지 않습니다`)
  }
})


// ─────────────────────────────────────────────────────────────
// ⑤ 스캔 범위 — 규칙 밖에 남는 화면이 없게
// ─────────────────────────────────────────────────────────────

test('화면 글이 든 lib 파일이 스캔 대상에 들어 있다', () => {
  /*
    대상이 0개가 되면 위 규칙들이 **전부 통과로 보인다** — 가장 위험한 실패다.
    이 저장소는 이미 그 사고를 겪었다: 경로가 cwd 를 타서 walkFiles 가 아무것도 못 찾았고,
    자동 하향이 그 0 을 그대로 저장해 baseline 을 통째로 비웠다(실측 2026-08-31).
  */
  const files = libWordFiles()
  assert.ok(files.length >= 300, `lib 문구 파일이 ${files.length}개뿐이다 — 경로가 바뀌었는지 확인한다`)

  // 실제로 스캔 목록에 들어갔나. 집계만 하고 안 쓰면 들인 것이 아니다
  const scanned = new Set(scanFiles())
  const missing = files.filter((f) => !scanned.has(f))
  assert.deepEqual(missing, [], `문구 파일이 스캔 밖이다:\n  ${missing.join('\n  ')}`)

  /*
    **이름으로 고르던 때 놓쳤던 자리가 지금은 들어 있나.**
    이름에 terms·labels 가 없어서 빠져 있던 자리를 손으로 짚는다 — 범위가 다시 좁아지면
    이 줄이 먼저 깨진다.
  */
  for (const must of ['lib/crm/domain/report-axis.ts', 'lib/crm/domain/metric-agg.ts', 'lib/nav/menu.ts']) {
    assert.ok([...scanned].some((f) => rel(f) === must), `${must} 가 스캔 밖이다`)
  }

  // 용어집 자신은 금지어를 정의하는 자리라 들어가면 안 된다
  const self = [...scanned].filter((f) => f.includes('lib/terms/'))
  assert.deepEqual(self, [], '용어집 자신이 스캔 대상에 들어갔다 — 금지어 정의가 위반으로 잡힌다')

  // 뺀 자리마다 사유가 적혀 있나. 사유 없는 제외는 규칙에 구멍을 내는 일이다
  for (const { re, why } of LIB_SKIP) {
    assert.ok(why.length > 20, `${re} 의 사유가 너무 짧다`)
    assert.doesNotMatch(why, /나중에|추후|TODO|예정/, `${re} 의 사유가 「나중에」다`)
  }
})
