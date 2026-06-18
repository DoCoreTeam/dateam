import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildRefinePrompt, parseRefineOutput } from './refine-prompt.ts'

test('buildRefinePrompt — 원문·버전 포함', () => {
  const p = buildRefinePrompt({ version: '0.7.198', rawLines: ['GPU 업로드 픽스 claude', 'Playwright 검증'] })
  assert.ok(p.includes('0.7.198'))
  assert.ok(p.includes('GPU 업로드 픽스'))
  assert.ok(p.includes('JSON'))
})

test('buildRefinePrompt — 게시된 예시(톤 참고) 포함', () => {
  const p = buildRefinePrompt({
    version: '0.7.198', rawLines: ['x'],
    examples: [{ title: 'GPU 가격 관리 개선', changes: ['단일 입력 통합'] }],
  })
  assert.ok(p.includes('이미 게시된 업데이트 내역'))
  assert.ok(p.includes('GPU 가격 관리 개선'))
  assert.ok(p.includes('단일 입력 통합'))
})

test('parseRefineOutput — 정상 JSON(raw 추출, 정규화는 호출측)', () => {
  const r = parseRefineOutput('{"title":"요약","changes":[{"text":"기능 추가","type":"feature"},{"text":"오류 수정","type":"fix"}]}')
  assert.equal(r.title, '요약')
  assert.equal((r.changes as unknown[]).length, 2)
})

test('parseRefineOutput — 코드펜스/잡음 섞여도 추출', () => {
  const r = parseRefineOutput('```json\n{"title":"t","changes":[{"text":"a","type":"improve"}]}\n```')
  assert.equal(r.title, 't')
})

test('parseRefineOutput — 파싱 실패 시 안전 폴백', () => {
  const r = parseRefineOutput('이건 JSON이 아님')
  assert.equal(r.title, '')
  assert.deepEqual(r.changes, [])
})
