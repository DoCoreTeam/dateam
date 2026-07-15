import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildSynthesisPrompt,
  checkCoverage,
  buildAppendix,
  applyPatches,
  type DigestItem,
} from './synthesize-hierarchical.ts'

function makeItems(n: number): DigestItem[] {
  return Array.from({ length: n }, (_, i) => ({
    idx: i + 1,
    itemText: `원문 항목 ${i + 1} 상세 설명입니다.`,
    digest: `요약 ${i + 1}`,
  }))
}

test('buildSynthesisPrompt: 전 [#idx] 토큰 포함 + command 반영 + budget 미만이면 collapsed=false', () => {
  const items = makeItems(5)
  const { prompt, collapsed } = buildSynthesisPrompt(items, '전체 회의 내용을 종합해줘', {
    budgetChars: 5000,
  })
  assert.equal(collapsed, false)
  assert.match(prompt, /전체 회의 내용을 종합해줘/)
  for (const item of items) {
    assert.match(prompt, new RegExp(`\\[#${item.idx}\\]`))
  }
})

test('buildSynthesisPrompt: budget 초과 시 collapsed=true, 그래도 전 idx 토큰 보존', () => {
  const items = makeItems(50)
  const { prompt, collapsed } = buildSynthesisPrompt(items, '요약', { budgetChars: 200 })
  assert.equal(collapsed, true)
  for (const item of items) {
    assert.match(prompt, new RegExp(`\\[#${item.idx}\\]`))
  }
})

test('checkCoverage: 전 idx 존재하면 missing=[]', () => {
  const allIdx = [1, 2, 3]
  const output = '문단1 [#1]\n\n문단2 [#2]\n\n문단3 [#3]'
  const report = checkCoverage(output, allIdx)
  assert.deepEqual(report.missing, [])
  assert.deepEqual(report.covered, [1, 2, 3])
  assert.equal(report.total, 3)
})

test('checkCoverage: 1개 누락 시 missing에 해당 idx만 포함', () => {
  const allIdx = [1, 2, 3]
  const output = '문단1 [#1]\n\n문단3 [#3]'
  const report = checkCoverage(output, allIdx)
  assert.deepEqual(report.missing, [2])
  assert.deepEqual(report.covered, [1, 3])
})

test('checkCoverage: 중복 토큰이 있어도 정상 처리(한 번만 카운트)', () => {
  const allIdx = [1, 2]
  const output = '[#1] 첫 문단 ... 다시 언급 [#1]\n\n[#2] 두번째'
  const report = checkCoverage(output, allIdx)
  assert.deepEqual(report.missing, [])
  assert.deepEqual(report.covered, [1, 2])
})

test('buildAppendix: missing 항목 전부 원문(itemText)+digest 포함, 마크다운 유효', () => {
  const items = makeItems(4)
  const appendix = buildAppendix(items, [2, 4])
  assert.match(appendix, /^## /)
  assert.match(appendix, /\[#2\]/)
  assert.match(appendix, /\[#4\]/)
  assert.match(appendix, /원문 항목 2 상세 설명입니다\./)
  assert.match(appendix, /원문 항목 4 상세 설명입니다\./)
  assert.match(appendix, /요약 2/)
  assert.match(appendix, /요약 4/)
  // 누락되지 않은 항목은 부록에 없어야 함
  assert.doesNotMatch(appendix, /\[#1\]/)
  assert.doesNotMatch(appendix, /\[#3\]/)
})

test('buildAppendix: missing이 빈 배열이면 빈 문자열', () => {
  const items = makeItems(3)
  assert.equal(buildAppendix(items, []), '')
})

test('핵심 불변: checkCoverage 누락 → buildAppendix append → 재검사 시 missing=[] (전 항목 물리 존재 보장)', () => {
  const items = makeItems(6)
  const allIdx = items.map((i) => i.idx)
  // AI가 3, 5를 빠뜨린 시나리오
  const synthOutput = '문단A [#1][#2]\n\n문단B [#4]\n\n문단C [#6]'

  const firstReport = checkCoverage(synthOutput, allIdx)
  assert.deepEqual(firstReport.missing, [3, 5])

  const appendix = buildAppendix(items, firstReport.missing)
  const finalOutput = `${synthOutput}\n\n${appendix}`

  const finalReport = checkCoverage(finalOutput, allIdx)
  assert.deepEqual(finalReport.missing, [])
  assert.deepEqual(finalReport.covered.slice().sort((a, b) => a - b), allIdx)
})

test('applyPatches: 지정 idx 문단만 교체, 나머지 문단은 문자 단위 무변경', () => {
  const synthOutput = '문단1 원본 [#1]\n\n문단2 원본 [#2]\n\n문단3 원본 [#3]'
  const patched = applyPatches(synthOutput, [{ idx: 2, replacement: '문단2 교정됨 [#2]' }])
  const paragraphs = patched.split('\n\n')
  assert.equal(paragraphs[0], '문단1 원본 [#1]')
  assert.equal(paragraphs[1], '문단2 교정됨 [#2]')
  assert.equal(paragraphs[2], '문단3 원본 [#3]')
})

test('applyPatches: 존재하지 않는 idx 패치는 무시(안전) — 원본 무변경', () => {
  const synthOutput = '문단1 원본 [#1]\n\n문단2 원본 [#2]'
  const patched = applyPatches(synthOutput, [{ idx: 99, replacement: '이건 반영되면 안 됨' }])
  assert.equal(patched, synthOutput)
})

test('applyPatches: 여러 idx 동시 패치', () => {
  const synthOutput = '문단1 [#1]\n\n문단2 [#2]\n\n문단3 [#3]'
  const patched = applyPatches(synthOutput, [
    { idx: 1, replacement: '새문단1 [#1]' },
    { idx: 3, replacement: '새문단3 [#3]' },
  ])
  assert.equal(patched, '새문단1 [#1]\n\n문단2 [#2]\n\n새문단3 [#3]')
})
