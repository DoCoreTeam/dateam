import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assembleDocument, buildCriticPrompt, appendCriticNotes, type GroupRefineOutcome } from './assemble-document.ts'

test('assembleDocument: 전 그룹이 물리적으로 본문에 존재한다(누락 0)', () => {
  const outcomes: GroupRefineOutcome[] = [
    { idx: 0, treePath: '1', title: '개요', depth: 0, status: 'done', resultText: '개요 심화 내용' },
    { idx: 1, treePath: '2', title: '요구사항', depth: 0, status: 'done', resultText: '요구사항 심화 내용' },
  ]
  const result = assembleDocument('문서 제목', outcomes)
  assert.match(result.markdown, /개요 심화 내용/)
  assert.match(result.markdown, /요구사항 심화 내용/)
  assert.equal(result.groupCount, 2)
  assert.equal(result.missingGroups.length, 0)
})

test('assembleDocument: 실패 그룹은 확인필요 섹션 + 본문 양쪽에 명시 노출(조용한 드롭 금지)', () => {
  const outcomes: GroupRefineOutcome[] = [
    { idx: 0, treePath: '1', title: '개요', depth: 0, status: 'done', resultText: '정상' },
    { idx: 1, treePath: '2', title: '결제 연동', depth: 0, status: 'error', errorText: '429 재시도 소진' },
  ]
  const result = assembleDocument('문서', outcomes)
  assert.match(result.markdown, /결제 연동/)
  assert.match(result.markdown, /429 재시도 소진/)
  assert.match(result.markdown, /## 확인 필요/)
  assert.deepEqual(result.missingGroups, [{ idx: 1, title: '결제 연동', treePath: '2', reason: '429 재시도 소진' }])
})

test('assembleDocument: done인데 resultText가 빈 문자열이면 확인필요로 처리(누락 0 방어)', () => {
  const outcomes: GroupRefineOutcome[] = [
    { idx: 0, treePath: '1', title: 'X', depth: 0, status: 'done', resultText: '   ' },
  ]
  const result = assembleDocument('문서', outcomes)
  assert.equal(result.missingGroups.length, 1)
})

test('assembleDocument: 순서가 뒤섞여 들어와도 idx순으로 재정렬', () => {
  const outcomes: GroupRefineOutcome[] = [
    { idx: 1, treePath: '2', title: 'B', depth: 0, status: 'done', resultText: 'body-b' },
    { idx: 0, treePath: '1', title: 'A', depth: 0, status: 'done', resultText: 'body-a' },
  ]
  const result = assembleDocument('문서', outcomes)
  assert.ok(result.markdown.indexOf('body-a') < result.markdown.indexOf('body-b'))
})

test('assembleDocument: 그룹 0건이면 안내 문구', () => {
  const result = assembleDocument('빈 문서', [])
  assert.match(result.markdown, /그룹이 없습니다/)
  assert.equal(result.groupCount, 0)
})

test('assembleDocument: depth에 따라 헤딩 레벨이 깊어지고 h6에서 상한', () => {
  const outcomes: GroupRefineOutcome[] = [
    { idx: 0, treePath: '1', title: 'X', depth: 10, status: 'done', resultText: '깊은 그룹' },
  ]
  const result = assembleDocument('문서', outcomes)
  assert.match(result.markdown, /^###### 1\. X$/m)
})

test('buildCriticPrompt: 문서·지시가 프롬프트에 들어간다', () => {
  const prompt = buildCriticPrompt('제목', '엄격하게 검토해', '## 1. 개요\n내용')
  assert.match(prompt, /제목/)
  assert.match(prompt, /엄격하게 검토해/)
  assert.match(prompt, /## 1\. 개요/)
})

test('appendCriticNotes: 크리틱 응답을 검토 노트 섹션으로 append', () => {
  const doc = '# 문서\n본문'
  const appended = appendCriticNotes(doc, '- 근거 부족한 부분이 있다')
  assert.match(appended, /## 검토 노트/)
  assert.match(appended, /근거 부족한 부분이 있다/)
})

test('appendCriticNotes: 크리틱 응답이 비어있으면 원문서 그대로(비차단)', () => {
  const doc = '# 문서\n본문'
  assert.equal(appendCriticNotes(doc, ''), doc)
  assert.equal(appendCriticNotes(doc, '   '), doc)
})
