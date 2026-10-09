// lib/policy/policy-sync.test.ts — 정책 3파일이 갈라지는 것을 차단 (§다중 세션 M-14)
//
// 왜: 정책은 `CLAUDE.md`(Claude) · `AGENTS.md`(Codex) · `GEMINI.md`(Gemini) **세 벌**로 존재한다.
//   세 파일이 같은 규칙을 담아야 세 도구가 같은 기준으로 움직이는데, 이걸 검증하는 장치가
//   **0개**였다. 그 결과 `GEMINI.md`가 **53패치 뒤처진 채**(v0.7.423 vs 실제 v0.7.476) 돌았다.
//   버전 체크리스트는 "3파일을 전부 올려라"라고 적혀 있었지만, 적혀 있는 것과 지켜지는 것은
//   다른 명제다 — 지켜지는지 보는 것이 이 가드다.
//
// M-14가 "받은 지시를 세션끼리 옮겨라"라면, 이 가드는 그 지시가 **도구끼리도** 같게 남는지 본다.
//   M-14 카드를 CLAUDE.md에만 고치고 GEMINI.md를 안 고치면, M-14가 막으려던 드리프트가
//   정책 자신에게서 일어난다.
//
// 검증 4개:
//   1) 세 파일의 `## 버전` == 루트 package.json 버전 == apps/web package.json 버전
//   2) `M-N` 카드가 한 파일에 있으면 **세 파일 모두**에 있다
//   3) 같은 `M-N` 카드의 본문이 세 파일에서 **동일**하다 (도구 서명만 정규화)
//   4) 카드가 인용하는 모든 `M-N`이 SSOT(docs/policy/multi-session.md)에 실재한다

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/** apps/web/lib/policy → 저장소 루트. cwd에 의존하지 않게 파일 위치에서 거슬러 올라간다. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')

/** 도구별 정책 파일과, 그 파일이 커밋 예시에 쓰는 서명. 서명 차이는 **의도된 것**이다. */
const POLICY_FILES = [
  /**
   * Claude 쪽 정책은 `CLAUDE.md` 에서 `.claude/heavy/CEO.md` 로 옮겨 갔다(v0.7.715 loop-kit 개편).
   * `CLAUDE.md` 는 이제 `LOOP.md` 를 가리키는 두 줄짜리 어댑터라 규칙 카드가 없다.
   * 파일 이름을 안 따라가면 이 가드는 «Claude 정책이 통째로 사라졌다»고 매번 말한다 —
   * 실제로 사라진 것이 아니라 옮겨 간 것이므로, 가드가 옮겨 간 자리를 본다.
   */
  { file: '.claude/heavy/CEO.md', agent: 'claude' },
  { file: 'AGENTS.md', agent: 'codex' },
  { file: 'GEMINI.md', agent: 'gemini' },
] as const

const SSOT = 'docs/policy/multi-session.md'

const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')
const version = (rel: string) => JSON.parse(read(rel)).version as string

/**
 * `## 버전` 다음 줄의 `v0.7.x`. 이 줄이 도구가 자기 판을 밝히는 유일한 자리다.
 */
function declaredVersion(text: string): string | null {
  return text.match(/^## 버전\n+v(\d+\.\d+\.\d+)\s*$/m)?.[1] ?? null
}

/**
 * `## M-N.` / `### M-N.` 헤딩부터 다음 헤딩 직전까지를 한 카드로 자른다.
 * 헤딩 레벨로 자르지 않으면 카드가 파일 끝까지 삼켜 "항상 다르다"가 된다.
 */
function cards(text: string): Map<string, string> {
  const out = new Map<string, string>()
  let key: string | null = null
  let buf: string[] = []
  for (const line of text.split('\n')) {
    const head = /^#{2,3} (M-\d+)\./.exec(line)
    if (head) {
      if (key) out.set(key, buf.join('\n').trim())
      key = head[1]
      buf = [line]
      continue
    }
    if (key && /^#{2,3} /.test(line)) {
      out.set(key, buf.join('\n').trim())
      key = null
      buf = []
      continue
    }
    if (key) buf.push(line)
  }
  if (key) out.set(key, buf.join('\n').trim())
  return out
}

/**
 * 도구 서명(claude·codex·gemini)만 지운다. 커밋 예시 줄에서만 지우는 이유는,
 * 본문에서 특정 도구를 지목하는 문장은 **진짜 차이**라 덮으면 안 되기 때문이다.
 */
function normalize(body: string): string {
  return body
    .split('\n')
    .map((l) => (l.includes('git commit') ? l.replace(/\b(claude|codex|gemini)\b/g, '<agent>') : l))
    .join('\n')
}

const sortM = (a: string, b: string) => Number(a.slice(2)) - Number(b.slice(2))

test('정책 3파일의 ## 버전이 package.json 두 개와 일치한다', () => {
  const root = version('package.json')
  assert.equal(version('apps/web/package.json'), root,
    `apps/web/package.json이 루트와 다르다 (루트 ${root}). 버전 체크리스트 1~2번을 함께 올릴 것.`)

  const mismatched = POLICY_FILES
    .map(({ file }) => ({ file, got: declaredVersion(read(file)) }))
    .filter(({ got }) => got !== root)

  assert.deepEqual(mismatched, [],
    `정책 파일이 뒤처졌다 (루트 ${root}). 버전을 올릴 때 정책 3파일을 **전부** 올린다:\n` +
    mismatched.map((m) => `  · ${m.file}: ${m.got ?? '## 버전 줄 없음'}`).join('\n'))
})

test('M-N 카드는 정책 3파일에 모두 있거나 모두 없다', () => {
  const byFile = POLICY_FILES.map(({ file }) => ({ file, keys: new Set(cards(read(file)).keys()) }))
  const all = [...new Set(byFile.flatMap((f) => [...f.keys]))].sort(sortM)

  const partial = all
    .map((k) => ({ rule: k, missing: byFile.filter((f) => !f.keys.has(k)).map((f) => f.file) }))
    .filter((x) => x.missing.length > 0)

  assert.deepEqual(partial, [],
    '한 파일에만 있는 규칙 카드가 있다 — 그 도구만 다른 기준으로 움직인다:\n' +
    partial.map((p) => `  · ${p.rule}: ${p.missing.join(', ')}에 없음`).join('\n'))
})

test('같은 M-N 카드의 본문이 정책 3파일에서 동일하다 (도구 서명 제외)', () => {
  const parsed = POLICY_FILES.map(({ file }) => ({ file, cards: cards(read(file)) }))
  const base = parsed[0]
  const diverged: string[] = []

  for (const rule of [...base.cards.keys()].sort(sortM)) {
    const want = normalize(base.cards.get(rule)!)
    for (const other of parsed.slice(1)) {
      const got = other.cards.get(rule)
      if (got === undefined) continue // 존재 여부는 위 테스트가 본다
      if (normalize(got) !== want) diverged.push(`${rule}: ${base.file} ↔ ${other.file}`)
    }
  }

  assert.deepEqual(diverged, [],
    '같은 규칙이 파일마다 다르게 적혀 있다. SSOT(docs/policy/multi-session.md)를 고치고\n' +
    '카드는 3파일에 **같은 문장으로** 반영할 것:\n  ' + diverged.join('\n  '))
})

test('카드가 인용하는 M-N이 SSOT에 실재한다 (없는 규칙을 가리키지 않는다)', () => {
  const defined = new Set(cards(read(SSOT)).keys())
  assert.ok(defined.size > 0, `${SSOT}에서 M-N 절을 하나도 못 찾았다 — 파서나 문서 구조를 확인할 것.`)

  const dangling: string[] = []
  for (const { file } of POLICY_FILES) {
    for (const m of new Set(read(file).match(/\bM-\d+\b/g) ?? [])) {
      if (!defined.has(m)) dangling.push(`${file} → ${m}`)
    }
  }

  assert.deepEqual(dangling, [],
    `카드가 SSOT에 없는 규칙을 인용한다. ${SSOT}에 절을 만들거나 인용을 고칠 것:\n  ` +
    dangling.join('\n  '))
})

/**
 * 보안 정책 절은 3파일에 **같은 문장으로** 있어야 한다.
 *
 * 왜 따로 보나: M-N 카드는 「세션끼리 부딪히지 마라」이고, 보안은 「무엇을 만들든 여기부터」다.
 *   성격이 달라 카드 번호를 붙이지 않았는데, 번호가 없으면 위 세 테스트가 아무것도 안 본다.
 *   그러면 한 파일만 고치고 나머지 둘이 뒤처지는 일이 그대로 재현된다
 *   (GEMINI.md 가 53패치 뒤처진 채 돌던 그 일).
 */
const SECURITY_HEADING = '## 보안 정책 (필수 — 무엇을 만들든 여기부터)'

function securitySection(text: string): string | null {
  const start = text.indexOf(SECURITY_HEADING)
  if (start < 0) return null
  const rest = text.slice(start + SECURITY_HEADING.length)
  const end = rest.search(/\n## /)
  return (SECURITY_HEADING + (end < 0 ? rest : rest.slice(0, end))).trim()
}

test('보안 정책 절이 정책 3파일에 모두 있다', () => {
  const missing = POLICY_FILES.filter(({ file }) => securitySection(read(file)) === null).map((f) => f.file)
  assert.deepEqual(missing, [],
    `보안 정책 절이 없는 파일이 있다 — 그 도구는 보안을 안 보고 움직인다:\n  ${missing.join('\n  ')}\n` +
    `규칙 SSOT 는 LOOP.md 7절, 재는 방법은 docs/policy/security.md.`)
})

test('보안 정책 절의 본문이 정책 3파일에서 동일하다', () => {
  const base = securitySection(read(POLICY_FILES[0].file))
  assert.ok(base, '기준 파일에 보안 정책 절이 없다')
  const diverged = POLICY_FILES.slice(1)
    .filter(({ file }) => securitySection(read(file)) !== base)
    .map((f) => f.file)
  assert.deepEqual(diverged, [],
    `보안 정책이 파일마다 다르게 적혀 있다:\n  ${POLICY_FILES[0].file} ↔ ${diverged.join(', ')}\n` +
    `한 곳만 고치면 나머지 도구가 옛 기준으로 움직인다. 세 파일을 같은 문장으로 맞춘다.`)
})

test('보안 정책이 가리키는 가드가 실재한다', () => {
  const body = securitySection(read(POLICY_FILES[0].file)) ?? ''
  const referenced = [...body.matchAll(/`(lib\/policy\/[a-z-]+\.test\.ts)`/g)].map((m) => m[1])
  assert.ok(referenced.length >= 4, `가드 인용이 ${referenced.length}개뿐이다 — 절이 비었거나 형식이 바뀌었다`)

  const missing = [...new Set(referenced)].filter((rel) => {
    try { readFileSync(join(ROOT, 'apps/web', rel), 'utf8'); return false } catch { return true }
  })
  assert.deepEqual(missing, [],
    `정책이 없는 가드를 가리킨다 — 지켜지는 줄 알지만 아무도 안 본다:\n  ${missing.join('\n  ')}`)
})

test('보안 세는 명령이 실재하고 다섯 줄을 전부 센다', () => {
  const sql = read('docs/policy/security-count.sql')
  for (const key of [
    'rls_off_tables',
    'anon_write_tables',
    'public_using_true_policies',
    'unpinned_secdef_functions',
    'anon_readable_secdef_views',
  ]) {
    assert.ok(sql.includes(key), `security-count.sql 이 ${key} 를 세지 않는다`)
  }
})

/* ── 완료 보고 — 문서·도구가 같은 문장을 쓴다 ────────── */

/*
  **왜 여기서 보나**: 「끝났으면 끝났다고 말한다」는 규칙이 중량 정책 3파일(M-13)에만 있었고,
  **매 세션 읽는 것은 LOOP.md 하나**였다. 그래서 LOOP 만 읽는 세션은 그 규칙을 볼 길이 없었고,
  실제로 보고가 판정 없이 나가 사용자가 「다 한건지 모르겠어」라고 두 번 물었다(2026-09-20).
  버전 규칙이 열일곱 커밋 동안 안 지켜진 것과 **같은 모양의 구멍**이다.

  그래서 셋을 함께 잠근다 — 규칙(LOOP.md 8절) · 원본(CEO.md M-13) · 도구(loop.mjs 출력).
  하나만 고치면 나머지가 옛 기준으로 남고, 그때 이 가드가 깨진다.
*/
const VERDICT_DONE = '완벽히 끝냈습니다'
const VERDICT_NOT_DONE = '아직 안 끝났습니다'

test('★ 완료 보고 규칙이 매 세션 읽는 LOOP.md 에 있다', () => {
  const loop = read('LOOP.md')
  assert.match(loop, /^## 8 완료 보고$/m,
    'LOOP.md 에 완료 보고 절이 없다 — 중량 문서에만 있으면 LOOP 만 읽는 세션은 못 본다')

  const section = loop.slice(loop.indexOf('## 8 완료 보고'))
  const body = section.slice(0, section.indexOf('\n## ') < 0 ? undefined : section.indexOf('\n## '))
  assert.ok(body.includes(VERDICT_DONE), `판정 문장 「${VERDICT_DONE}」이 없다`)
  assert.ok(body.includes(VERDICT_NOT_DONE), `판정 문장 「${VERDICT_NOT_DONE}」이 없다`)
  // 판정만 있고 근거가 없으면 사용자가 또 묻는다
  assert.match(body, /항목 n\/n/, '판정 옆에 붙일 숫자 규칙이 없다')
  assert.match(body, /무엇을·왜·무엇이 있으면/, '못 한 것을 적는 형식이 없다')
})

test('★ 같은 판정 문장을 중량 정책도 쓴다 — 규칙이 둘로 갈리지 않게', () => {
  for (const { file } of POLICY_FILES) {
    assert.ok(read(file).includes(VERDICT_DONE),
      `${file} 의 M-13 문장이 LOOP.md 8절과 다르다 — 도구마다 다른 말을 하게 된다`)
  }
})

test('★ 도구가 판정 문장을 찍는다 — 글로만 두면 안 지켜진다', () => {
  const cli = read('scripts/loop.mjs')
  assert.ok(cli.includes(`보고 첫 줄: ${VERDICT_DONE}`),
    'loop final 이 완료 판정을 안 찍는다')
  assert.ok(cli.includes(`보고 첫 줄: ${VERDICT_NOT_DONE}`),
    'loop hold·final fail 이 미완 판정을 안 찍는다')
})

test('★ 도구가 완료 판정 전에 미커밋 변경을 센다', () => {
  /*
    판정 기준에는 「내 미커밋 변경이 없고」가 있었는데 도구는 그것을 **한 번도 세지 않았다.**
    완료 커밋은 버전 파일과 플랜 파일과 entries.ts 만 싣는다 — 그 밖에 남은 변경은
    아무 커밋에도 안 실린 일이다. 그런데 도구가 완료 판정을 찍어 주면 보고는 그 줄을
    그대로 옮기고, 끝났다고 적힌 일이 트리에만 남는다.

    문장만 보는 단정으로는 이 검사가 지워져도 초록이다. 그래서 **세는 코드**를 본다.
  */
  const cli = read('scripts/loop.mjs')
  const start = cli.indexOf('cmds.final')
  assert.ok(start > 0, 'loop.mjs 에 final 명령이 없다')
  const body = cli.slice(start)

  assert.match(body, /const leftover = changedFiles\(\)/,
    'loop final 이 미커밋 변경을 세지 않는다 — 판정 기준의 「내 미커밋 변경이 없고」가 도구에 없다')
  assert.ok(
    body.indexOf('leftover.length') < body.indexOf(`보고 첫 줄: ${VERDICT_DONE}`),
    'loop final 이 미커밋을 센 뒤가 아니라 완료 판정을 먼저 찍는다 — 순서가 뒤바뀌면 검사가 무의미하다',
  )
})

// ------------------------------------------------------------
// B-N 배포·대기 규칙 (실측 2026-09-20)
// ------------------------------------------------------------

/*
  M-N 카드만 대조하고 있었고 **B-N 표는 아무도 안 보고 있었다.**

  그래서 「오래 걸리는 일은 무엇을 하는 중인지 말한다」는 규칙이 코드 한 곳
  (`lib/meeting/digest-progress.ts`)에만 있고 정책 3파일에는 한 줄도 없었다.
  옆 화면(견적)은 그 모듈을 볼 길이 없었고, 같은 지적을 세 번 받았다.
  버전 규칙이 열일곱 판 동안 안 지켜진 것과 **똑같은 구멍**이다.
*/

/** `| **B-1** | …` 줄을 규칙 번호별로 모은다 */
function bRules(text: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const line of text.split('\n')) {
    const m = /^\| \*\*(B-[\w-]+)\*\* \|/.exec(line)
    if (m) out.set(m[1], line.trim())
  }
  return out
}

test('★ B-N 규칙이 정책 3파일에 모두 있거나 모두 없다', () => {
  const [a, b, c] = POLICY_FILES.map((f) => [...bRules(read(f.file)).keys()].sort())
  assert.ok(a.length >= 7, `B-N 규칙을 ${a.length}개만 찾았다 — 훑는 규칙이 헛돌고 있다`)
  assert.deepEqual(a, b, 'CEO.md 와 AGENTS.md 의 B-N 목록이 다르다')
  assert.deepEqual(a, c, 'CEO.md 와 GEMINI.md 의 B-N 목록이 다르다')
})

test('★ 같은 B-N 규칙의 문장이 정책 3파일에서 동일하다 — 한 파일만 고치면 규칙이 갈린다', () => {
  const maps = POLICY_FILES.map((f) => bRules(read(f.file)))
  for (const key of maps[0].keys()) {
    assert.equal(maps[1].get(key), maps[0].get(key), `${key} 가 AGENTS.md 에서 다르다`)
    assert.equal(maps[2].get(key), maps[0].get(key), `${key} 가 GEMINI.md 에서 다르다`)
  }
})

test('★ B-7 이 가리키는 SSOT 와 가드가 실재한다 — 없는 파일을 가리키면 규칙이 헛말이다', () => {
  const b7 = bRules(read(POLICY_FILES[0].file)).get('B-7')
  assert.ok(b7, 'B-7(대기 중 진행 표시)이 정책에 없다')
  for (const path of [
    'lib/meeting/digest-progress.ts',
    'components/ui/WaitProgress.tsx',
    'lib/policy/wait-progress-guard.test.ts',
  ]) {
    assert.ok(existsSync(join(ROOT, 'apps/web', path)), `B-7 이 없는 파일을 가리킨다: ${path}`)
  }
  assert.match(b7!, /digest-progress/, 'B-7 이 문구 SSOT 를 안 가리킨다')
  assert.match(b7!, /WaitProgress/, 'B-7 이 그리는 부품을 안 가리킨다')
})

// ------------------------------------------------------------
// U-N 제품 화면 문구 · F-N 기능 완결성 (사용자 지시 2026-10-01)
// ------------------------------------------------------------

/*
  **왜 B-N 과 똑같은 대조를 또 만드나**: 규칙 표를 세 파일에 붙여 놓기만 하면
  다음에 한 파일만 고쳐지고 갈라진다. 그 일이 이 저장소에서 이미 두 번 일어났다 —
  `GEMINI.md` 가 53패치 뒤처진 채 돌았고, B-N 표는 아무도 안 보는 채로 살아 있었다.

  **그리고 LOOP.md 도 본다**: 매 세션 읽는 것은 LOOP.md 하나다. 중량 문서에만 두면
  LOOP 만 읽는 세션은 규칙을 볼 길이 없다 — 버전 규칙이 열일곱 판 동안 안 지켜진 것과
  완료 보고 규칙(8절)이 여기로 옮겨 온 것이 **같은 구멍**이다.

  가드는 만든 뒤 일부러 깨서 실패를 확인했다(U-1 한 글자 변경 · F-1 한 글자 변경 ·
  LOOP.md 9절 삭제 · 가드가 가리키는 파일 이름 변경).
*/

/** `| **U-3** | …` 같은 줄을 규칙 번호별로 모은다 (bRules 와 같은 방식, 접두어만 다르다) */
function ruleRows(text: string, prefix: 'U' | 'F'): Map<string, string> {
  const out = new Map<string, string>()
  const re = new RegExp(`^\\| \\*\\*(${prefix}-[\\w-]+)\\*\\* \\|`)
  for (const line of text.split('\n')) {
    const m = re.exec(line)
    if (m) out.set(m[1], line.trim())
  }
  return out
}

for (const [prefix, least, what] of [
  ['U', 10, '제품 화면 문구'],
  ['F', 12, '기능 완결성'],
] as const) {
  test(`★ ${prefix}-N(${what}) 규칙이 정책 3파일에 모두 있거나 모두 없다`, () => {
    const [a, b, c] = POLICY_FILES.map((f) => [...ruleRows(read(f.file), prefix).keys()].sort())
    assert.ok(
      a.length >= least,
      `${prefix}-N 규칙을 ${a.length}개만 찾았다 (최소 ${least}) — 훑는 규칙이 헛돌거나 표가 지워졌다`,
    )
    assert.deepEqual(a, b, `CEO.md 와 AGENTS.md 의 ${prefix}-N 목록이 다르다`)
    assert.deepEqual(a, c, `CEO.md 와 GEMINI.md 의 ${prefix}-N 목록이 다르다`)
  })

  test(`★ 같은 ${prefix}-N 규칙의 문장이 정책 3파일에서 동일하다 — 한 파일만 고치면 규칙이 갈린다`, () => {
    const maps = POLICY_FILES.map((f) => ruleRows(read(f.file), prefix))
    for (const key of maps[0].keys()) {
      assert.equal(maps[1].get(key), maps[0].get(key), `${key} 가 AGENTS.md 에서 다르다`)
      assert.equal(maps[2].get(key), maps[0].get(key), `${key} 가 GEMINI.md 에서 다르다`)
    }
  })
}

test('★ U-N·F-N 이 매 세션 읽는 LOOP.md 에도 있다 — 중량 문서에만 있으면 LOOP 만 읽는 세션은 못 본다', () => {
  const loop = read('LOOP.md')
  assert.match(loop, /^## 9 화면과 기능의 기준$/m, 'LOOP.md 에 9절이 없다')
  assert.match(loop, /U-N 제품 화면 문구/, 'LOOP.md 9절에 U-N 항목이 없다')
  assert.match(loop, /F-N 기능 완결성/, 'LOOP.md 9절에 F-N 항목이 없다')
})

test('★ 항목마다 도는 자가감사가 U-N·F-N 을 부른다 — 절만 있고 안 불리면 글로만 남는다', () => {
  const loop = read('LOOP.md')
  // 2절 자가감사 목록에 화면 문구(h)와 기능 완결성(i) 줄이 실재하는가
  assert.match(loop, /^\s+h 화면 문구:.*U-N/m, '자가감사에 화면 문구 줄이 없다')
  assert.match(loop, /^\s+i 기능 완결성:.*F-N/m, '자가감사에 기능 완결성 줄이 없다')
  assert.match(loop, /자가감사 9항/, '자가감사 항 수가 안 맞는다 — 줄을 더하고 머리말을 안 고쳤다')
})

test('★ U-N·F-N 이 가리키는 가드와 부품이 실재한다 — 없는 파일을 가리키면 규칙이 헛말이다', () => {
  const ceo = read(POLICY_FILES[0].file)
  const u = ruleRows(ceo, 'U')
  assert.match(u.get('U-1') ?? '', /product-copy\.test\.ts/, 'U-1 이 가드를 안 가리킨다')
  assert.match(u.get('U-7') ?? '', /useAskDialog/, 'U-7 이 대체 부품을 안 가리킨다')
  assert.match(u.get('U-7') ?? '', /native-dialog\.test\.ts/, 'U-7 이 가드를 안 가리킨다')
  for (const path of [
    'lib/ui/product-copy.test.ts',
    'lib/ui/native-dialog.test.ts',
    'scripts/.product-copy-baseline.json',
    'components/ui/useAskDialog.tsx',
    'components/ui/ConfirmDeleteDialog.tsx',
    'lib/terms/index.ts',
  ]) {
    assert.ok(existsSync(join(ROOT, 'apps/web', path)), `U-N 이 없는 파일을 가리킨다: ${path}`)
  }
  assert.ok(existsSync(join(ROOT, 'scripts/ui-phrases.mjs')), 'U-6 이 가리키는 판정 SSOT 가 없다')
})

// ------------------------------------------------------------
// 푸시 규칙 — 글·훅·도구가 같은 말을 한다 (실측 2026-09 Vercel Pro Usage)
// ------------------------------------------------------------

/*
  **왜 가드가 필요한가**: 푸시 한 번이 Vercel 빌드 한 번이다. 2026-09 실측으로 빌드가
  인프라 요금의 92.1퍼센트(354시간 74.34달러)를 먹었고, 그달 커밋은 1,003건인데
  푸시는 111회였다. 9월 9일은 커밋 119건에 푸시 3회라 요금이 거의 0이었고,
  9월 20일은 커밋 118건에 푸시 18회라 그달 최고점이었다 — 요금의 분모는 커밋이 아니라 푸시다.

  그래서 「모아서 민다」를 규칙으로 세웠는데, 규칙을 글로만 두면 안 지켜진다.
  버전 규칙이 열일곱 판 동안 안 지켜졌고(LOOP.md 부록), 완료 보고 규칙도 같은 구멍이었다.
  그래서 넷을 함께 잠근다 — 규정(LOOP.md 부록 + 정책 3파일) · 잠금(.githooks/pre-push) ·
  도구(scripts/loop.mjs 출력). 하나만 고치면 나머지가 옛 기준으로 남고, 그때 이 가드가 깨진다.
*/
const PUSH_HEADING = '## 푸시 규칙 (필수, 푸시 한 번이 빌드 한 번이다)'
/** 규칙 넷의 핵심 문장. 글·훅·도구가 **같은 낱말**을 써야 세 자리가 한 규칙으로 읽힌다. */
const PUSH_RULE_NO_ITEM_PUSH = '항목 커밋은 푸시하지 않는다'
const PUSH_RULE_ONE_PER_PLAN = '플랜 하나가 푸시 하나다'
const PUSH_ESCAPE = 'LOOP_PUSH_NOW'

function pushSection(text: string): string | null {
  const start = text.indexOf(PUSH_HEADING)
  if (start < 0) return null
  const rest = text.slice(start + PUSH_HEADING.length)
  const end = rest.search(/\n## /)
  return (PUSH_HEADING + (end < 0 ? rest : rest.slice(0, end))).trim()
}

test('★ 푸시 규칙이 매 세션 읽는 LOOP.md 에 있다', () => {
  const loop = read('LOOP.md')
  assert.match(loop, /^### 푸시 규칙$/m,
    'LOOP.md 부록에 푸시 규칙 절이 없다 — 중량 문서에만 있으면 LOOP 만 읽는 세션은 못 본다')

  const start = loop.indexOf('### 푸시 규칙')
  const rest = loop.slice(start + '### 푸시 규칙'.length)
  const end = rest.search(/\n#{2,3} /)
  const body = end < 0 ? rest : rest.slice(0, end)

  for (const s of [PUSH_RULE_NO_ITEM_PUSH, PUSH_RULE_ONE_PER_PLAN, PUSH_ESCAPE]) {
    assert.ok(body.includes(s), `푸시 규칙에 「${s}」가 없다 — 규칙 넷 중 하나가 빠졌다`)
  }
  // 규칙만 있고 왜가 없으면 다음 사람이 "빌드 좀 더 돈다고 뭐 어때"로 되돌린다
  assert.ok(body.includes('74.34달러') && body.includes('111회'),
    '푸시 규칙에 2026-09 실측 근거(74.34달러 / 푸시 111회)가 없다 — 왜가 빠지면 규칙은 되돌려진다')
})

test('★ 푸시 규칙이 정책 3파일에 같은 문장으로 있다', () => {
  const missing = POLICY_FILES.filter(({ file }) => pushSection(read(file)) === null).map((f) => f.file)
  assert.deepEqual(missing, [],
    `푸시 규칙 절이 없는 파일이 있다 — 그 도구는 항목마다 밀어서 빌드를 태운다:\n  ${missing.join('\n  ')}`)

  const base = pushSection(read(POLICY_FILES[0].file))
  const diverged = POLICY_FILES.slice(1)
    .filter(({ file }) => pushSection(read(file)) !== base)
    .map((f) => f.file)
  assert.deepEqual(diverged, [],
    `푸시 규칙이 파일마다 다르게 적혀 있다: ${POLICY_FILES[0].file} ↔ ${diverged.join(', ')}`)
})

test('★ 훅이 푸시를 실제로 막는다 — 글로만 두면 안 지켜진다', () => {
  const rel = '.githooks/pre-push'
  assert.ok(existsSync(join(ROOT, rel)),
    `${rel} 가 없다 — 규칙이 글에만 있으면 세션이 바뀔 때마다 다시 민다`)

  // 실행 비트가 없으면 git 은 훅을 **조용히 건너뛴다**. 있는데 안 도는 것이 가장 나쁘다.
  assert.ok((statSync(join(ROOT, rel)).mode & 0o111) !== 0,
    `${rel} 에 실행 권한이 없다 — git 이 훅을 조용히 건너뛴다 (chmod +x)`)

  const hook = read(rel)
  assert.ok(hook.includes(PUSH_ESCAPE),
    `${rel} 에 ${PUSH_ESCAPE} 탈출구가 없다 — 운영이 멈춘 것을 되살릴 길이 막힌다`)
  assert.match(hook, /완료\*\|중단\*/,
    `${rel} 가 플랜 상태를 안 본다 — 무엇을 막고 무엇을 통과시키는지가 조건에 없다`)
  /*
    .loop/PLAN*.md 를 통째로 훑으면 끝내지 않고 둔 옛 플랜에 걸려 푸시가 영영 막힌다
    (실측 2026-10-08: P0001·P0030·P0052·P0114 넷이 「진행중」인 채로 남아 있었다).

    **주석은 빼고 본다.** 첫 판은 훑는 패턴을 파일 전체에서 찾았는데, 훅이 바로 그
    「PLAN*.md 를 훑으면 안 된다」를 주석으로 적어 둔 탓에 가드가 멀쩡한 훅을 잡았다.
    가드는 적힌 말이 아니라 **도는 코드**를 봐야 한다.
  */
  const code = hook.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')
  assert.ok(!/PLAN\*\.md|PLAN\.\*\.md/.test(code),
    `${rel} 가 .loop/PLAN*.md 전부를 훑는다 — 옛 플랜이 진행중으로 남아 있으면 푸시가 영영 막힌다`)
})

/*
  판 번호 규칙 — 플랜 하나가 판 하나다 (사용자 지시 2026-10-09 ins_0215)

  **왜 가드가 필요한가**: 항목마다 패치를 올리면 커밋 수가 그대로 판 수가 된다.
  실측 2026-10-09 로 30일 998 커밋에 7일 134 커밋이었고, 그 가운데 80건은 버전 파일을
  뺀 실제 코드가 2개 이하였다. 그래서 patch 999 상한을 달마다 넘겼고 그날
  v0.10.999 에서 v0.11.0 으로 넘어갔다 — 그 넘김이 새 플랜을 전부 막은 전례가 있다.

  규칙이 글 한 곳에만 있으면 안 지켜진다. 푸시 규칙과 버전 규칙이 그랬다.
  그래서 네 자리가 같은 말을 하는지 본다 — 규정(LOOP.md 부록 + 정책 3파일),
  훅(.githooks/commit-msg), 도구(scripts/loop.mjs), 가드(version-rule + changelog-grouping).
*/
const PLAN_NUMBER_HEADING = '## 판 번호 규칙 (필수, 플랜 하나가 판 하나다)'
/** 두 핵심 문장. 규정 네 파일이 **같은 낱말**을 써야 한 규칙으로 읽힌다. */
const PN_RULE_ONE_PER_PLAN = '플랜 하나가 판 하나다'
const PN_RULE_NO_ITEM_BUMP = '항목 커밋은 패치를 올리지 않는다'

function planNumberSection(text: string): string | null {
  const start = text.indexOf(PLAN_NUMBER_HEADING)
  if (start < 0) return null
  const rest = text.slice(start + PLAN_NUMBER_HEADING.length)
  const end = rest.search(/\n## /)
  return (PLAN_NUMBER_HEADING + (end < 0 ? rest : rest.slice(0, end))).trim()
}

test('★ 판 번호 규칙이 매 세션 읽는 LOOP.md 에 있다', () => {
  const loop = read('LOOP.md')
  assert.match(loop, /^### 버전 규칙$/m,
    'LOOP.md 부록에 버전 규칙 절이 없다 — 중량 문서에만 있으면 LOOP 만 읽는 세션은 못 본다')

  const start = loop.indexOf('### 버전 규칙')
  const rest = loop.slice(start + '### 버전 규칙'.length)
  const end = rest.search(/\n#{2,3} /)
  const body = end < 0 ? rest : rest.slice(0, end)

  for (const sentence of [PN_RULE_ONE_PER_PLAN, PN_RULE_NO_ITEM_BUMP]) {
    assert.ok(body.includes(sentence),
      `LOOP.md 부록 버전 규칙에 「${sentence}」가 없다 — 그 세션은 항목마다 패치를 올린다`)
  }
  // 규칙만 있고 왜가 없으면 다음 사람이 "항목마다 올리는 게 깔끔하지"로 되돌린다
  assert.ok(body.includes('v0.10.999') && body.includes('998'),
    'LOOP.md 버전 규칙에 2026-10-09 실측 근거(998 커밋 / v0.10.999 넘김)가 없다 — 왜가 빠지면 규칙은 되돌려진다')
})

test('★ 판 번호 규칙이 정책 3파일에 같은 문장으로 있다', () => {
  const missing = POLICY_FILES.filter(({ file }) => planNumberSection(read(file)) === null).map((f) => f.file)
  assert.deepEqual(missing, [],
    `판 번호 규칙 절이 없는 파일이 있다 — 그 도구는 항목마다 패치를 올려 판 번호를 태운다:\n  ${missing.join('\n  ')}`)

  const base = planNumberSection(read(POLICY_FILES[0].file))
  const diverged = POLICY_FILES.slice(1)
    .filter(({ file }) => planNumberSection(read(file)) !== base)
    .map((f) => f.file)
  assert.deepEqual(diverged, [],
    `판 번호 규칙이 파일마다 다르게 적혀 있다: ${POLICY_FILES[0].file} ↔ ${diverged.join(', ')}`)
})

test('★ 옛 셈법 문장이 규정 네 파일에 남아 있지 않다', () => {
  /*
    바꾼 뒤 옛 문장이 남으면 같은 파일이 반대되는 답 둘을 갖는다. LOOP.md 본문이
    「기능 추가는 minor」라 적고 부록이 「patch 1 을 더한 값」이라 적던 그 모양이다.
  */
  const STALE = ['항목 커밋도 한 판이다', '항목마다 패치를 하나 올린', '그때 다시 계산한 다음 패치']
  const found: string[] = []
  for (const file of ['LOOP.md', ...POLICY_FILES.map((f) => f.file)]) {
    const text = read(file)
    for (const stale of STALE) if (text.includes(stale)) found.push(`${file}: ${stale}`)
  }
  assert.deepEqual(found, [],
    `옛 셈법 문장이 남아 있다 — 읽는 세션이 그쪽을 따른다:\n  ${found.join('\n  ')}`)
})

test('★ 도구가 푸시 시점을 찍는다 — 규칙과 같은 문장으로', () => {
  const cli = read('scripts/loop.mjs')
  assert.ok(cli.includes(PUSH_RULE_NO_ITEM_PUSH),
    `loop pass 가 「${PUSH_RULE_NO_ITEM_PUSH}」를 안 찍는다 — 항목마다 밀게 된다`)
  assert.ok(cli.includes(PUSH_RULE_ONE_PER_PLAN),
    `loop final 이 「${PUSH_RULE_ONE_PER_PLAN}」를 안 찍는다 — 언제 밀어야 하는지 아무도 안 말한다`)
  assert.ok(cli.includes('unpushedCount'),
    'loop CLI 가 미푸시 커밋 수를 안 센다 — 모으고 있다는 사실이 안 보이면 불안해서 민다')
})

/*
  **푸시 타이밍** — 모으기만 하면 고친 것이 안 간다 (사용자 지시 2026-10-09 ins_0213).

  앞 판(v0.10.994)은 「플랜 완료 때 한 번」만 두어 운영 결함을 고쳐 놓고도 못 미는 규칙이 됐다.
  실제 운영 방식은 그 반대였다 — 오류가 있으니 고치는 대로 밀어 왔던 것이고, 그게 맞다.
  그래서 판정 한 줄(지금 안 밀면 사용자가 계속 막히나)로 즉시와 모음을 가르고,
  그 답을 플랜 헤더 「푸시:」 한 칸에 적어 훅과 도구가 읽게 했다.

  아래 넷은 **그 한 칸이 네 자리에서 같은 뜻으로 읽히는지**를 본다. 규칙만 고치고 템플릿을
  안 고치면 칸이 안 생기고, 훅만 고치고 CLI 를 안 고치면 막지는 않는데 밀라고도 안 한다.
*/
const PUSH_VERDICT = '지금 안 밀면 사용자가 계속 막히나'
const PUSH_HEADER_NOW = '푸시: 즉시'
const PUSH_HEADER_HOLD = '푸시: 모음'

test('★ 푸시 타이밍 판정이 네 파일에 있고 무엇이 즉시인지 분류한다', () => {
  const loop = read('LOOP.md')
  const s = loop.indexOf('### 푸시 규칙')
  assert.ok(s >= 0, 'LOOP.md 부록에 푸시 규칙 절이 없다')
  const rest = loop.slice(s)
  const loopBody = rest.slice(0, rest.search(/\n#{2,3} /))

  for (const [where, body] of [['LOOP.md', loopBody], ...POLICY_FILES.map(({ file }) => [file, pushSection(read(file)) ?? ''] as const)]) {
    assert.ok(body.includes(PUSH_VERDICT),
      `${where} 에 판정 한 줄 「${PUSH_VERDICT}」이 없다 — 가르는 기준이 없으면 매번 "일단 밀자"가 된다`)
    for (const v of [PUSH_HEADER_NOW, PUSH_HEADER_HOLD]) {
      assert.ok(body.includes(v), `${where} 에 헤더 값 「${v}」가 안 적혀 있다`)
    }
  }
  // 판정 줄만 있고 분류가 없으면 무엇이 "막히는 것"인지에서 또 갈린다
  const rows = (loopBody.match(/^\| (운영|기능|문서)/gm) ?? []).length
  assert.ok(rows >= 4, `무엇을 고쳤을 때 즉시인지 분류한 표가 ${rows}줄뿐이다 — 네 줄 이상이어야 판정이 선다`)
})

test('★ 플랜 템플릿 두 벌에 푸시 칸이 있다 — 한 벌만 고치면 칸이 안 생긴다', () => {
  /*
    템플릿은 **두 벌**이다: `.loop/PLAN.template.md` 파일과 `scripts/loop.mjs` 안의
    DEFAULT_TEMPLATE. 파일이 없는 클론은 뒤엣것으로 떨어지므로, 한 벌만 고치면
    그 클론의 플랜에는 푸시 칸이 영영 안 생기고 훅은 전부 모음으로 읽는다.
  */
  for (const rel of ['.loop/PLAN.template.md', 'scripts/loop.mjs']) {
    assert.ok(read(rel).includes('푸시: {{push}}'),
      `${rel} 템플릿에 푸시 칸이 없다 — 이 벌로 만든 플랜은 타이밍을 못 적는다`)
  }
  const cli = read('scripts/loop.mjs')
  assert.match(cli, /const PUSH_MODES = \['즉시', '모음'\]/,
    'loop CLI 가 푸시 값 두 가지를 정의하지 않는다 — 아무 값이나 들어오면 훅이 모음으로 읽는다')
  assert.match(cli, /const PUSH_DEFAULT = '모음'/,
    '기본값이 모음이 아니다 — 안 적으면 매번 밀게 되고 빌드 요금이 돌아온다')
  assert.ok(cli.includes('푸시 줄 없음 또는 값 오류'),
    'loop plan check 가 푸시 줄을 요구하지 않는다 — 칸이 비어도 플랜이 통과한다')
})

test('★ 훅이 두 값을 모두 보고 갈린다', () => {
  const hook = read('.githooks/pre-push')
  const code = hook.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')
  assert.match(code, /"\$mode" = "즉시"/,
    '.githooks/pre-push 가 즉시를 안 본다 — 운영 결함을 고쳐도 못 민다')
  assert.ok(code.includes('모음'),
    '.githooks/pre-push 가 모음을 안 본다 — 모을 이유가 코드에 없다')
  // 모르는 값을 통과시키면 가드가 아니다. 옛 플랜에는 이 칸이 아예 없다.
  assert.ok(code.includes('푸시 줄 없음, 모음으로 봄'),
    '.githooks/pre-push 가 푸시 줄 없는 옛 플랜을 어느 쪽으로 보는지 안 정했다')
  // 막기만 하고 푸는 법을 안 알려 주면 사람은 훅을 끈다
  assert.ok(hook.includes('LOOP_PUSH_NOW') && hook.includes('푸시: 즉시'),
    '.githooks/pre-push 거절 메시지에 푸는 두 길(LOOP_PUSH_NOW / 헤더를 즉시로)이 없다')
})

test('★ 도구가 즉시와 모음에 다른 말을 한다', () => {
  const cli = read('scripts/loop.mjs')
  assert.ok(cli.includes('지금 민다, git push'),
    'loop pass 가 즉시 플랜에서 밀라고 말하지 않는다 — 막지도 않고 알리지도 않으면 안 민다')
  assert.match(cli, /header\.push === '즉시'/,
    'loop CLI 가 플랜 헤더의 푸시 값으로 갈리지 않는다 — 두 경우에 같은 말을 하게 된다')
  assert.ok(cli.includes("푸시 ${p.header.push || '없음(모음으로 봄)'}"),
    'loop resume 가 이 플랜의 푸시 타이밍을 안 보여 준다 — 재개한 세션이 모르고 민다')
})
