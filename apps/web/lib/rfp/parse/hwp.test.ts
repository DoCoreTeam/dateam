/**
 * HWP 파서 어댑터 가드 (설계서 3.3.1)
 *
 * 합성 문서를 그 자리에서 만들어 검사한다 — 실제 RFP 를 저장소에 넣으면
 * 남의 공고문을 커밋하는 셈이고, 파일이 하나 바뀌면 가드가 통째로 흔들린다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  sniffHwp, parseHwp, initHwpEngine, HWP_WARNING, HWP_PARSER, HWP_PARSER_VERSION,
} from './hwp.ts'
import { textHash } from '../ir/build.ts'

const 제목 = '제1장 사업개요'
const 본문 = '사업기간 12개월'

/** createEmpty 로 문단과 2x3 표를 가진 합성 HWP 를 만든다 */
async function 합성문서(): Promise<Uint8Array> {
  const mod = await initHwpEngine()
  const d = mod.HwpDocument.createEmpty()
  try {
    d.insertText(0, 0, 0, 제목)
    d.insertParagraph(0, 0)              // 앞에 끼워 넣으면 기존 글이 다음 문단으로 밀린다
    d.insertText(0, 0, 0, 본문)
    const tbl = JSON.parse(d.createTable(0, 1, d.getParagraphLength(0, 1), 2, 3))
    d.insertTextInCell(0, tbl.paraIdx, tbl.controlIdx, 0, 0, 0, '항목')
    d.insertTextInCell(0, tbl.paraIdx, tbl.controlIdx, 1, 0, 0, '금액')
    return d.exportHwp()
  } finally {
    d.free()
  }
}

/**
 * HWPX 는 표 없는 문서로 만든다.
 * createEmpty 로 만든 표는 스타일 ID 가 비어 있어 HWPX 쓰기가 거부된다 —
 * 파서 문제가 아니라 합성 문서의 한계라 형식 판별만 여기서 본다.
 */
async function 합성HWPX(): Promise<Uint8Array> {
  const mod = await initHwpEngine()
  const d = mod.HwpDocument.createEmpty()
  try {
    d.insertText(0, 0, 0, 제목)
    return d.exportHwpx()
  } finally {
    d.free()
  }
}

/** 배포용 비트만 켠 사본 — 실제 DRM 문서를 구하지 않고 판별만 시험한다 */
function 배포용으로(bytes: Uint8Array): Uint8Array {
  const buf = Buffer.from(bytes)
  const at = buf.indexOf(Buffer.from('HWP Document File', 'latin1'))
  assert.ok(at >= 0, '합성 문서에 HWP5 시그니처가 없다')
  buf.writeUInt32LE(buf.readUInt32LE(at + 36) | 0x04, at + 36)
  return new Uint8Array(buf)
}

// ── 형식 판별 ────────────────────────────────────────────────

test('HWP5 와 HWPX 를 헤더만 보고 가른다', async () => {
  assert.equal(sniffHwp(await 합성문서()).format, 'hwp5')
  assert.equal(sniffHwp(await 합성HWPX()).format, 'hwpx')
})

test('한글 문서가 아니면 unknown 이다', () => {
  assert.equal(sniffHwp(new Uint8Array([1, 2, 3, 4])).format, 'unknown')
  assert.equal(sniffHwp(new TextEncoder().encode('%PDF-1.7\n')).format, 'unknown')
  // ZIP 이지만 한글 문서가 아닌 것(docx 등)도 걸러진다
  assert.equal(sniffHwp(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])).format, 'unknown')
})

test('배포용 비트를 켜면 판별된다', async () => {
  const hwp = await 합성문서()
  assert.equal(sniffHwp(hwp).distribution, false)
  assert.equal(sniffHwp(배포용으로(hwp)).distribution, true)
})

// ── 배포용 거절 ──────────────────────────────────────────────

test('배포용 문서는 파싱을 시도하지 않고 사유를 돌려준다', async () => {
  const hwp = await 합성문서()
  const 깨진배포용 = 배포용으로(hwp).slice(0, 2048)  // 뒤를 잘라 파싱 자체는 불가능하게 만든다

  const r = await parseHwp(깨진배포용, { fileId: 'f-drm' })
  assert.equal(r.ok, false)
  // 파싱을 시도했다면 parse_failed 가 나온다. drm_distribution 이라는 것이 «시도 안 함»의 증거다
  assert.equal(r.ok === false && r.reason, 'drm_distribution')
})

test('열 수 없는 형식은 파싱 전에 거절한다', async () => {
  const r = await parseHwp(new Uint8Array([1, 2, 3, 4, 5]), { fileId: 'f-x' })
  assert.equal(r.ok === false && r.reason, 'unsupported_format')
})

test('거절은 예외가 아니라 값이다', async () => {
  // 인입 큐가 사유별로 다르게 처리해야 한다. 예외 메시지 문자열 비교는 곧 틀린다
  await assert.doesNotReject(() => parseHwp(new Uint8Array([0]), { fileId: 'f' }))
})

// ── 합성 문서 파싱 ───────────────────────────────────────────

test('합성 HWP 의 문단 수와 표 수와 텍스트 해시가 기대값과 같다', async () => {
  const hwp = await 합성문서()
  const r = await parseHwp(hwp, { fileId: 'f-1', fileRole: 'rfp_main' })
  assert.ok(r.ok, r.ok === false ? `${r.reason} ${r.detail}` : '')
  if (!r.ok) return

  const paras = r.doc.blocks.filter((b) => b.type === 'paragraph')
  const tableBlocks = r.doc.blocks.filter((b) => b.type === 'table')

  assert.equal(paras.length, 2, '본문 문단 수가 다르다')
  assert.equal(tableBlocks.length, 1, '표 수가 다르다')
  assert.equal(r.doc.tables.length, 1)

  // 문단 순서가 원문 순서다 — 뒤섞이면 근거 인용이 엉뚱한 문장을 가리킨다
  assert.deepEqual(paras.map((b) => b.text), [본문, 제목])
  assert.equal(paras[0].textHash, textHash(본문))
  assert.equal(paras[1].textHash, textHash(제목))

  const t = r.doc.tables[0]
  assert.equal(t.rows, 2)
  assert.equal(t.cols, 3)
  assert.equal(t.cells.length, 6)
  assert.equal(t.cells[0].text, '항목')
  assert.equal(t.blockId, tableBlocks[0].blockId, '표가 자기 블록을 안 가리킨다')
})

test('표 블록은 평문에 셀 경계를 남기고 HTML 도 함께 남긴다', async () => {
  const hwp = await 합성문서()
  const r = await parseHwp(hwp, { fileId: 'f-2' })
  assert.ok(r.ok)
  if (!r.ok) return

  const t = r.doc.blocks.find((b) => b.type === 'table')!
  // 평문만 남기면 셀 경계가 사라져 표가 아니게 된다
  assert.match(t.text, /항목\t/)
  assert.match(t.html ?? '', /^<table><tr><td>항목<\/td>/)
})

test('HWPX 도 같은 경로로 읽힌다', async () => {
  const r = await parseHwp(await 합성HWPX(), { fileId: 'f-3' })
  assert.ok(r.ok, r.ok === false ? `${r.reason} ${r.detail}` : '')
  if (!r.ok) return
  assert.equal(r.doc.meta.format, 'hwpx')
  assert.ok(r.doc.blocks.length > 0, 'HWPX 에서 블록을 하나도 못 만들었다')
})

// ── 근거 좌표 ────────────────────────────────────────────────

test('source_ref 에 구역과 문단 번호가 실린다', async () => {
  const hwp = await 합성문서()
  const r = await parseHwp(hwp, { fileId: 'f-4' })
  assert.ok(r.ok)
  if (!r.ok) return

  for (const b of r.doc.blocks) {
    assert.equal(b.sourceRef.kind, 'hwp')
    assert.ok(b.sourceRef.kind === 'hwp' && Number.isInteger(b.sourceRef.sectionIdx))
    assert.ok(b.sourceRef.kind === 'hwp' && Number.isInteger(b.sourceRef.paraIdx))
  }
})

test('쪽 번호는 달지 않고 근사라는 사실을 경고로 남긴다', async () => {
  const hwp = await 합성문서()
  const r = await parseHwp(hwp, { fileId: 'f-5' })
  assert.ok(r.ok)
  if (!r.ok) return

  // 「3쪽에 있다」고 적어 두면 한컴 뷰어에서 못 찾는 일이 생긴다
  for (const b of r.doc.blocks) assert.equal(b.pageNo, null, '쪽 번호를 달았다')
  assert.ok(r.doc.meta.warnings.includes(HWP_WARNING.pageNoApproximate))
})

test('meta 에 파서 이름과 판이 남는다', async () => {
  const hwp = await 합성문서()
  const r = await parseHwp(hwp, { fileId: 'f-6', fileRole: 'rfp_main' })
  assert.ok(r.ok)
  if (!r.ok) return
  // 어느 파서가 읽었는지 모르면 나중에 재파싱 대상을 못 고른다
  assert.equal(r.doc.meta.parser, HWP_PARSER)
  assert.equal(r.doc.meta.parserVersion, HWP_PARSER_VERSION)
  assert.equal(r.doc.meta.fileRole, 'rfp_main')
  assert.ok(r.doc.meta.qualityScore > 0 && r.doc.meta.qualityScore <= 100)
})

test('같은 파일을 두 번 파싱하면 블록 ID 가 같다', async () => {
  const hwp = await 합성문서()
  const a = await parseHwp(hwp, { fileId: 'same' })
  const b = await parseHwp(hwp, { fileId: 'same' })
  assert.ok(a.ok && b.ok)
  if (!a.ok || !b.ok) return
  // 재파싱으로 ID 가 바뀌면 지난 리포트의 근거 링크가 통째로 끊긴다
  assert.deepEqual(a.doc.blocks.map((x) => x.blockId), b.doc.blocks.map((x) => x.blockId))
})
