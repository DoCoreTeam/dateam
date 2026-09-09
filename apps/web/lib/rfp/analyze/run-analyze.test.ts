import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mergeDocs, titleFrom, ROLE_ORDER,
  contextBudget, UNKNOWN_LIMIT_TOKENS, MAX_CONTEXT_TOKENS, INPUT_RATIO,
} from './run-analyze.ts'
import type { AiModel } from '../ai/models.ts'
import type { IrDocument } from '../ir/types.ts'

function doc(blockIds: string[], quality = 80): IrDocument {
  return {
    meta: {
      fileRole: 'main', format: 'hwp', pageCount: 1,
      parser: 'rhwp', parserVersion: '1', qualityScore: quality, warnings: [],
    },
    pages: [], sections: [], tables: [], figures: [],
    blocks: blockIds.map((id, i) => ({
      blockId: id, type: 'paragraph', text: id, html: null, pageNo: 1, bbox: null,
      sectionId: null, orderNo: i, sourceRef: { kind: 'char', start: 0, end: 1 },
      textHash: id, ocrConfidence: null,
    })),
  } as unknown as IrDocument
}

test('본문이 앞이다 — 같은 값이 여럿이면 앞의 것이 이긴다', () => {
  const m = mergeDocs([
    { fileId: 'f2', role: 'forms', doc: doc(['b2']) },
    { fileId: 'f1', role: 'main', doc: doc(['b1']) },
  ])
  assert.deepEqual(m.doc.blocks.map((b) => b.blockId), ['b1', 'b2'])
})

test('블록이 어느 파일에서 왔는지 남는다 — 근거가 원문으로 돌아가야 한다', () => {
  const m = mergeDocs([
    { fileId: 'f1', role: 'main', doc: doc(['b1']) },
    { fileId: 'f2', role: 'scope', doc: doc(['b2']) },
  ])
  assert.equal(m.fileIdByBlock.get('b1'), 'f1')
  assert.equal(m.fileIdByBlock.get('b2'), 'f2')
})

test('여러 파일이면 가장 나쁜 품질이 케이스 품질이다', () => {
  const m = mergeDocs([
    { fileId: 'f1', role: 'main', doc: doc(['b1'], 90) },
    { fileId: 'f2', role: 'etc', doc: doc(['b2'], 40) },
  ])
  assert.equal(m.doc.meta.qualityScore, 40)
})

test('모르는 역할은 맨 뒤 — 순서표에 없다고 버리지 않는다', () => {
  const m = mergeDocs([
    { fileId: 'f9', role: '알 수 없음', doc: doc(['b9']) },
    { fileId: 'f1', role: 'main', doc: doc(['b1']) },
  ])
  assert.deepEqual(m.doc.blocks.map((b) => b.blockId), ['b1', 'b9'])
  assert.ok(ROLE_ORDER.includes('main'))
})

test('파일이 하나여도 합쳐진다', () => {
  const m = mergeDocs([{ fileId: 'f1', role: 'main', doc: doc(['b1']) }])
  assert.equal(m.doc.blocks.length, 1)
})

test('리포트에서 사업명을 집어낸다', () => {
  assert.equal(titleFrom({ overview: { projectName: { value: '차세대 플랫폼' } } }), '차세대 플랫폼')
  assert.equal(titleFrom({ overview: { title: { value: '두 번째 후보' } } }), '두 번째 후보')
})

test('사업명이 없으면 null — 임시 이름을 덮지 않는다', () => {
  assert.equal(titleFrom({ overview: {} }), null)
  assert.equal(titleFrom({ overview: { projectName: { value: null } } }), null)
  assert.equal(titleFrom({ overview: { projectName: { value: '가' } } }), null)
})

function model(maxInputTokens: number | null): AiModel {
  return {
    id: 'm', vendorId: 'v', modelName: 'n', displayName: 'N',
    allowedDocClasses: ['public'], internal: false,
    retention: { noTraining: false, retentionDays: 30, zeroRetention: false },
    inputKrwPerMTok: 0, outputKrwPerMTok: 0, multimodal: false,
    enabled: true, sortOrder: 1, maxInputTokens,
  }
}

test('가장 작은 모델이 크기를 정한다 — 폴백이 작은 모델에 닿으면 그 태스크만 죽는다', () => {
  // 실측 2026-09-09: Groq 무료 티어 7,000 한도에 46,671 을 보내 8/9 태스크가 413
  const budget = contextBudget([model(1_000_000), model(7_000)])
  assert.equal(budget, Math.floor(7_000 * INPUT_RATIO))
})

test('한도를 모르면 작게 잡는다 — 크게 잡으면 413 으로만 죽는다', () => {
  assert.equal(contextBudget([model(null)]), Math.floor(UNKNOWN_LIMIT_TOKENS * INPUT_RATIO))
})

test('한도가 아주 커도 상한을 넘지 않는다 — 비용이 문서 크기에 비례하면 안 된다', () => {
  assert.equal(contextBudget([model(100_000_000)]), MAX_CONTEXT_TOKENS)
})

test('사슬이 비면 안전한 작은 값', () => {
  assert.ok(contextBudget([]) > 0)
})
