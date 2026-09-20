/**
 * 청크와 임베딩과 검색 가드 (설계서 3.3.5)
 *
 * 여기서 잠그는 것 넷
 * - 청크가 300~800자로 맞춰지는가
 * - 표 행 청크에 표 제목이 붙는가 (「12개월」만 떼면 무슨 기간인지 모른다)
 * - 임베딩 모델 이름이 값과 함께 남는가 (모델을 올릴 때 다시 만들 대상을 가리려면)
 * - RRF 가 순위만 쓰는가 (점수를 더하면 단위가 다른 두 자를 섞게 된다)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  chunkDocument, MIN_CHUNK_CHARS, MAX_CHUNK_CHARS, CHUNK_OVERLAP_CHARS, type Chunk,
} from './chunk.ts'
import {
  embedChunks, needsReembedding, embeddingCoverage, isValidVector,
  EMBEDDING_MODEL, EMBED_DIM, oneByOne,
} from './embed.ts'
import {
  fuseRrf, fuseWeighted, extractExactTerms, weightFor, RRF_K,
} from './search.ts'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeBlock, makeDocument } from '../ir/build.ts'
import type { IrDocument, IrMeta, IrTable } from '../ir/types.ts'

const META: IrMeta = {
  fileRole: 'main', format: 'hwp', pageCount: 1,
  parser: 'rhwp', parserVersion: '0.8.6', qualityScore: 80, warnings: [],
}

function 문단문서(texts: string[]): IrDocument {
  return makeDocument({
    meta: META,
    blocks: texts.map((t, i) => makeBlock('f1', i, {
      type: 'paragraph', text: t, sectionId: 's1', pageNo: 1,
      sourceRef: { kind: 'hwp', sectionIdx: 0, paraIdx: i },
    })),
  })
}

function 표문서(grid: string[][], caption: string | null): IrDocument {
  const block = makeBlock('f1', 0, {
    type: 'table', text: grid.map((r) => r.join('\t')).join('\n'), sectionId: 's1', pageNo: 2,
    sourceRef: { kind: 'hwp', sectionIdx: 0, paraIdx: 5 },
  })
  const cols = Math.max(...grid.map((r) => r.length))
  const table: IrTable = {
    tableId: 't1', blockId: block.blockId, rows: grid.length, cols,
    cells: grid.flatMap((row, r) => Array.from({ length: cols }, (_, c) => ({
      r, c, rowspan: 1, colspan: 1, text: row[c] ?? '',
    }))),
    caption,
  }
  return makeDocument({ meta: META, blocks: [block], tables: [table] })
}

// 길이

test('짧은 문단들을 이어 붙여 길이를 맞춘다', () => {
  const doc = 문단문서(Array.from({ length: 20 }, (_, i) => `${i} 번째 문단이다 ${'가'.repeat(40)}`))
  const chunks = chunkDocument(doc)
  assert.ok(chunks.length > 0)
  for (const c of chunks) {
    assert.ok(c.text.length <= MAX_CHUNK_CHARS, `${c.text.length} 자가 상한을 넘었다`)
  }
  // 짧은 블록 하나가 청크 하나가 되면 뜻이 흐려 어느 질문에도 안 걸린다
  assert.ok(chunks[0].text.length >= MIN_CHUNK_CHARS)
})

test('한 블록이 너무 길면 그 안에서 자른다', () => {
  const chunks = chunkDocument(문단문서(['가'.repeat(MAX_CHUNK_CHARS * 3)]))
  assert.ok(chunks.length >= 3)
  for (const c of chunks) assert.ok(c.text.length <= MAX_CHUNK_CHARS)
})

test('마지막 조각이 짧으면 앞 청크에 붙인다', () => {
  const doc = 문단문서([...Array.from({ length: 10 }, () => '가'.repeat(100)), '짧다'])
  const chunks = chunkDocument(doc)
  const last = chunks[chunks.length - 1]
  // 홀로 두면 뜻이 안 서고 검색에 잡음만 된다
  assert.ok(last.text.length >= MIN_CHUNK_CHARS || chunks.length === 1)
})

test('청크가 겹쳐 문장이 경계에서 끊기지 않는다', () => {
  const doc = 문단문서(Array.from({ length: 30 }, (_, i) => `문단${i} ${'나'.repeat(60)}`))
  const chunks = chunkDocument(doc)
  assert.ok(chunks.length >= 2)
  const 앞끝 = chunks[0].text.slice(-CHUNK_OVERLAP_CHARS)
  assert.ok(chunks[1].text.startsWith(앞끝.slice(0, 20)), '앞 청크의 끝을 안 물고 갔다')
})

test('빈 블록은 청크가 되지 않는다', () => {
  assert.deepEqual(chunkDocument(문단문서(['', '   ', '\n'])), [])
})

// 표

test('표는 행마다 청크가 되고 표 제목이 접두어로 붙는다', () => {
  const doc = 표문서([
    ['항목', '내용'],
    ['사업기간', '12개월'],
    ['하자보수기간', '24개월'],
  ], '사업 개요')
  const chunks = chunkDocument(doc)

  assert.equal(chunks.length, 2)
  assert.equal(chunks[0].kind, 'table_row')
  // 「12개월」만 떼면 사업기간인지 하자보수기간인지 알 수 없다
  assert.match(chunks[0].text, /사업 개요/)
  assert.match(chunks[0].text, /항목 \/ 내용/)
  assert.match(chunks[0].text, /항목: 사업기간/)
  assert.match(chunks[0].text, /내용: 12개월/)
  assert.match(chunks[1].text, /24개월/)
})

test('표 제목이 없으면 머리글이 제목 노릇을 한다', () => {
  const chunks = chunkDocument(표문서([['요구사항 ID', '요구사항명'], ['SFR-001', '사용자 인증']], null))
  assert.match(chunks[0].text, /요구사항 ID \/ 요구사항명/)
  assert.match(chunks[0].text, /SFR-001/)
})

test('표 하나가 여러 요구사항으로 안 뭉친다', () => {
  const doc = 표문서([
    ['ID', '이름'],
    ['SFR-001', '인증'],
    ['SFR-002', '권한'],
    ['SFR-003', '로그'],
  ], '요구사항')
  const chunks = chunkDocument(doc)
  // 뭉치면 「SFR-003 을 찾아 줘」가 안 걸린다
  assert.equal(chunks.length, 3)
  assert.equal(chunks.filter((c) => c.text.includes('SFR-003')).length, 1)
})

test('표 앞뒤 문단이 표와 한 청크로 붙지 않는다', () => {
  const doc = 표문서([['항목', '값'], ['기간', '12개월']], '표')
  const 문단 = makeBlock('f1', 9, {
    type: 'paragraph', text: '표 뒤의 설명 문단이다', sectionId: 's1', pageNo: 2,
    sourceRef: { kind: 'hwp', sectionIdx: 0, paraIdx: 9 },
  })
  const merged = makeDocument({ meta: META, blocks: [...doc.blocks, 문단], tables: doc.tables })
  const chunks = chunkDocument(merged)
  assert.equal(chunks.filter((c) => c.kind === 'table_row').length, 1)
  assert.equal(chunks.filter((c) => c.kind === 'text').length, 1)
})

// 근거와 키

test('청크가 어느 블록에서 왔는지 남긴다', () => {
  const doc = 문단문서(['가'.repeat(200), '나'.repeat(200)])
  const chunks = chunkDocument(doc)
  // 화면은 청크가 아니라 블록을 보여 준다. 되돌아갈 길이 없으면 근거가 없다
  for (const c of chunks) assert.ok(c.blockIds.length > 0)
  assert.equal(chunks[0].sectionId, 's1')
  assert.equal(chunks[0].pageNo, 1)
})

test('같은 문서를 다시 자르면 같은 청크 키가 나온다', () => {
  const texts = ['가'.repeat(400), '나'.repeat(400)]
  assert.deepEqual(
    chunkDocument(문단문서(texts)).map((c) => c.chunkKey),
    chunkDocument(문단문서(texts)).map((c) => c.chunkKey),
  )
})

// 임베딩

test('임베딩 차원이 저장소 SSOT 와 같다', () => {
  // 여기서 gemini-embedding.ts 를 import 하면 순수 함수 테스트가 앱 별칭 설정을 요구하게 된다.
  // 그래서 값을 복사하되 **소스에서 직접 대조**한다 — 한쪽만 바뀌면 여기서 잡힌다
  const here = path.dirname(fileURLToPath(import.meta.url))
  const ssot = readFileSync(path.join(here, '../../gemini-embedding.ts'), 'utf8')
  const m = ssot.match(/export const EMBED_DIM = (\d+)/)
  assert.ok(m, '저장소 SSOT 에서 EMBED_DIM 을 못 찾았다')
  assert.equal(Number(m![1]), EMBED_DIM, 'lib/gemini-embedding.ts 와 차원이 어긋났다')
  assert.match(ssot, new RegExp(`EMBED_MODEL = '${EMBEDDING_MODEL}'`), '모델 이름이 어긋났다')
})

test('임베딩 값과 모델 이름이 함께 저장된다', async () => {
  const chunks = chunkDocument(문단문서(['가'.repeat(400)]))
  const out = await embedChunks(chunks, oneByOne(async () => new Array(EMBED_DIM).fill(0.1)))
  assert.equal(out[0].embeddingModel, EMBEDDING_MODEL)
  assert.equal(out[0].embedding?.length, EMBED_DIM)
})

test('임베딩이 실패해도 청크는 남는다', async () => {
  const chunks = chunkDocument(문단문서(['가'.repeat(400)]))
  const out = await embedChunks(chunks, oneByOne(async () => { throw new Error('할당량 초과') }))
  // 임베딩 실패로 저장을 막으면 키워드 검색까지 통째로 죽는다
  assert.equal(out.length, 1)
  assert.equal(out[0].embedding, null)
  assert.equal(out[0].embeddingModel, null)
  assert.equal(out[0].text, chunks[0].text)
})

test('차원이 다른 벡터는 받지 않는다', async () => {
  const chunks = chunkDocument(문단문서(['가'.repeat(400)]))
  const out = await embedChunks(chunks, oneByOne(async () => [0.1, 0.2]))
  // 저장하면 검색이 조용히 0건이 된다
  assert.equal(out[0].embedding, null)
  assert.equal(isValidVector([0.1, 0.2]), false)
  assert.equal(isValidVector(new Array(EMBED_DIM).fill(0)), true)
  assert.equal(isValidVector(null), false)
})

test('모델을 바꾸면 다시 만들 대상만 가려낸다', () => {
  const stored = [
    { chunkKey: 'a', embeddingModel: EMBEDDING_MODEL },
    { chunkKey: 'b', embeddingModel: 'text-embedding-004' },
    { chunkKey: 'c', embeddingModel: null },
  ]
  // 「전부 다시」와 「바뀐 것만」의 차이가 곧 비용이다
  assert.deepEqual(needsReembedding(stored), ['b', 'c'])
})

test('임베딩이 붙은 비율을 잰다', async () => {
  const chunks = chunkDocument(문단문서(['가'.repeat(400), '나'.repeat(400)]))
  let n = 0
  const out = await embedChunks(chunks, oneByOne(async () => (n++ === 0 ? new Array(EMBED_DIM).fill(0.1) : null)))
  assert.equal(embeddingCoverage(out), 1 / out.length)
  assert.equal(embeddingCoverage([]), 0)
})

// 검색 합치기

test('RRF 는 점수가 아니라 순위만 쓴다', () => {
  // BM25 점수와 코사인 유사도는 애초에 단위가 다르다
  const kw = [{ chunkKey: 'a', score: 9999 }, { chunkKey: 'b', score: 1 }]
  const vec = [{ chunkKey: 'b', score: 0.99 }, { chunkKey: 'a', score: 0.1 }]
  const 큰점수 = fuseRrf(kw, vec)
  const 작은점수 = fuseRrf(
    kw.map((r) => ({ ...r, score: r.score / 1000 })),
    vec.map((r) => ({ ...r, score: r.score / 1000 })),
  )
  assert.deepEqual(큰점수.map((h) => h.chunkKey), 작은점수.map((h) => h.chunkKey))
})

test('한쪽에만 걸린 것도 버리지 않는다', () => {
  const out = fuseRrf([{ chunkKey: 'code', score: 1 }], [{ chunkKey: 'meaning', score: 1 }])
  // 「SFR-003」은 벡터로는 안 걸리지만 사용자가 찾는 것이 정확히 그것이다
  assert.equal(out.length, 2)
  assert.equal(out.find((h) => h.chunkKey === 'code')?.vectorRank, null)
})

test('둘 다에 걸린 것이 위로 온다', () => {
  const out = fuseRrf(
    [{ chunkKey: 'both', score: 1 }, { chunkKey: 'kw', score: 1 }],
    [{ chunkKey: 'both', score: 1 }, { chunkKey: 'vec', score: 1 }],
  )
  assert.equal(out[0].chunkKey, 'both')
  assert.equal(out[0].rrf, 2 / (RRF_K + 1))
})

test('점수가 같으면 순서가 매번 같다', () => {
  const kw = [{ chunkKey: 'b', score: 1 }, { chunkKey: 'a', score: 1 }]
  const a = fuseRrf(kw, [])
  const b = fuseRrf(kw, [])
  // 순서가 흔들리면 화면이 새로고침할 때마다 달라진다
  assert.deepEqual(a.map((h) => h.chunkKey), b.map((h) => h.chunkKey))
  assert.equal(a[0].chunkKey, 'b')
})

test('코드처럼 생긴 조각을 뽑는다', () => {
  assert.deepEqual(extractExactTerms('SFR-003 관련 요구사항'), ['SFR-003'])
  assert.deepEqual(extractExactTerms('PER 001 과 SER-002'), ['PER-001', 'SER-002'])
  assert.deepEqual(extractExactTerms('「사업기간」이 얼마인가'), ['사업기간'])
  assert.deepEqual(extractExactTerms('사업기간이 얼마인가'), [])
})

test('코드가 섞인 질문은 키워드에 힘을 더 준다', () => {
  assert.deepEqual(weightFor('SFR-003 을 찾아 줘'), { keyword: 2, vector: 1 })
  assert.deepEqual(weightFor('사업 목적이 뭐야'), { keyword: 1, vector: 1 })
})

test('가중치를 주면 키워드에만 걸린 것이 올라온다', () => {
  const kw = [{ chunkKey: 'code', score: 1 }]
  const vec = [{ chunkKey: 'meaning', score: 1 }]
  const 같음 = fuseRrf(kw, vec)
  const 키워드우대 = fuseWeighted(kw, vec, { keyword: 2, vector: 1 })
  assert.equal(같음[0].rrf, 같음[1].rrf)
  assert.equal(키워드우대[0].chunkKey, 'code')
})
