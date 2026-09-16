/**
 * AI 패키지 경계 가드, 패키지가 이 저장소 없이는 못 도는 상태가 되는 것을 막는다
 *
 * **왜**: `packages/*` 는 나중에 따로 발행할 것을 전제로 만들었다. 그런데 경계는
 * 지키기로 정한 순간이 아니라 **기계가 보기 시작한 순간부터** 지켜진다.
 * 이 저장소의 실측이 그렇다. 검사 가드가 붙은 부품은 평균 16.2개 화면이 쓰고,
 * 가드가 없는 부품은 7.4개다. 부품과 가드는 같은 작업이지 두 작업이 아니다.
 *
 * 검사 넷:
 *   1) 패키지 안에 한글이 한 글자도 없다 (주석 포함)
 *   2) 패키지가 저장소 코드를 import 하지 않는다
 *   3) 능력이 늘면 그 능력을 어떻게 보여야 하는지도 같이 는다
 *   4) 규칙이 도는 대상이 실제로 있다
 *
 * 1이 필요한 이유: 부품이 한글을 가지면 그 부품을 쓰는 모든 화면의 문구가 부품에 묶인다.
 *   말은 쓰는 쪽이 정해야 하고, 그래야 같은 부품이 다른 말로 쓰일 수 있다.
 * 3이 필요한 이유: 능력이 늘 때 부품과 카탈로그가 같이 안 늘면 층이 다시 갈린다.
 *   여덟 번째 능력을 더하면서 보여 주는 법을 안 적으면 그 능력의 결과는 아무 규칙도 없이 화면에 간다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

/** apps/web/lib/policy → 저장소 루트 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
const PACKAGES = join(ROOT, 'packages')

/** 가드는 좁게 본다. packages 밖 파일은 이 규칙의 대상이 아니다 */
function packageSources(): { path: string; rel: string; src: string }[] {
  const out: { path: string; rel: string; src: string }[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules') continue
      const full = join(dir, name)
      if (statSync(full).isDirectory()) { walk(full); continue }
      if (!name.endsWith('.ts')) continue
      out.push({ path: full, rel: relative(ROOT, full), src: readFileSync(full, 'utf8') })
    }
  }
  walk(PACKAGES)
  return out
}

/** 한글 음절과 자모 전부 */
const HANGUL = /[가-힣ㄱ-ㆎ]/

/**
 * 한글을 들고 있어도 되는 자리. 사유를 함께 적는다.
 *
 * 규칙의 목적은 **부품이 화면에 나갈 말을 갖지 않는 것**이다. 시험 자료는 화면에 안 간다.
 * 그리고 지역 규칙(한국 개인정보)을 시험하려면 한국어 자료가 있어야 한다 —
 * 로마자로 바꿔 놓으면 시험이 진짜 경우를 안 밟는다.
 *
 * 사유 없이 이름만 넣을 수 있게 두면 이 목록이 면제 서랍이 된다.
 */
const KOREAN_ALLOWED: Record<string, string> = {
  'packages/ai-gateway/src/mask.test.ts':
    '한국 개인정보 가림을 시험하는 자료다. 로마자로 바꾸면 한글 이름 겹침 같은 진짜 경우를 못 밟는다',
}

test('★ 패키지 안에 한글이 없다, 말은 쓰는 쪽이 정한다', () => {
  const offenders: string[] = []
  for (const f of packageSources()) {
    if (f.rel in KOREAN_ALLOWED) continue
    const lines = f.src.split('\n')
    lines.forEach((line, i) => {
      if (HANGUL.test(line)) offenders.push(`${f.rel}:${i + 1}  ${line.trim().slice(0, 60)}`)
    })
  }
  assert.deepEqual(offenders, [], [
    '패키지가 한글을 들고 있다. 부품이 문구를 가지면 그 부품을 쓰는 화면이 전부 그 말에 묶인다:',
    ...offenders.map((o) => `  ${o}`),
  ].join('\n'))
})

test('★ 패키지가 저장소를 import 하지 않는다, 한 방향으로만 흐른다', () => {
  const offenders: string[] = []
  for (const f of packageSources()) {
    const imports = [...f.src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1])
    for (const spec of imports) {
      const escapes = spec.startsWith('@/')
        || spec.includes('apps/web')
        || /^(\.\.\/){3,}/.test(spec)
      if (escapes) offenders.push(`${f.rel} → ${spec}`)
    }
  }
  assert.deepEqual(offenders, [], [
    '패키지가 저장소 코드를 가져다 쓴다. 그러면 따로 발행할 수 없다:',
    ...offenders.map((o) => `  ${o}`),
  ].join('\n'))
})

test('★ 능력이 늘면 보여 주는 법도 같이 는다', async () => {
  const { AI_CAPABILITIES, REQUIRED_PRESENTATION } = await import('@ax/ai-core')
  const missing = AI_CAPABILITIES.filter(
    (c) => !REQUIRED_PRESENTATION[c] || REQUIRED_PRESENTATION[c].length === 0,
  )
  assert.deepEqual(missing, [], [
    '능력은 있는데 그 결과를 어떻게 보여야 하는지가 없다:',
    ...missing.map((m) => `  ${m}`),
  ].join('\n'))
  const extra = Object.keys(REQUIRED_PRESENTATION).filter(
    (k) => !(AI_CAPABILITIES as readonly string[]).includes(k),
  )
  assert.deepEqual(extra, [], `없는 능력의 표시 규칙이 남아 있다: ${extra.join(', ')}`)
})

test('규칙이 도는 대상이 실제로 있다', () => {
  // 경로가 틀려 0개가 되면 위 둘은 «전부 통과»로 보인다. 가장 위험한 실패다
  const n = packageSources().length
  assert.ok(n >= 8, `패키지 소스를 ${n}개만 찾았다, 훑는 경로가 깨졌는지 확인한다`)
})

test('★ 한글 면제는 사유와 함께 적고, 시험 자료에만 준다', () => {
  const noReason = Object.entries(KOREAN_ALLOWED)
    .filter(([, why]) => why.trim().length === 0)
    .map(([f]) => f)
  assert.deepEqual(noReason, [], `사유 없이 면제된 파일: ${noReason.join(', ')}`)

  // 면제는 시험 자료에만 준다. 소스가 한글을 들면 그 부품을 쓰는 화면이 그 말에 묶인다
  const notTest = Object.keys(KOREAN_ALLOWED).filter((f) => !f.endsWith('.test.ts'))
  assert.deepEqual(notTest, [], [
    '시험이 아닌 파일이 면제됐다. 부품 소스가 한글을 들면 쓰는 화면이 그 말에 묶인다:',
    ...notTest.map((f) => `  ${f}`),
  ].join('\n'))

  const gone = Object.keys(KOREAN_ALLOWED).filter((f) => !packageSources().some((s) => s.rel === f))
  assert.deepEqual(gone, [], `면제 목록에 없는 파일: ${gone.join(', ')}`)
})
