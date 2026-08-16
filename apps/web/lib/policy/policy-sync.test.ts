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
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/** apps/web/lib/policy → 저장소 루트. cwd에 의존하지 않게 파일 위치에서 거슬러 올라간다. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')

/** 도구별 정책 파일과, 그 파일이 커밋 예시에 쓰는 서명. 서명 차이는 **의도된 것**이다. */
const POLICY_FILES = [
  { file: 'CLAUDE.md', agent: 'claude' },
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
