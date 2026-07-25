import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildRefinePrompt,
  buildFreeRefinePrompt,
  buildAugmentPrompt,
  parseRefineResult,
  refineResultOrFallback,
  freeRefineOrFallback,
  renderRefineMarkdown,
  renderAugmentMarkdown,
  type GroupRefineInput,
} from './refine-group.ts'

const group: GroupRefineInput = {
  title: '사용자 인증',
  bodyRaw: '1.2 사용자 인증\n로그인은 이메일과 비밀번호로 한다.',
  treePath: '1.2',
  depth: 1,
}

test('buildRefinePrompt: 그룹 4요소(제목·원문·위치·docContext)가 전부 프롬프트에 들어간다', () => {
  const prompt = buildRefinePrompt({
    group,
    docType: 'requirements',
    docContext: '[1] (L1, 10줄) 개요\n[1.2] (L2, 3줄) 사용자 인증',
    command: '요구사항 단위로 심화해',
  })
  assert.match(prompt, /요구사항 단위로 심화해/)
  assert.match(prompt, /사용자 인증/)
  assert.match(prompt, /로그인은 이메일과 비밀번호로 한다/)
  assert.match(prompt, /1\.2/)
  assert.match(prompt, /개요/) // docContext 포함
})

test('buildFreeRefinePrompt: 지시 주도 — 고정 섹션 금지 지시 + 지시문 지배 + 맥락 주입', () => {
  const prompt = buildFreeRefinePrompt({
    group,
    docType: 'requirements',
    docContext: '[1] (L1) 개요',
    command: '회의록 형식으로 정리해',
  })
  assert.match(prompt, /회의록 형식으로 정리해/)
  assert.match(prompt, /출력 형식·구성·말투를 지배한다/)
  assert.match(prompt, /고정 섹션을 임의로 붙이지 마라/) // 근거/가정/미결 래퍼 금지 지시
  assert.match(prompt, /순수 markdown 본문만/) // JSON 스키마 강제 없음
  assert.match(prompt, /사용자 인증/) // 그룹 원문 주입
  assert.doesNotMatch(prompt, /JSON 객체 하나만/) // 복원 골격의 스키마 강제 문구는 없어야 함
})

test('buildAugmentPrompt: 원문 재출력 금지 + 보강만 지시', () => {
  const prompt = buildAugmentPrompt({ group, docType: 'requirements', docContext: '', command: '' })
  assert.match(prompt, /원문을 다시 출력하지 마라/)
  assert.match(prompt, /분석·보강/)
  assert.match(prompt, /로그인은 이메일과 비밀번호로 한다/) // 원문 주입(모델이 보고 보강)
})

test('renderAugmentMarkdown: 원문 verbatim 보존 + 보강 덧붙임', () => {
  const out = renderAugmentMarkdown(group.bodyRaw, 'bcrypt로 해싱한다.')
  assert.ok(out.startsWith(group.bodyRaw.trim()), '원문이 앞에 그대로')
  assert.match(out, /분석·보강/)
  assert.match(out, /bcrypt로 해싱한다/)
})

test('renderAugmentMarkdown: 보강이 비면 원문만(무손실)', () => {
  assert.equal(renderAugmentMarkdown(group.bodyRaw, '   '), group.bodyRaw.trim())
})

test('buildAugmentPrompt: 밀도 분기 — dense=검증/갭, sparse=펼치기', () => {
  const dense = buildAugmentPrompt({ group, docType: 'requirements', docContext: '', command: '' }, 'dense')
  assert.match(dense, /부풀리지 말고/)
  assert.match(dense, /갭|검증 포인트/)
  const sparse = buildAugmentPrompt({ group, docType: 'requirements', docContext: '', command: '' }, 'sparse')
  assert.match(sparse, /압축돼 있다|펼쳐/)
})

test('freeRefineOrFallback: 코드펜스를 벗기고 본문을 그대로 보존한다', () => {
  const out = freeRefineOrFallback('```md\n## 회의록\n- 결정: A\n```', group)
  assert.equal(out, '## 회의록\n- 결정: A')
})

test('freeRefineOrFallback: 빈 응답이면 그룹 원문으로 유실0 폴백', () => {
  assert.equal(freeRefineOrFallback('   ', group), group.bodyRaw)
  assert.equal(freeRefineOrFallback('```\n```', group), group.bodyRaw)
})

test('buildRefinePrompt: 지시가 없으면 문서 유형 기본 동작 문구를 쓴다', () => {
  const prompt = buildRefinePrompt({ group, docType: 'meeting-note', docContext: '', command: '' })
  assert.match(prompt, /기본 동작/)
  assert.match(prompt, /안건 1건이 1그룹/)
})

test('buildRefinePrompt: 템플릿이 있으면 필드 가이드를 포함한다', () => {
  const prompt = buildRefinePrompt({
    group,
    docType: 'requirements',
    docContext: '',
    command: '',
    template: {
      name: '요구사항 정의서',
      fields: [{ key: 'statement', label: '요구문', description: '단일 요구 문장', required: true }],
    },
  })
  assert.match(prompt, /요구사항 정의서/)
  assert.match(prompt, /요구문/)
})

test('parseRefineResult: 정상 JSON 파싱', () => {
  const raw = JSON.stringify({
    markdown: '심화된 본문',
    evidence: ['원문 인용'],
    assumptions: ['가정1'],
    openQuestions: ['질문1'],
  })
  const r = parseRefineResult(raw)
  assert.equal(r.parseOk, true)
  assert.equal(r.markdown, '심화된 본문')
  assert.deepEqual(r.evidence, ['원문 인용'])
  assert.deepEqual(r.assumptions, ['가정1'])
  assert.deepEqual(r.openQuestions, ['질문1'])
})

test('parseRefineResult: 코드펜스 감싼 JSON도 파싱', () => {
  const raw = '```json\n{"markdown":"본문입니다"}\n```'
  const r = parseRefineResult(raw)
  assert.equal(r.parseOk, true)
  assert.equal(r.markdown, '본문입니다')
})

test('parseRefineResult: JSON 아니면 유실0 폴백 — raw 텍스트를 그대로 markdown으로 보존', () => {
  const raw = '그냥 서술형으로 답했다. JSON이 아니다.'
  const r = parseRefineResult(raw)
  assert.equal(r.parseOk, false)
  assert.equal(r.markdown, raw)
  assert.deepEqual(r.evidence, [])
})

test('parseRefineResult: markdown 필드가 비어있으면 폴백 처리', () => {
  const raw = JSON.stringify({ markdown: '   ' })
  const r = parseRefineResult(raw)
  assert.equal(r.parseOk, false)
})

test('refineResultOrFallback: AI 호출 자체가 실패(raw="")해도 그룹 원문으로 유실 0 보증', () => {
  const r = refineResultOrFallback('', group)
  assert.equal(r.parseOk, false)
  assert.equal(r.markdown, group.bodyRaw)
})

test('refineResultOrFallback: 정상 파싱 결과는 그대로 통과', () => {
  const raw = JSON.stringify({ markdown: '정상 본문' })
  const r = refineResultOrFallback(raw, group)
  assert.equal(r.markdown, '정상 본문')
  assert.equal(r.parseOk, true)
})

test('renderRefineMarkdown: 근거·가정·미결질문 섹션을 순서대로 붙인다', () => {
  const rendered = renderRefineMarkdown({
    markdown: '본문',
    evidence: ['근거1'],
    assumptions: ['가정1'],
    openQuestions: ['질문1'],
    parseOk: true,
  })
  const evidenceIdx = rendered.indexOf('**근거**')
  const assumptionIdx = rendered.indexOf('**가정**')
  const questionIdx = rendered.indexOf('**미결 질문**')
  assert.ok(evidenceIdx > -1 && assumptionIdx > evidenceIdx && questionIdx > assumptionIdx)
})

test('renderRefineMarkdown: 근거·가정·질문이 없으면 본문만', () => {
  const rendered = renderRefineMarkdown({ markdown: '본문만', evidence: [], assumptions: [], openQuestions: [], parseOk: true })
  assert.equal(rendered, '본문만')
})
