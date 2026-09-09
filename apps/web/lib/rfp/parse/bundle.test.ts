/**
 * 첨부 묶음 풀기와 역할 추정 가드 (설계서 3.2.2)
 *
 * ZIP 을 그 자리에서 만들어 검사한다 — 압축 폭탄 표본을 저장소에 두면
 * 백신이 지우거나 클론이 무거워지고, 무엇보다 폭탄을 커밋하게 된다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deflateRawSync } from 'node:zlib'

import {
  unbundle, isZip, MAX_ENTRIES, MAX_TOTAL_UNCOMPRESSED, MAX_RATIO, MAX_NESTING,
} from './bundle.ts'
import {
  guessFileRole, normalizeFileName, needsRoleConfirm, pickMainFile, ROLE_CONFIRM_BELOW,
} from './role.ts'

interface ZipInput {
  name: string
  data: Uint8Array
  /** 헤더에 거짓 크기를 적어 폭탄을 흉내 낸다 */
  fakeUncompressedSize?: number
  store?: boolean
}

function crc32(buf: Uint8Array): number {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

/** 최소한의 ZIP 쓰기 — 로컬 헤더 + 중앙 디렉터리 + EOCD */
function makeZip(inputs: ZipInput[]): Uint8Array {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const inp of inputs) {
    const name = Buffer.from(inp.name, 'utf8')
    const method = inp.store ? 0 : 8
    const body = inp.store ? Buffer.from(inp.data) : deflateRawSync(Buffer.from(inp.data))
    const uncompressed = inp.fakeUncompressedSize ?? inp.data.length
    const crc = crc32(inp.data)

    const local = Buffer.alloc(30 + name.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(uncompressed, 22)
    local.writeUInt16LE(name.length, 26)
    name.copy(local, 30)
    locals.push(local, body)

    const central = Buffer.alloc(46 + name.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(uncompressed, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    name.copy(central, 46)
    centrals.push(central)

    offset += local.length + body.length
  }

  const centralBuf = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(inputs.length, 8)
  eocd.writeUInt16LE(inputs.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)

  return new Uint8Array(Buffer.concat([...locals, centralBuf, eocd]))
}

const 글 = (s: string) => new TextEncoder().encode(s)

// 기본 해제

test('ZIP 인지 앞머리로 안다', () => {
  assert.ok(isZip(makeZip([{ name: 'a.txt', data: 글('ㄱ') }])))
  assert.equal(isZip(글('%PDF-1.7')), false)
  assert.equal(isZip(new Uint8Array([0x50])), false)
})

test('압축된 파일과 무압축 파일을 둘 다 푼다', () => {
  const zip = makeZip([
    { name: '제안요청서.hwp', data: 글('본문 내용'.repeat(50)) },
    { name: '서식.hwp', data: 글('양식'), store: true },
  ])
  const r = unbundle(zip)
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(r.entries.length, 2)
  assert.equal(new TextDecoder().decode(r.entries[1].bytes), '양식')
  assert.deepEqual(r.entries.map((e) => e.fileName), ['제안요청서.hwp', '서식.hwp'])
})

test('디렉터리 항목은 파일로 세지 않는다', () => {
  const r = unbundle(makeZip([
    { name: '붙임/', data: new Uint8Array(0), store: true },
    { name: '붙임/과업내용서.hwp', data: 글('과업'), store: true },
  ]))
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(r.entries.length, 1)
  assert.equal(r.entries[0].fileName, '과업내용서.hwp')
})

test('망가진 ZIP 은 거절한다', () => {
  const r = unbundle(글('PK 아무 말이나'))
  assert.equal(r.ok, false)
  assert.equal(r.ok === false && r.reason, 'corrupt')
})

// 중첩

test('ZIP 안의 ZIP 을 한 겹까지 푼다', () => {
  const inner = makeZip([{ name: '과업내용서.hwp', data: 글('과업 내용'), store: true }])
  const outer = makeZip([
    { name: '공고.zip', data: inner, store: true },
    { name: '공고문.pdf', data: 글('공고'), store: true },
  ])
  const r = unbundle(outer)
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(r.entries.length, 2)
  const nested = r.entries.find((e) => e.depth === 1)
  assert.ok(nested, '안쪽 ZIP 을 안 풀었다')
  // 경로를 이어 붙여야 「어느 묶음에서 나왔나」를 말할 수 있다
  assert.equal(nested!.path, '공고.zip/과업내용서.hwp')
})

test('두 겹보다 깊으면 풀지 않고 그대로 둔다', () => {
  const deepest = makeZip([{ name: '깊은.hwp', data: 글('ㄱ'), store: true }])
  const mid = makeZip([{ name: '안쪽.zip', data: deepest, store: true }])
  const outer = makeZip([{ name: '바깥.zip', data: mid, store: true }])

  const r = unbundle(outer)
  assert.ok(r.ok)
  if (!r.ok) return
  // 깊이를 열어 두면 폭탄이 깊이로 도망간다
  assert.equal(MAX_NESTING, 1)
  assert.equal(r.entries.length, 1)
  assert.equal(r.entries[0].fileName, '안쪽.zip')
  assert.equal(r.entries[0].depth, 1)
})

// 압축 폭탄

test('펴진 총량이 상한을 넘으면 풀기 전에 거절한다', () => {
  // 헤더에만 큰 수를 적는다. 실제로 풀면 서버가 죽으므로 풀기 전 판단이어야 한다
  const zip = makeZip([{
    name: '폭탄.bin', data: 글('작다'),
    fakeUncompressedSize: MAX_TOTAL_UNCOMPRESSED + 1, store: true,
  }])
  const r = unbundle(zip)
  assert.equal(r.ok, false)
  assert.equal(r.ok === false && r.reason, 'too_large')
})

test('파일 개수가 상한을 넘으면 거절한다', () => {
  const many = Array.from({ length: MAX_ENTRIES + 1 }, (_, i) => ({
    name: `f${i}.txt`, data: 글('ㄱ'), store: true,
  }))
  const r = unbundle(makeZip(many))
  assert.equal(r.ok === false && r.reason, 'too_many_entries')
})

test('압축비가 비정상인 파일은 건너뛴다', () => {
  // 0 으로 가득 찬 파일은 실제로 아주 잘 압축된다. 진짜 폭탄의 모양이다
  const zeros = new Uint8Array(3 * 1024 * 1024)
  const zip = makeZip([
    { name: '폭탄.bin', data: zeros },
    { name: '정상.hwp', data: 글('본문'.repeat(100)) },
  ])
  const r = unbundle(zip)
  assert.ok(r.ok, '한 파일 때문에 묶음 전체를 못 읽게 만들면 안 된다')
  if (!r.ok) return
  assert.equal(r.entries.length, 1)
  assert.equal(r.entries[0].fileName, '정상.hwp')
  assert.equal(r.skipped[0].reason, 'suspicious_ratio')
  assert.ok(3 * 1024 * 1024 / 3200 > MAX_RATIO)
})

test('바깥을 가리키는 경로는 건너뛴다', () => {
  const r = unbundle(makeZip([
    { name: '../../etc/passwd', data: 글('ㄱ'), store: true },
    { name: '정상.hwp', data: 글('ㄴ'), store: true },
  ]))
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(r.entries.length, 1)
  assert.equal(r.skipped[0].reason, 'path_traversal')
})

test('건너뛴 파일이 있어도 나머지는 읽는다', () => {
  const r = unbundle(makeZip([
    { name: '/절대경로.hwp', data: 글('ㄱ'), store: true },
    { name: '과업내용서.hwp', data: 글('ㄴ'), store: true },
    { name: '서식.hwp', data: 글('ㄷ'), store: true },
  ]))
  assert.ok(r.ok)
  if (!r.ok) return
  // 서식 하나가 깨졌다고 공고 묶음 전체를 못 읽게 할 이유가 없다
  assert.equal(r.entries.length, 2)
  assert.equal(r.skipped.length, 1)
})

// 역할 추정

test('역할 9종을 이름으로 찍는다', () => {
  const 표: [string, string][] = [
    ['제안요청서.hwp', 'main'],
    ['(붙임1) 과업내용서_최종.hwp', 'scope'],
    ['입찰공고문.pdf', 'notice'],
    ['계약특수조건.hwp', 'special_terms'],
    ['제안서 작성안내서.hwp', 'proposal_guide'],
    ['별지 서식 모음.hwpx', 'forms'],
    ['질의응답 답변.pdf', 'qna'],
    ['정정공고문.hwp', 'amendment'],
    ['사업개요_참고자료.xlsx', 'etc'],
  ]
  for (const [name, role] of 표) {
    assert.equal(guessFileRole(name).role, role, `${name} 를 ${role} 로 못 찍었다`)
  }
})

test('이름을 펴서 공백과 괄호와 번호를 무시한다', () => {
  // 실제 첨부는 (붙임 1) 과업 내용서_최종.hwp 같은 모양이다
  assert.equal(normalizeFileName('(붙임 1) 과업 내용서_최종.hwp'), '붙임과업내용서최종')
  assert.equal(guessFileRole('과업 내용서.hwp').role, 'scope')
})

test('좁은 규칙이 넓은 규칙보다 먼저다', () => {
  // 제안요청서(정정공고) 는 정정공고이지 본문이 아니다
  assert.equal(guessFileRole('제안요청서(정정공고).hwp').role, 'amendment')
  assert.equal(guessFileRole('제안요청서 질의응답.hwp').role, 'qna')
})

test('무엇을 보고 찍었는지 남긴다', () => {
  assert.equal(guessFileRole('과업내용서.hwp').matched, '과업내용')
  assert.equal(guessFileRole('아무거나.zip').matched, null)
})

test('기타는 분류 실패가 아니라 정상이다', () => {
  const g = guessFileRole('참고자료.xlsx')
  assert.equal(g.role, 'etc')
  // 0 으로 두면 화면이 분류 실패로 그린다. 실제로는 분류가 안 되는 파일이 정상이다
  assert.ok(g.confidence > 0)
  assert.ok(needsRoleConfirm(g), '기타는 사람 확인 대상이어야 한다')
})

test('확신이 높으면 사람 확인을 안 받는다', () => {
  assert.equal(needsRoleConfirm(guessFileRole('제안요청서.hwp')), false)
  assert.ok(guessFileRole('제안요청서.hwp').confidence >= ROLE_CONFIRM_BELOW)
})

test('빈 이름은 기타다', () => {
  assert.equal(guessFileRole('').role, 'etc')
  assert.equal(guessFileRole('.hwp').role, 'etc')
})

// 본문 고르기

test('본문이 하나면 그것으로 정한다', () => {
  const r = pickMainFile([{ fileName: '제안요청서.hwp' }, { fileName: '서식.hwp' }])
  assert.equal(r.main?.fileName, '제안요청서.hwp')
  assert.deepEqual(r.ambiguous, [])
})

test('본문이 둘이면 사람이 정한다', () => {
  const r = pickMainFile([{ fileName: '제안요청서.hwp' }, { fileName: 'RFP_최종.hwp' }])
  // 어느 쪽을 믿을지 시스템이 정하면 틀렸을 때 아무도 모른다
  assert.equal(r.main, null)
  assert.equal(r.ambiguous.length, 2)
})

test('본문이 없으면 과업내용서가 본문 노릇을 한다', () => {
  const r = pickMainFile([{ fileName: '과업내용서.hwp' }, { fileName: '서식.hwp' }])
  assert.equal(r.main?.fileName, '과업내용서.hwp')
})

test('아무것도 없으면 비어 있다고 말한다', () => {
  const r = pickMainFile([{ fileName: '서식.hwp' }])
  assert.equal(r.main, null)
  assert.deepEqual(r.ambiguous, [])
})
