/**
 * 요구사항 총괄표 정규화 가드 (설계서 3.4.4)
 *
 * 여기서 잠그는 것 셋
 * - 코드 체계(SFR PER SER 등)를 뽑아 코드·분류·제목·설명·근거로 정규화하는가
 * - 표 머리글 이름이 달라도 같은 결과가 나오는가
 * - XLSX 별첨 모양(시트 한 장이 표 하나)도 같은 결과가 나오는가
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  extractRequirements, parseCode, mapColumns, findHeaderRow,
  dedupeRequirements, requirementsHash, countByKind, CODE_PREFIX,
  stripBullet,
} from './requirements.ts'
import { makeBlock, makeDocument } from '../ir/build.ts'
import type { IrDocument, IrMeta, IrTable, SourceRef } from '../ir/types.ts'

const META: IrMeta = {
  fileRole: 'main', format: 'hwp', pageCount: 1,
  parser: 'rhwp', parserVersion: '0.8.6', qualityScore: 80, warnings: [],
}

/** 행 배열로 표 하나짜리 문서를 만든다 */
function 표문서(grid: string[][], opts: { ref?: SourceRef; id?: string } = {}): IrDocument {
  const ref: SourceRef = opts.ref ?? { kind: 'hwp', sectionIdx: 0, paraIdx: 3 }
  const block = makeBlock('f1', 0, {
    type: 'table',
    text: grid.map((r) => r.join('\t')).join('\n'),
    sourceRef: ref,
  })
  const cols = Math.max(...grid.map((r) => r.length))
  const table: IrTable = {
    tableId: opts.id ?? 't1',
    blockId: block.blockId,
    rows: grid.length,
    cols,
    cells: grid.flatMap((row, r) =>
      Array.from({ length: cols }, (_, c) => ({ r, c, rowspan: 1, colspan: 1, text: row[c] ?? '' }))),
    caption: null,
  }
  return makeDocument({ meta: META, blocks: [block], tables: [table] })
}

const 총괄표 = [
  ['요구사항 총괄표'],
  ['요구사항 고유번호', '요구사항 분류', '요구사항명', '세부내용'],
  ['SFR-001', '기능', '사용자 인증', '아이디와 비밀번호로 로그인한다'],
  ['SFR-002', '기능', '권한 관리', '역할별로 메뉴를 제한한다'],
  ['PER-001', '성능', '응답시간', '조회 응답 3초 이내'],
  ['SER-001', '보안', '개인정보 암호화', '주민번호는 저장하지 않는다'],
]

// 코드

test('코드 접두어로 종류를 안다', () => {
  assert.deepEqual(parseCode('SFR-001'), { code: 'SFR-001', kind: 'functional' })
  assert.deepEqual(parseCode('PER-010'), { code: 'PER-010', kind: 'performance' })
  assert.deepEqual(parseCode('SER-001'), { code: 'SER-001', kind: 'security' })
  assert.equal(parseCode('요구사항명'), null)
})

test('구분자가 달라도 같은 코드로 읽는다', () => {
  // 실제 공고에 SFR-001 SFR_001 SFR 001 SFR001 이 다 있다
  for (const raw of ['SFR-001', 'SFR_001', 'SFR 001', 'SFR001', 'sfr-001']) {
    assert.equal(parseCode(raw)?.code, 'SFR-001', `${raw} 를 못 읽었다`)
  }
})

test('모르는 접두어는 버리지 않고 unknown 으로 남긴다', () => {
  // 공고마다 자기 체계를 쓴다. 버리면 그 공고의 요구사항이 통째로 사라진다
  const r = parseCode('ABC-001')
  assert.equal(r?.code, 'ABC-001')
  assert.equal(r?.kind, 'unknown')
})

test('알려진 접두어 목록에 겹치는 값이 없다', () => {
  const keys = Object.keys(CODE_PREFIX)
  assert.equal(new Set(keys).size, keys.length)
})

// 칸 찾기

test('머리글 이름으로 칸의 뜻을 찾는다', () => {
  const m = mapColumns(['요구사항 고유번호', '요구사항 분류', '요구사항명', '세부내용'])
  assert.equal(m.get('code'), 0)
  assert.equal(m.get('kind'), 1)
  assert.equal(m.get('title'), 2)
  assert.equal(m.get('description'), 3)
})

test('머리글 이름이 달라도 같은 칸을 찾는다', () => {
  const m = mapColumns(['번호', '구분', '요구사항', '상세설명', '산출물'])
  assert.equal(m.get('code'), 0)
  assert.equal(m.get('kind'), 1)
  assert.equal(m.get('title'), 2)
  assert.equal(m.get('description'), 3)
})

test('머리글이 첫 줄이 아니어도 찾는다', () => {
  // 총괄표는 첫 줄이 제목인 경우가 흔하다. 0번째로 두면 한 줄씩 밀린다
  assert.equal(findHeaderRow(총괄표), 1)
})

test('머리글이 없으면 없다고 말한다', () => {
  assert.equal(findHeaderRow([['SFR-001', '사용자 인증'], ['SFR-002', '권한 관리']]), -1)
})

// 정규화

test('총괄표에서 요구사항을 코드·분류·제목·설명·근거로 뽑는다', () => {
  const { requirements, tableIds } = extractRequirements(표문서(총괄표))
  assert.equal(requirements.length, 4)
  assert.deepEqual(tableIds, ['t1'])

  const [첫] = requirements
  assert.equal(첫.code, 'SFR-001')
  assert.equal(첫.kind, 'functional')
  assert.equal(첫.title, '사용자 인증')
  assert.equal(첫.description, '아이디와 비밀번호로 로그인한다')
  assert.equal(첫.rowNo, 2)
  // 근거 블록이 없으면 리포트가 이 요구사항을 인용할 수 없다
  assert.ok(첫.blockId)
  assert.equal(첫.tableId, 't1')
})

test('표에 적힌 분류를 코드 접두어보다 먼저 믿는다', () => {
  const { requirements } = extractRequirements(표문서([
    ['요구사항 ID', '구분', '요구사항명'],
    // 접두어는 기능인데 표에는 보안이라 적혀 있다. 사람이 적은 쪽이 진실이다
    ['SFR-001', '보안', '접근 통제'],
  ]))
  assert.equal(requirements[0].kind, 'security')
})

test('코드가 없는 줄은 요구사항이 아니다', () => {
  const { requirements } = extractRequirements(표문서([
    ['요구사항 ID', '요구사항명', '세부내용'],
    ['1. 기능 요구사항', '', ''],
    ['SFR-001', '사용자 인증', '로그인'],
    ['합계', '1건', ''],
  ]))
  // 소제목이나 합계가 섞이면 「요구사항 몇 건」이 부풀고 적합도가 조용히 틀린다
  assert.equal(requirements.length, 1)
  assert.equal(requirements[0].code, 'SFR-001')
})

test('우리 칸에 안 들어간 값은 버리지 않고 남긴다', () => {
  const { requirements } = extractRequirements(표문서([
    ['요구사항 ID', '요구사항명', '세부내용', '산출물', '중요도'],
    ['SFR-001', '사용자 인증', '로그인', '설계서', '상'],
  ]))
  assert.deepEqual(requirements[0].extra, { 산출물: '설계서', 중요도: '상' })
})

test('머리글이 없어도 코드가 있으면 뽑는다', () => {
  const { requirements } = extractRequirements(표문서([
    ['SFR-001', '사용자 인증'],
    ['SFR-002', '권한 관리'],
  ]))
  assert.equal(requirements.length, 2)
  assert.equal(requirements[0].title, '사용자 인증')
})

test('요구사항이 없는 표는 표 목록에도 안 들어간다', () => {
  const { requirements, tableIds } = extractRequirements(표문서([
    ['항목', '금액'],
    ['사업비', '500,000,000'],
  ]))
  assert.deepEqual(requirements, [])
  assert.deepEqual(tableIds, [])
})

// XLSX 별첨

test('XLSX 별첨 총괄표도 같은 결과로 정규화된다', () => {
  // 시트 한 장이 표 하나로 들어온다. 파서가 달라도 IrTable 이면 같은 길이다
  const xlsx = 표문서(총괄표, { ref: { kind: 'office', nodePath: '/0/0' }, id: 't-xlsx' })
  const hwp = 표문서(총괄표)

  const a = extractRequirements(xlsx).requirements
  const b = extractRequirements(hwp).requirements

  assert.equal(a.length, b.length)
  assert.deepEqual(
    a.map((r) => [r.code, r.kind, r.title, r.description]),
    b.map((r) => [r.code, r.kind, r.title, r.description]),
  )
  // 근거는 다르다 — 같은 내용이 다른 파일에서 왔으니 그래야 맞다
  assert.notEqual(a[0].blockId, b[0].blockId)
  assert.equal(a[0].tableId, 't-xlsx')
})

// 겹침과 지문

test('코드가 겹치면 자세한 쪽을 남긴다', () => {
  const 짧은 = { code: 'SFR-001', kind: 'functional' as const, title: '인증', description: '', blockId: 'b1', tableId: 't1', rowNo: 1, extra: {} }
  const 자세한 = { ...짧은, description: '아이디와 비밀번호로 로그인한다', blockId: 'b2', tableId: 't2', rowNo: 2 }
  // 총괄표가 본문과 별첨에 두 번 실리면 「120건」이 실제로는 60건이다
  const out = dedupeRequirements([짧은, 자세한])
  assert.equal(out.length, 1)
  assert.equal(out[0].blockId, 'b2')
})

test('묶음 지문은 순서가 달라도 같다', () => {
  const { requirements } = extractRequirements(표문서(총괄표))
  const 뒤집힘 = [...requirements].reverse()
  // 정정공고 비교가 순서 때문에 「바뀌었다」고 하면 안 된다
  assert.equal(requirementsHash(requirements), requirementsHash(뒤집힘))
})

test('내용이 바뀌면 지문도 바뀐다', () => {
  const a = extractRequirements(표문서(총괄표)).requirements
  const b = extractRequirements(표문서([
    ...총괄표.slice(0, 4),
    ['PER-001', '성능', '응답시간', '조회 응답 1초 이내'],
    총괄표[5],
  ])).requirements
  assert.notEqual(requirementsHash(a), requirementsHash(b))
})

test('종류별 건수를 센다', () => {
  const { requirements } = extractRequirements(표문서(총괄표))
  assert.deepEqual(countByKind(requirements), { functional: 2, performance: 1, security: 1 })
})

test('글머리표를 뗀다 — 한글 문서는 글머리표를 글자로 넣는다', () => {
  // 실측(콜롬비아 AI 제안요청서): 요구사항 이름이 「ｏ 모바일 관련」으로 나왔다
  assert.equal(stripBullet('ｏ 모바일 관련'), '모바일 관련')
  assert.equal(stripBullet('○ 참여인원 보안관리'), '참여인원 보안관리')
  assert.equal(stripBullet('□ 사업 착수계 제출'), '사업 착수계 제출')
  assert.equal(stripBullet('- 하도급 관리'), '하도급 관리')
})

test('멀쩡한 이름은 안 깎는다', () => {
  assert.equal(stripBullet('참여인원 보안관리'), '참여인원 보안관리')
  assert.equal(stripBullet('AI 정책 현황 진단'), 'AI 정책 현황 진단')
})
