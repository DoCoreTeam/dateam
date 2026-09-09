import { test } from 'node:test'
import assert from 'node:assert/strict'
import { unfilled, renderDocs, buildPrompt, parseAiDraft, mergeDraft, MAX_ROWS, MAX_PROMPT_CHARS } from './ai-draft.ts'
import { emptyProfile } from './profile.ts'
import type { IrDocument } from '../ir/types.ts'

function docOf(texts: string[]): IrDocument {
  return {
    meta: { fileRole: 'main', format: 'pdf', pageCount: 1, parser: 'x', parserVersion: '1', qualityScore: 80, warnings: [] },
    pages: [], sections: [], tables: [], figures: [],
    blocks: texts.map((t, i) => ({
      blockId: `b${i}`, type: 'paragraph', text: t, html: null, pageNo: 1, bbox: null,
      sectionId: null, orderNo: i, sourceRef: { kind: 'char', start: 0, end: 1 },
      textHash: `h${i}`, ocrConfidence: null,
    })),
  } as unknown as IrDocument
}

test('규칙이 못 푸는 칸만 묻는다 — 회사 이름은 어떤 정규식으로도 안 잡힌다', () => {
  assert.deepEqual(unfilled(emptyProfile()), ['companyName', 'trackRecords', 'capabilities', 'partners'])
})

test('규칙이 푼 칸은 안 묻는다', () => {
  const p = emptyProfile()
  p.basic.companyName = '데이터얼라이언스'
  p.trackRecords = [{ projectName: 'x', client: null, amountKrw: null, startDate: null, endDate: null, domainTags: [] }]
  assert.deepEqual(unfilled(p), ['capabilities', 'partners'])
})

test('원문에 블록 ID 를 붙인다 — 근거가 원문으로 돌아가야 한다', () => {
  const body = renderDocs([docOf(['첫 줄', '둘째 줄'])])
  assert.ok(body.includes('[b0] 첫 줄'))
  assert.ok(body.includes('[b1] 둘째 줄'))
})

test('원문이 길면 자른다 — 비용이 문서 크기에 비례하면 안 된다', () => {
  const body = renderDocs([docOf(['가'.repeat(500), '나'.repeat(500)])], 300)
  assert.ok(body.length <= 300)
  assert.equal(body.includes('나'), false)
})

test('빈 블록은 안 넣는다', () => {
  assert.equal(renderDocs([docOf(['', '   ', '값'])]).split('\n').length, 1)
})

test('프롬프트에 물을 칸이 들어간다', () => {
  const p = buildPrompt(['companyName', 'partners'], '원문')
  assert.ok(p.includes('companyName, partners'))
  assert.ok(p.includes('원문에 없는 내용을 만들지 않는다'))
})

test('회사 이름과 근거를 받는다', () => {
  const r = parseAiDraft(JSON.stringify({
    companyName: { value: '데이터얼라이언스', blockId: 'b0' },
  }), ['companyName'])
  assert.equal(r.companyName, '데이터얼라이언스')
  assert.deepEqual(r.evidence[0], { field: 'basic.companyName', blockId: 'b0', quote: '데이터얼라이언스' })
})

test('안 물은 칸은 받지 않는다 — 규칙이 푼 것을 덮으면 안 된다', () => {
  const r = parseAiDraft(JSON.stringify({
    companyName: { value: '지어낸 이름' },
    trackRecords: [{ projectName: '지어낸 사업' }],
  }), ['trackRecords'])
  assert.equal(r.companyName, null)
  assert.equal(r.patch.trackRecords?.length, 1)
})

test('이름 없는 줄은 버린다 — 「이건 뭐지」 하는 줄이 늘면 확인을 포기한다', () => {
  const r = parseAiDraft(JSON.stringify({
    trackRecords: [{ client: '어느 기관' }, { projectName: '진짜 사업' }],
    capabilities: [{ level: 5 }, { tag: 'AI' }],
    partners: [{ capabilities: ['x'] }, { name: '협력사' }],
  }), ['trackRecords', 'capabilities', 'partners'])
  assert.equal(r.patch.trackRecords?.length, 1)
  assert.equal(r.patch.capabilities?.length, 1)
  assert.equal(r.patch.partners?.length, 1)
})

test('숙련도는 1~5 로 자른다 — 밖의 값이면 저장이 통째로 실패한다', () => {
  const r = parseAiDraft(JSON.stringify({ capabilities: [{ tag: 'a', level: 99 }] }), ['capabilities'])
  assert.equal(r.patch.capabilities?.[0].level, 5)
})

test('줄이 너무 많으면 자른다', () => {
  const many = Array.from({ length: 100 }, (_, i) => ({ tag: `t${i}` }))
  const r = parseAiDraft(JSON.stringify({ capabilities: many }), ['capabilities'])
  assert.equal(r.patch.capabilities?.length, MAX_ROWS)
})

test('JSON 이 아니면 아무것도 안 바꾼다 — 규칙 결과는 살아 있어야 한다', () => {
  const r = parseAiDraft('못 하겠습니다', ['companyName'])
  assert.deepEqual(r, { patch: {}, companyName: null, evidence: [] })
})

test('규칙이 푼 값을 AI 가 덮지 않는다', () => {
  const filled = emptyProfile()
  filled.basic.companyName = '규칙이 찾은 이름'
  filled.trackRecords = [{ projectName: '규칙 실적', client: null, amountKrw: null, startDate: null, endDate: null, domainTags: [] }]
  const merged = mergeDraft(filled, {
    companyName: 'AI 가 찾은 이름',
    patch: { trackRecords: [{ projectName: 'AI 실적', client: null, amountKrw: null, startDate: null, endDate: null, domainTags: [] }] },
    evidence: [],
  })
  assert.equal(merged.basic.companyName, '규칙이 찾은 이름')
  assert.equal(merged.trackRecords[0].projectName, '규칙 실적')
})

test('규칙이 못 푼 칸은 AI 값이 들어온다', () => {
  const merged = mergeDraft(emptyProfile(), {
    companyName: 'AI 가 찾은 이름',
    patch: { partners: [{ name: '협력사', capabilities: [] }] },
    evidence: [],
  })
  assert.equal(merged.basic.companyName, 'AI 가 찾은 이름')
  assert.equal(merged.partners.length, 1)
  assert.ok(MAX_PROMPT_CHARS > 0)
})
