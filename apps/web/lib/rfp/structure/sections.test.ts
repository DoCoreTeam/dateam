/**
 * 섹션 트리와 표준 목차 분류 가드 (설계서 3.4.1, 3.4.2)
 *
 * 여기서 잠그는 것 셋
 * - 번호 체계가 깊이를 만드는가 (제1장 아래 1. 아래 가.)
 * - 제목을 못 찾으면 빈 트리가 아니라 쪽 단위로 접는가
 * - 분류가 키워드만으로 되고 애매한 것은 미분류로 남는가
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  detectHeading, buildSections, applySections, MAX_HEADING_CHARS, NUMBER_LEVELS,
} from './sections.ts'
import {
  guessCategory, applyCategories, normalizeTitle, categoryCoverage, COVERAGE_WARN_BELOW,
} from './categories.ts'
import { makeBlock, makeDocument } from '../ir/build.ts'
import type { IrDocument, IrMeta, BlockType } from '../ir/types.ts'

const META: IrMeta = {
  fileRole: 'main', format: 'hwp', pageCount: 2,
  parser: 'rhwp', parserVersion: '0.8.6', qualityScore: 70, warnings: [],
}

function 문서(rows: [string, BlockType?, number?][]): IrDocument {
  const blocks = rows.map(([text, type, pageNo], i) => makeBlock('f1', i, {
    type: type ?? 'paragraph',
    text,
    pageNo: pageNo ?? null,
    sourceRef: { kind: 'hwp', sectionIdx: 0, paraIdx: i },
  }))
  return makeDocument({ meta: META, blocks })
}

// 제목 찾기

test('번호 체계가 깊이를 만든다', () => {
  const 표: [string, number][] = [
    ['제1장 사업개요', 1],
    ['제 2 편 과업내용', 1],
    ['제2절 추진배경', 2],
    ['1. 사업목적', 2],
    ['가. 세부내용', 3],
    ['1) 기능요구사항', 3],
    ['(2) 성능요구사항', 4],
    ['① 응답시간', 4],
    ['- 세부 항목', 5],
  ]
  for (const [text, level] of 표) {
    const hit = detectHeading(makeBlock('f', 0, { type: 'paragraph', text, sourceRef: { kind: 'hwp', sectionIdx: 0, paraIdx: 0 } }))
    assert.equal(hit?.level, level, `${text} 의 깊이가 ${hit?.level} 이다`)
  }
})

test('원문 번호를 그대로 남긴다', () => {
  const hit = detectHeading(makeBlock('f', 0, { type: 'paragraph', text: '제1장 사업개요', sourceRef: { kind: 'hwp', sectionIdx: 0, paraIdx: 0 } }))
  assert.equal(hit?.number, '제1장')
  assert.equal(hit?.title, '사업개요')
  assert.equal(hit?.matchedBy, 'number')
})

test('번호만 있고 말이 없으면 제목이 아니다', () => {
  const b = makeBlock('f', 0, { type: 'paragraph', text: '1.', sourceRef: { kind: 'hwp', sectionIdx: 0, paraIdx: 0 } })
  assert.equal(detectHeading(b), null)
})

test('번호가 붙은 긴 문장은 본문이지 제목이 아니다', () => {
  const 긴글 = '1. ' + '가'.repeat(MAX_HEADING_CHARS + 1)
  const b = makeBlock('f', 0, { type: 'paragraph', text: 긴글, sourceRef: { kind: 'hwp', sectionIdx: 0, paraIdx: 0 } })
  // 한 문단 통째가 제목이면 트리가 무너진다
  assert.equal(detectHeading(b), null)
})

test('번호가 없으면 파서가 제목이라 한 것만 믿는다', () => {
  const 문단 = makeBlock('f', 0, { type: 'paragraph', text: '사업개요', sourceRef: { kind: 'hwp', sectionIdx: 0, paraIdx: 0 } })
  const 제목 = makeBlock('f', 1, { type: 'heading', text: '사업개요', sourceRef: { kind: 'hwp', sectionIdx: 0, paraIdx: 1 } })
  assert.equal(detectHeading(문단), null, '짧은 본문을 제목으로 봤다')
  assert.equal(detectHeading(제목)?.matchedBy, 'style')
})

test('깊이 목록에 겹치는 단계가 없다', () => {
  const names = NUMBER_LEVELS.map((l) => l.name)
  assert.equal(new Set(names).size, names.length)
})

// 트리

test('제1장 아래 1. 아래 가. 로 이어진다', () => {
  const doc = 문서([
    ['제1장 사업개요'],
    ['본문 한 줄'],
    ['1. 사업목적'],
    ['목적 본문'],
    ['가. 세부'],
    ['세부 본문'],
    ['제2장 과업내용'],
  ])
  const r = buildSections(doc)
  assert.equal(r.fallback, false)
  assert.equal(r.depth, 3)
  assert.deepEqual(r.sections.map((s) => s.title), ['사업개요', '사업목적', '세부', '과업내용'])

  const [장1, 절1, 항1, 장2] = r.sections
  assert.equal(장1.parentId, null)
  assert.equal(절1.parentId, 장1.sectionId)
  assert.equal(항1.parentId, 절1.sectionId)
  // 다음 장이 열리면 그 아래 단계는 전부 닫힌다
  assert.equal(장2.parentId, null)
})

test('본문 블록이 가장 깊은 섹션에 붙는다', () => {
  const doc = 문서([['제1장 사업개요'], ['1. 목적'], ['목적 본문']])
  const r = buildSections(doc)
  const 목적 = r.sections.find((s) => s.title === '목적')!
  assert.equal(r.sectionOfBlock.get(doc.blocks[2].blockId), 목적.sectionId)
  assert.equal(목적.blockIds.length, 2, '제목과 본문이 함께 있어야 한다')
})

test('첫 제목 앞의 표지는 어느 섹션에도 안 붙인다', () => {
  const doc = 문서([['○○사업 제안요청서'], ['제1장 사업개요']])
  const r = buildSections(doc)
  assert.equal(r.sectionOfBlock.has(doc.blocks[0].blockId), false)
})

test('쪽 범위가 섹션에 쌓인다', () => {
  const doc = 문서([['제1장 개요', 'paragraph', 1], ['본문', 'paragraph', 2], ['본문', 'paragraph', 3]])
  const r = buildSections(doc)
  assert.equal(r.sections[0].pageStart, 1)
  assert.equal(r.sections[0].pageEnd, 3)
})

test('제목이 하나도 없으면 쪽 단위로 접는다', () => {
  const doc = 문서([['스캔 본문', 'paragraph', 1], ['다음 쪽 본문', 'paragraph', 2]])
  const r = buildSections(doc)
  // 빈 트리를 주면 뒤 단계가 「섹션 없음」을 「내용 없음」으로 읽는다
  assert.equal(r.fallback, true)
  assert.equal(r.depth, 1)
  assert.equal(r.sections.length, 2)
  assert.deepEqual(r.sections.map((s) => s.pageStart), [1, 2])
})

test('폴백 섹션은 없는 제목을 지어내지 않는다', () => {
  const r = buildSections(문서([['본문', 'paragraph', 1]]))
  assert.equal(r.sections[0].title, null)
  assert.equal(r.sections[0].number, null)
})

test('쪽 번호마저 없으면 문서 전체가 한 섹션이다', () => {
  const r = buildSections(문서([['본문 하나'], ['본문 둘']]))
  assert.equal(r.fallback, true)
  assert.equal(r.sections.length, 1)
  assert.equal(r.sections[0].blockIds.length, 2)
})

test('같은 문서를 두 번 만들면 섹션 ID 가 같다', () => {
  const rows: [string][] = [['제1장 개요'], ['본문']]
  assert.deepEqual(
    buildSections(문서(rows)).sections.map((s) => s.sectionId),
    buildSections(문서(rows)).sections.map((s) => s.sectionId),
  )
})

test('붙이면 원본을 바꾸지 않고 새 문서가 나온다', () => {
  const doc = 문서([['제1장 개요'], ['본문']])
  const applied = applySections(doc, buildSections(doc))
  assert.equal(doc.blocks[0].sectionId, null, '원본 블록을 고쳤다')
  assert.ok(applied.blocks[0].sectionId)
  assert.equal(applied.sections.length, 1)
})

// 분류

test('표준 카테고리 14종을 제목으로 찍는다', () => {
  const 표: [string, string][] = [
    ['사업개요', 'overview'],
    ['추진배경 및 필요성', 'background'],
    ['과업의 범위', 'scope'],
    ['요구사항 총괄표', 'requirement_summary'],
    ['기능요구사항', 'functional'],
    ['성능요구사항', 'performance'],
    ['보안요구사항', 'security'],
    ['제약사항', 'constraints'],
    ['추진일정', 'schedule'],
    ['사업예산', 'budget'],
    ['입찰안내', 'bid_guide'],
    ['입찰참가자격', 'eligibility'],
    ['제안서 평가기준', 'evaluation'],
    ['계약조건', 'contract_terms'],
    ['별지 서식', 'forms'],
  ]
  for (const [title, cat] of 표) {
    assert.equal(guessCategory(title).category, cat, `${title} 를 ${cat} 로 못 찍었다`)
  }
})

test('좁은 규칙이 넓은 규칙보다 먼저다', () => {
  // 보안 요구사항은 보안이지 기능이 아니다
  assert.equal(guessCategory('보안요구사항').category, 'security')
  // 제안서 평가기준은 평가이지 제안 안내가 아니다
  assert.equal(guessCategory('제안서 평가기준').category, 'evaluation')
})

test('제목을 펴서 번호와 기호를 무시한다', () => {
  assert.equal(normalizeTitle('Ⅱ. 과업 내용 (2)'), 'ⅱ과업내용')
  assert.equal(guessCategory('Ⅱ. 과업 내용').category, 'scope')
})

test('애매한 것은 미분류로 남긴다', () => {
  // 틀린 분류보다 빈 분류가 고치기 쉽다
  assert.equal(guessCategory('참고사항').category, null)
  assert.equal(guessCategory('가.').category, null)
  assert.equal(guessCategory(null).category, null)
})

test('무엇을 보고 찍었는지 남긴다', () => {
  assert.equal(guessCategory('기능요구사항').matched, '기능요구')
  assert.equal(guessCategory('참고사항').matched, null)
})

test('자기 제목으로 못 정하면 부모 분류를 물려받는다', () => {
  const doc = 문서([['제1장 기능요구사항'], ['가. 세부'], ['본문']])
  const built = buildSections(doc)
  const withCat = applyCategories(built.sections)
  // 「가.」가 미분류로 남으면 그 아래 본문이 어디에도 안 걸린다
  assert.equal(withCat[0].category, 'functional')
  assert.equal(withCat[1].category, 'functional')
})

test('분류가 채워진 비율을 잰다', () => {
  const doc = 문서([['제1장 사업개요'], ['제2장 참고사항']])
  const withCat = applyCategories(buildSections(doc).sections)
  assert.equal(categoryCoverage(withCat), 0.5)
  assert.ok(categoryCoverage(withCat) <= COVERAGE_WARN_BELOW)
  assert.equal(categoryCoverage([]), 0)
})

test('분류를 채워도 원본을 바꾸지 않는다', () => {
  const built = buildSections(문서([['제1장 사업개요']]))
  const withCat = applyCategories(built.sections)
  assert.equal(built.sections[0].category, null, '원본 섹션을 고쳤다')
  assert.equal(withCat[0].category, 'overview')
})
