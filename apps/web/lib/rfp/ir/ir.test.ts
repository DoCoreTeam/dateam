/**
 * RFP-IR 규격 가드 (설계서 3.3.3)
 *
 * 여기서 잠그는 것 세 가지
 * - Document 의 여섯 칸이 **타입 선언에** 실제로 있는가 (값 배열만 보면 타입을 지워도 통과한다)
 * - PDF 좌표가 뒤집혀 들어오는가 (화면에서만 보이는 결함이라 여기서 잡아야 한다)
 * - 같은 자리를 다시 파싱하면 같은 블록 ID 가 나오는가 (아니면 지난 리포트의 근거가 끊긴다)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  IR_DOCUMENT_KEYS, IR_META_KEYS, IR_BLOCK_KEYS, BLOCK_TYPES, SECTION_CATEGORIES,
} from './types.ts'
import type { IrMeta, SourceRef } from './types.ts'
import {
  blockKey, textHash, normalizeForHash, bboxFromPdf, bboxFromTopLeft, clampBbox,
  makeBlock, makeDocument, findBlock, validateDocument, qualityScore, isLowQuality,
  QUALITY_WARN_BELOW,
} from './build.ts'

// 저장소 경로에 한글이 있어 import.meta.url 이 퍼센트 인코딩된다. pathname 을 그대로 쓰면 파일을 못 연다
const HERE = path.dirname(fileURLToPath(import.meta.url))
const TYPES_SRC = readFileSync(path.join(HERE, 'types.ts'), 'utf8')

/** 소스에서 인터페이스 본문만 떼어낸다 — 타입 선언 자체를 보기 위해 */
function interfaceBody(name: string): string {
  const m = TYPES_SRC.match(new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`))
  assert.ok(m, `${name} 인터페이스를 소스에서 못 찾았다`)
  return m![1]
}

const META: IrMeta = {
  fileRole: 'rfp_main',
  format: 'hwp',
  pageCount: 2,
  parser: 'rhwp',
  parserVersion: '0.8.6',
  qualityScore: 80,
  warnings: [],
}

// ── 규격 ─────────────────────────────────────────────────────

test('Document 여섯 칸이 타입 선언에 있다', () => {
  const body = interfaceBody('IrDocument')
  for (const k of ['meta', 'pages', 'sections', 'blocks', 'tables', 'figures']) {
    assert.match(body, new RegExp(`\\b${k}:`), `IrDocument 에 ${k} 가 없다`)
  }
  assert.deepEqual([...IR_DOCUMENT_KEYS], ['meta', 'pages', 'sections', 'blocks', 'tables', 'figures'])
})

test('makeDocument 결과가 규격 칸을 전부 채운다', () => {
  const doc = makeDocument({ meta: META })
  assert.deepEqual(Object.keys(doc).sort(), [...IR_DOCUMENT_KEYS].sort())
  // 빠진 배열을 undefined 로 두면 소비하는 쪽이 전부 옵셔널 체이닝을 달아야 한다
  for (const k of ['pages', 'sections', 'blocks', 'tables', 'figures'] as const) {
    assert.ok(Array.isArray(doc[k]), `${k} 가 배열이 아니다`)
  }
})

test('meta 와 block 의 칸이 타입 선언과 일치한다', () => {
  const metaBody = interfaceBody('IrMeta')
  for (const k of IR_META_KEYS) assert.match(metaBody, new RegExp(`\\b${k}\\b`), `IrMeta 에 ${k} 가 없다`)
  const blockBody = interfaceBody('IrBlock')
  for (const k of IR_BLOCK_KEYS) assert.match(blockBody, new RegExp(`\\b${k}\\b`), `IrBlock 에 ${k} 가 없다`)
})

test('섹션 분류가 설계서 14종이다', () => {
  assert.equal(SECTION_CATEGORIES.length, 15) // 14 분류 + forms(서식)
  assert.ok(SECTION_CATEGORIES.includes('eligibility'))
  assert.ok(SECTION_CATEGORIES.includes('evaluation'))
  assert.equal(new Set(SECTION_CATEGORIES).size, SECTION_CATEGORIES.length, '분류가 겹친다')
  assert.equal(new Set(BLOCK_TYPES).size, BLOCK_TYPES.length, '블록 종류가 겹친다')
})

// ── 좌표 ─────────────────────────────────────────────────────

test('PDF 좌표는 위아래를 뒤집어 좌상단 기준 비율이 된다', () => {
  const page = { width: 600, height: 800 }
  // PDF 기준: y=700 이 위쪽(원점이 좌하단이므로 y 가 클수록 위)
  const top = bboxFromPdf({ x0: 60, y0: 700, x1: 540, y1: 780 }, page)
  const bottom = bboxFromPdf({ x0: 60, y0: 20, x1: 540, y1: 100 }, page)

  // 뒤집혔다면 이 단정이 뒤바뀐다 — 하이라이트가 엉뚱한 쪽에 그려지는 결함이 여기서 잡힌다
  assert.ok(top.y0 < bottom.y0, '페이지 위쪽 블록의 y0 가 더 작아야 한다')
  assert.equal(top.y0, (800 - 780) / 800)
  assert.equal(top.y1, (800 - 700) / 800)
  assert.equal(top.x0, 0.1)
  assert.equal(top.x1, 0.9)
})

test('좌표는 언제나 0~1 이고 x0<=x1, y0<=y1 이다', () => {
  const page = { width: 600, height: 800 }
  for (const b of [
    bboxFromPdf({ x0: 540, y0: 100, x1: 60, y1: 20 }, page),   // 뒤집혀 들어온 입력
    bboxFromPdf({ x0: -50, y0: 900, x1: 700, y1: -10 }, page), // 페이지 밖
    bboxFromTopLeft({ x0: 0, y0: 0, x1: 600, y1: 800 }, page),
  ]) {
    for (const v of [b.x0, b.y0, b.x1, b.y1]) {
      assert.ok(v >= 0 && v <= 1, `비율 범위를 벗어났다: ${v}`)
    }
    assert.ok(b.x0 <= b.x1 && b.y0 <= b.y1, '좌표 순서가 뒤집혔다')
  }
})

test('이미 좌상단 기준인 좌표는 뒤집지 않는다', () => {
  const page = { width: 100, height: 200 }
  const b = bboxFromTopLeft({ x0: 10, y0: 20, x1: 90, y1: 60 }, page)
  assert.deepEqual(b, { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.3 })
})

test('페이지 크기가 0 이면 0 으로 나누는 대신 던진다', () => {
  assert.throws(() => bboxFromPdf({ x0: 0, y0: 0, x1: 1, y1: 1 }, { width: 0, height: 800 }))
  assert.throws(() => bboxFromTopLeft({ x0: 0, y0: 0, x1: 1, y1: 1 }, { width: 600, height: 0 }))
})

test('NaN 좌표는 0 으로 접힌다', () => {
  assert.deepEqual(clampBbox({ x0: NaN, y0: Infinity, x1: 0.5, y1: -3 }), { x0: 0, y0: 1, x1: 0.5, y1: 0 })
})

// ── 해시 ─────────────────────────────────────────────────────

test('본문 해시는 공백 흔들림을 무시한다', () => {
  const a = '제1장  사업개요\n\n\n본  문'
  const b = '제1장 사업개요\n본 문'
  assert.equal(textHash(a), textHash(b), '파서를 올릴 때마다 전 블록이 바뀐 것이 된다')
  assert.equal(normalizeForHash('  앞뒤  공백  '), '앞뒤 공백')
  assert.equal(normalizeForHash('폭​없는﻿문자'), '폭없는문자')
})

test('본문 해시는 내용이 다르면 다르다', () => {
  assert.notEqual(textHash('사업금액 5억원'), textHash('사업금액 6억원'))
})

test('해시는 같은 입력에 같은 값이다', () => {
  assert.equal(textHash('같은 글'), textHash('같은 글'))
  assert.equal(textHash('').length, 32)
})

// ── 블록 ID ──────────────────────────────────────────────────

test('같은 자리를 다시 파싱하면 같은 블록 ID 가 나온다', () => {
  const ref: SourceRef = { kind: 'hwp', sectionIdx: 0, paraIdx: 12 }
  // 재파싱해도 근거 링크가 살아 있어야 한다 (설계서 3.1-6)
  assert.equal(blockKey('file-1', ref, 3), blockKey('file-1', ref, 3))
})

test('다른 자리, 다른 파일, 다른 순서는 다른 블록 ID 다', () => {
  const ref: SourceRef = { kind: 'pdf', pageIdx: 1, charStart: 0, charEnd: 40 }
  const ids = new Set([
    blockKey('file-1', ref, 0),
    blockKey('file-2', ref, 0),
    blockKey('file-1', { ...ref, charStart: 41, charEnd: 80 }, 0),
    blockKey('file-1', ref, 1),
    blockKey('file-1', { kind: 'office', nodePath: '/sheet1/A1' }, 0),
  ])
  assert.equal(ids.size, 5, '블록 ID 가 겹치면 근거가 남의 자리를 가리킨다')
})

test('makeBlock 이 ID 와 해시를 채우고 옵션은 null 로 둔다', () => {
  const b = makeBlock('f1', 0, {
    type: 'paragraph', text: '사업기간 12개월',
    sourceRef: { kind: 'hwp', sectionIdx: 0, paraIdx: 1 },
  })
  assert.equal(b.blockId.length, 24)
  assert.equal(b.textHash, textHash('사업기간 12개월'))
  assert.equal(b.html, null)
  assert.equal(b.bbox, null)
  assert.equal(b.ocrConfidence, null)
  assert.equal(b.orderNo, 0)
})

// ── 정합성 ───────────────────────────────────────────────────

test('없는 섹션·블록을 가리키면 저장 전에 잡는다', () => {
  const b = makeBlock('f1', 0, {
    type: 'paragraph', text: 'ㄱ', sectionId: 'sec-없음',
    sourceRef: { kind: 'hwp', sectionIdx: 0, paraIdx: 0 },
  })
  const doc = makeDocument({
    meta: META,
    blocks: [b],
    tables: [{ tableId: 't1', blockId: '없는블록', rows: 1, cols: 1, cells: [], caption: null }],
    figures: [{ figureId: 'g1', blockId: '없는블록', imageRef: null, extractedText: null }],
  })
  const problems = validateDocument(doc)
  assert.equal(problems.length, 3)
  assert.ok(problems.some((p) => p.includes('없는 섹션')))
  assert.ok(problems.some((p) => p.includes('표')))
  assert.ok(problems.some((p) => p.includes('그림')))
})

test('제대로 이어진 문서는 문제 0건이고 블록을 찾을 수 있다', () => {
  const b = makeBlock('f1', 0, {
    type: 'heading', text: '제1장 사업개요', sectionId: 's1', pageNo: 1,
    sourceRef: { kind: 'hwp', sectionIdx: 0, paraIdx: 0 },
  })
  const doc = makeDocument({
    meta: META,
    sections: [{
      sectionId: 's1', level: 1, title: '사업개요', number: '제1장', parentId: null,
      category: 'overview', pageStart: 1, pageEnd: 1, blockIds: [b.blockId], orderNo: 0,
    }],
    blocks: [b],
  })
  assert.deepEqual(validateDocument(doc), [])
  assert.equal(findBlock(doc, b.blockId)?.text, '제1장 사업개요')
  assert.equal(findBlock(doc, '없다'), null)
})

test('블록 ID 가 겹치면 잡는다', () => {
  const ref: SourceRef = { kind: 'image', pageIdx: 0 }
  const a = makeBlock('f1', 0, { type: 'figure', text: 'ㄱ', sourceRef: ref })
  const doc = makeDocument({ meta: META, blocks: [a, { ...a }] })
  assert.ok(validateDocument(doc).some((p) => p.includes('겹친다')))
})

// ── 품질 점수 ────────────────────────────────────────────────

test('글자를 못 건진 스캔 문서는 경고 아래로 떨어진다', () => {
  const scanned = qualityScore({
    textPageRatio: 0.05, tableCount: 0, avgOcrConfidence: 0.4, sectionDepth: 1, warningCount: 2,
  })
  assert.ok(isLowQuality(scanned), `스캔 문서 점수가 ${scanned} 로 경고를 안 띄운다`)
})

test('제대로 파싱된 문서는 경고를 안 띄운다', () => {
  const clean = qualityScore({
    textPageRatio: 1, tableCount: 6, avgOcrConfidence: null, sectionDepth: 3, warningCount: 0,
  })
  assert.ok(clean >= QUALITY_WARN_BELOW, `정상 문서 점수가 ${clean} 다`)
  assert.ok(clean <= 100)
})

test('점수는 0~100 을 벗어나지 않는다', () => {
  assert.equal(qualityScore({ textPageRatio: 1, tableCount: 99, avgOcrConfidence: 1, sectionDepth: 9, warningCount: 0 }), 100)
  assert.equal(qualityScore({ textPageRatio: 0, tableCount: 0, avgOcrConfidence: 0, sectionDepth: 0, warningCount: 99 }), 0)
})

test('경고가 늘면 점수가 내려간다', () => {
  const base = { textPageRatio: 1, tableCount: 3, avgOcrConfidence: null, sectionDepth: 3 }
  assert.ok(qualityScore({ ...base, warningCount: 0 }) > qualityScore({ ...base, warningCount: 3 }))
})

test('섹션 깊이 1 은 폴백이라 가산이 없다', () => {
  const base = { textPageRatio: 1, tableCount: 3, avgOcrConfidence: null, warningCount: 0 }
  assert.ok(qualityScore({ ...base, sectionDepth: 3 }) > qualityScore({ ...base, sectionDepth: 1 }))
})
