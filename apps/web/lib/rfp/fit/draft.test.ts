/**
 * 프로필 자동 초안 가드 (설계서 3.10.2)
 *
 * 여기서 잠그는 것 셋
 * - 회사소개서와 실적표를 인입 파이프라인 결과(IR)에 그대로 태워 초안이 나오는가
 * - 초안이 draft 로만 남고 확정 전에는 판정에 안 쓰이는가
 * - 값마다 근거가 붙는가 (확인·수정이 실제로 이뤄지려면 필요하다)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { draftProfile, tableToRecords, toIso, isUsableForAssessment, confirmDraft, matchedCerts } from './draft.ts'
import { assess } from './assess.ts'
import { makeBlock, makeDocument } from '../ir/build.ts'
import type { IrDocument, IrMeta, IrTable } from '../ir/types.ts'

const META: IrMeta = {
  fileRole: 'etc', format: 'pdf', pageCount: 1,
  parser: 'officeparser', parserVersion: '7.3.0', qualityScore: 80, warnings: [],
}

/** 파싱 파이프라인이 낸 것과 같은 모양의 문서를 만든다 */
function 문서(texts: string[]): IrDocument {
  return makeDocument({
    meta: META,
    blocks: texts.map((t, i) => makeBlock('f1', i, {
      type: 'paragraph', text: t, pageNo: 1,
      sourceRef: { kind: 'office', nodePath: `/${i}` },
    })),
  })
}

function 표문서(grid: string[][]): IrDocument {
  const block = makeBlock('f2', 0, {
    type: 'table', text: grid.map((r) => r.join('\t')).join('\n'), pageNo: 1,
    sourceRef: { kind: 'office', nodePath: '/t' },
  })
  const cols = Math.max(...grid.map((r) => r.length))
  const table: IrTable = {
    tableId: 't1', blockId: block.blockId, rows: grid.length, cols,
    cells: grid.flatMap((row, r) => Array.from({ length: cols }, (_, c) => ({
      r, c, rowspan: 1, colspan: 1, text: row[c] ?? '',
    }))),
    caption: null,
  }
  return makeDocument({ meta: META, blocks: [block], tables: [table] })
}

const 회사소개서 = 문서([
  '주식회사 데이터얼라이언스 회사소개서',
  '사업자등록번호 123-45-67890',
  '자본금 10억원, 연간 매출액 150억원',
  '임직원 수 87명',
  '본사 소재지는 서울특별시 강남구입니다',
  '소프트웨어사업자 신고를 마쳤습니다',
  'ISO 27001 및 ISMS-P 인증을 보유하고 있습니다',
])

const 실적표 = 표문서([
  ['사업명', '발주기관', '계약금액', '착수일', '완료일'],
  ['AI 플랫폼 구축', '한국전력공사', '20억원', '2024.03.01', '2025.02.28'],
  ['데이터 레이크 구축', '국민건강보험공단', '8억원', '2025.01.15', '2025.12.31'],
])

// 인입 파이프라인 재사용

test('회사소개서에서 기본 정보를 뽑는다', () => {
  const d = draftProfile([회사소개서])
  assert.equal(d.profile.basic.businessNumber, '123-45-67890')
  assert.equal(d.profile.basic.capitalKrw, 1_000_000_000)
  assert.equal(d.profile.basic.annualRevenueKrw, 15_000_000_000)
  assert.equal(d.profile.basic.headcount, 87)
  assert.equal(d.profile.basic.region, '서울특별시')
  assert.deepEqual(d.profile.basic.registrations, ['소프트웨어사업자 신고'])
})

test('인증을 알아보되 긴 이름이 이긴다', () => {
  const d = draftProfile([회사소개서])
  // 「ISMS-P」 안의 「ISMS」 를 따로 세면 인증 하나가 둘로 늘고 그 숫자로 자격을 판정한다
  assert.deepEqual(d.profile.certifications.map((c) => c.name).sort(), ['ISMS-P', 'ISO 27001'])
  assert.deepEqual(matchedCerts('ISMS-P 인증'), ['ISMS-P'])
  assert.deepEqual(matchedCerts('ISMS 인증'), ['ISMS'])
})

test('실적표에서 실적을 뽑는다', () => {
  const d = draftProfile([실적표])
  assert.equal(d.profile.trackRecords.length, 2)
  const [첫] = d.profile.trackRecords
  assert.equal(첫.projectName, 'AI 플랫폼 구축')
  assert.equal(첫.client, '한국전력공사')
  assert.equal(첫.amountKrw, 2_000_000_000)
  assert.equal(첫.startDate, '2024-03-01')
  assert.equal(첫.endDate, '2025-02-28')
})

test('여러 문서를 한 초안으로 합친다', () => {
  const d = draftProfile([회사소개서, 실적표])
  assert.equal(d.profile.basic.capitalKrw, 1_000_000_000)
  assert.equal(d.profile.trackRecords.length, 2)
})

test('사업명 칸이 없는 표는 실적표가 아니다', () => {
  const 표 = 표문서([['항목', '금액'], ['사업비', '5억원']])
  assert.deepEqual(draftProfile([표]).profile.trackRecords, [])
})

test('같은 사업을 두 번 넣지 않는다', () => {
  const d = draftProfile([실적표, 실적표])
  assert.equal(d.profile.trackRecords.length, 2)
})

test('날짜 표기가 달라도 ISO 로 맞춘다', () => {
  assert.equal(toIso('2024.03.01'), '2024-03-01')
  assert.equal(toIso('2024-3-1'), '2024-03-01')
  assert.equal(toIso('2024년 3월'), '2024-03-01')
  assert.equal(toIso(''), null)
  assert.equal(toIso('없음'), null)
})

test('빈 문서에서는 아무것도 안 뽑는다', () => {
  const d = draftProfile([문서([])])
  assert.equal(d.profile.basic.businessNumber, null)
  assert.ok(d.missing.length > 0)
})

// 근거

test('값마다 어디서 뽑았는지 남긴다', () => {
  const d = draftProfile([회사소개서])
  const fields = new Set(d.evidence.map((e) => e.field))
  // 「자본금이 왜 10억이지」를 확인할 수 있어야 확인·수정이 실제로 이뤄진다
  assert.ok(fields.has('basic.capitalKrw'))
  assert.ok(fields.has('basic.businessNumber'))
  for (const e of d.evidence) assert.ok(e.blockId, '근거에 블록 ID 가 없다')
})

test('못 뽑은 칸을 알려 준다', () => {
  const d = draftProfile([문서(['자본금 10억원'])])
  // 화면이 여기부터 물어본다
  assert.ok(d.missing.includes('basic.companyName'))
  assert.ok(d.missing.includes('trackRecords'))
  assert.equal(d.missing.includes('basic.capitalKrw'), false)
})

// 확정 전에는 안 쓴다

test('초안은 draft 상태다', () => {
  const d = draftProfile([회사소개서])
  assert.equal(d.profile.status, 'draft')
  assert.equal(isUsableForAssessment(d.profile), false)
})

test('확정해야 판정에 쓸 수 있다', () => {
  const d = draftProfile([회사소개서])
  const confirmed = confirmDraft({ ...d.profile, basic: { ...d.profile.basic, companyName: '데이터얼라이언스' } })
  assert.equal(confirmed.status, 'active')
  assert.equal(isUsableForAssessment(confirmed), true)
  // 원본은 그대로 draft 다
  assert.equal(d.profile.status, 'draft')
})

test('이름 없이 확정할 수 없다', () => {
  const d = draftProfile([회사소개서])
  assert.throws(() => confirmDraft(d.profile), /회사 이름 없이/)
})

test('초안으로 판정하면 자격이 확인 불가로 남는다', () => {
  // 자동으로 뽑은 값이 틀린 채 판정에 쓰이면 부적합의 이유가
  // 「우리 회사 정보가 틀려서」가 되고 사용자는 그것을 영영 모른다
  const d = draftProfile([회사소개서])
  assert.equal(isUsableForAssessment(d.profile), false)

  const confirmed = confirmDraft({ ...d.profile, basic: { ...d.profile.basic, companyName: 'X' } })
  const r = assess({
    hardRequirements: [{ text: '자본금 5억원 이상', blockId: 'b1' }],
    profile: confirmed,
    soft: { capability: 0.9, trackRecord: 0.8, scale: 0.9, risk: 0.1, competition: 0.5 },
    reportVersion: 1,
  })
  assert.equal(r.hardChecks[0].result, 'met')
  assert.equal(r.profileVersion, confirmed.version)
})

test('표 셀에서 실적을 옮기는 함수가 홀로도 동작한다', () => {
  const records = tableToRecords(
    [
      { r: 0, c: 0, text: '사업명' }, { r: 0, c: 1, text: '계약금액' },
      { r: 1, c: 0, text: '가나다 구축' }, { r: 1, c: 1, text: '3억원' },
    ], 2, 2)
  assert.equal(records.length, 1)
  assert.equal(records[0].amountKrw, 300_000_000)
})
