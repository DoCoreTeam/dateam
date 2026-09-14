/**
 * 능력과 부품의 짝 가드 — 「결과는 나오는데 옆에 있어야 할 것이 없다」를 막는다
 *
 * **왜**: 같은 AI 결과라도 능력에 따라 **함께 보여야 하는 것**이 다르다.
 *   추출은 사람이 고르기 전에 확정되면 안 되고, 생성은 미리보기 없이 저장되면 안 되고,
 *   판정은 근거 없이 뜨면 안 되고, 질의응답은 출처 없이 답하면 안 된다.
 *
 *   이 넷은 지금까지 「그렇게 하기로 했다」로만 있었다. 화면 스물여덟이 각자 그리는 동안
 *   고친흔적은 **어느 화면에도 없었고** 생성고지는 **한 곳뿐**이었다(3단계 실측).
 *   적어 둔 것과 지켜지는 것은 다른 명제이고, 지켜지는지 보는 것이 이 가드다.
 *
 * 검사 넷:
 *   1) 능력마다 필요한 표시가 정해져 있다 (REQUIRED_PRESENTATION 이 비지 않았다)
 *   2) 필요한 표시마다 그것을 그리는 부품이 패키지에 실재한다
 *   3) 부품이 한 곳에서 다 나온다 (index 가 여덟을 전부 내보낸다)
 *   4) 규칙이 도는 대상이 실제로 있다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AI_CAPABILITIES, REQUIRED_PRESENTATION } from '@ax/ai-core'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
const REACT_SRC = join(ROOT, 'packages', 'ai-react', 'src')

/** 표시 이름 -> 그것을 그리는 부품 파일. 이 짝이 이 가드의 본체다 */
const DRAWN_BY: Record<string, string> = {
  'candidate-list': 'CandidateList.tsx',
  'generated-notice': 'GeneratedNotice.tsx',
  'evidence': 'Evidence.tsx',
  'preview': 'SuggestionDiff.tsx',
  'source': 'AiValue.tsx',
}

/** 능력 여덟과 무관하게 계약이 요구하는 나머지 부품 */
const ALSO_REQUIRED = ['CorrectionTrail.tsx', 'AskAgain.tsx', 'Progress.tsx']

function reactFiles(): string[] {
  return readdirSync(REACT_SRC)
}

test('★ 능력마다 함께 보여야 하는 것이 정해져 있다', () => {
  const empty = AI_CAPABILITIES.filter((c) => (REQUIRED_PRESENTATION[c] ?? []).length === 0)
  assert.deepEqual(empty, [], [
    '능력은 있는데 그 결과를 무엇과 함께 보여야 하는지가 없다.',
    '표시 규칙 없이 늘어난 능력의 결과는 아무 규칙도 없이 화면에 간다:',
    ...empty.map((c) => `  ${c}`),
  ].join('\n'))
})

test('★ 필요한 표시마다 그리는 부품이 실재한다', () => {
  const files = new Set(reactFiles())
  const missing: string[] = []
  for (const capability of AI_CAPABILITIES) {
    for (const need of REQUIRED_PRESENTATION[capability]) {
      const file = DRAWN_BY[need]
      if (!file) { missing.push(`${capability} 가 요구하는 ${need} 를 그리는 부품이 짝표에 없다`); continue }
      if (!files.has(file)) missing.push(`${capability} 가 요구하는 ${need} 의 부품 ${file} 이 없다`)
    }
  }
  assert.deepEqual(missing, [], [
    '능력이 요구하는 표시를 그릴 부품이 없다.',
    '부품 없이 규칙만 적어 두면 화면마다 자기 방식으로 그리게 된다:',
    ...missing.map((m) => `  ${m}`),
  ].join('\n'))
})

test('★ 부품 여덟이 한 곳에서 다 나온다', () => {
  const index = readFileSync(join(REACT_SRC, 'index.ts'), 'utf8')
  const wanted = [...new Set(Object.values(DRAWN_BY).concat(ALSO_REQUIRED))]
  const notExported = wanted
    .map((f) => ({ f, name: f.replace('.tsx', '') }))
    .filter(({ f, name }) => !index.includes(`./${f}`) || !new RegExp(`\\b${name}\\b`).test(index))
    .map(({ f }) => f)
  assert.deepEqual(notExported, [], [
    '부품이 있는데 한 곳에서 안 나온다. 쓰는 쪽이 경로를 외워야 하면 안 쓰게 된다:',
    ...notExported.map((f) => `  ${f}`),
  ].join('\n'))
})

test('규칙이 도는 대상이 실제로 있다', () => {
  // 경로가 깨져 0개가 되면 위 검사는 «위반 없음»으로 통과해 버린다
  assert.equal(AI_CAPABILITIES.length, 8)
  assert.ok(reactFiles().length >= 10, `부품 소스를 ${reactFiles().length}개만 찾았다`)
  assert.ok(Object.keys(DRAWN_BY).length >= 5)
})
