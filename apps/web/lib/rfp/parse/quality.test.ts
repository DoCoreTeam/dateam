/**
 * 파서 라우터와 품질 점수 가드 (설계서 3.3.4)
 *
 * 여기서 잠그는 것 셋
 * - 확장자만 hwp 인 PDF 를 거부하는가 (조용히 고쳐 쓰면 그 파일이 왜 그런지 아무도 안 본다)
 * - 점수 산식이 다섯 신호를 다 쓰고 60 에서 경고가 서는가
 * - 1순위가 실패하면 폴백으로 넘어가고 «누가 읽었는지» 가 남는가
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  detectKind, kindOfExtension, checkKind, scoreQuality, isLowQuality, QUALITY_WARN_BELOW,
} from './quality.ts'
import { parseFile } from './index.ts'
import { initHwpEngine } from './hwp.ts'

const 글 = (s: string) => new TextEncoder().encode(s)

async function 합성HWP(): Promise<Uint8Array> {
  const mod = await initHwpEngine()
  const d = mod.HwpDocument.createEmpty()
  try {
    d.insertText(0, 0, 0, '제1장 사업개요')
    return d.exportHwp()
  } finally {
    d.free()
  }
}

async function 합성PDF(): Promise<Uint8Array> {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF()
  pdf.text('Chapter 1 Overview of the project scope and duration here', 20, 20)
  return new Uint8Array(pdf.output('arraybuffer'))
}

// 종류 판별

test('앞머리 바이트로 실제 종류를 읽는다', async () => {
  assert.equal(detectKind(await 합성PDF()), 'pdf')
  assert.equal(detectKind(await 합성HWP()), 'hwp')
  assert.equal(detectKind(글('그냥 글자 파일이다')), 'text')
  assert.equal(detectKind(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), 'image')
  assert.equal(detectKind(new Uint8Array([1, 2])), 'unknown')
})

test('확장자가 가리키는 종류를 읽는다', () => {
  assert.equal(kindOfExtension('a.hwp'), 'hwp')
  assert.equal(kindOfExtension('a.HWPX'), 'hwpx')
  assert.equal(kindOfExtension('a.docx'), 'ooxml')
  assert.equal(kindOfExtension('이름없음'), 'unknown')
})

test('확장자만 hwp 인 PDF 는 거부한다', async () => {
  const r = checkKind('제안요청서.hwp', await 합성PDF())
  // 조용히 고쳐 쓰면 그 파일이 왜 그런 모양인지 아무도 안 본다
  assert.equal(r.ok, false)
  assert.equal(r.ok === false && r.reason, 'extension_mismatch')
  assert.equal(r.ok === false && r.declared, 'hwp')
  assert.equal(r.ok === false && r.actual, 'pdf')
})

test('같은 계열은 통과시킨다', async () => {
  const mod = await initHwpEngine()
  const d = mod.HwpDocument.createEmpty()
  d.insertText(0, 0, 0, 'ㄱ')
  const hwpx = d.exportHwpx()
  d.free()
  // hwp 라 적힌 hwpx 는 같은 계열이라 문제가 아니다
  assert.equal(checkKind('과업내용서.hwp', hwpx).ok, true)
})

test('확장자가 없으면 내용을 따른다', async () => {
  const r = checkKind('이름없음', await 합성PDF())
  assert.equal(r.ok, true)
  assert.equal(r.ok === true && r.kind, 'pdf')
})

test('무엇인지 모르면 거부한다', () => {
  const r = checkKind('a.hwp', new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05]))
  assert.equal(r.ok === false && r.reason, 'unknown_kind')
})

// 품질 점수

test('다섯 신호가 모두 점수를 움직인다', () => {
  const base = { textPageRatio: 0.5, tableCount: 2, avgOcrConfidence: 0.5, sectionDepth: 2, warningCount: 1 }
  const 기준 = scoreQuality(base)
  assert.notEqual(scoreQuality({ ...base, textPageRatio: 1 }), 기준)
  assert.notEqual(scoreQuality({ ...base, tableCount: 5 }), 기준)
  assert.notEqual(scoreQuality({ ...base, avgOcrConfidence: 1 }), 기준)
  assert.notEqual(scoreQuality({ ...base, sectionDepth: 3 }), 기준)
  assert.notEqual(scoreQuality({ ...base, warningCount: 3 }), 기준)
})

test('글자를 못 건지면 나머지가 좋아도 낮다', () => {
  // 나머지가 다 좋아도 글자가 없으면 리포트를 못 쓴다
  const s = scoreQuality({ textPageRatio: 0, tableCount: 9, avgOcrConfidence: 1, sectionDepth: 4, warningCount: 0 })
  assert.ok(isLowQuality(s), `점수가 ${s} 라 경고를 안 띄운다`)
})

test('제대로 읽힌 문서는 경고를 안 띄운다', () => {
  const s = scoreQuality({ textPageRatio: 1, tableCount: 4, avgOcrConfidence: null, sectionDepth: 3, warningCount: 0 })
  assert.ok(s >= QUALITY_WARN_BELOW, `점수가 ${s} 다`)
})

test('경고 임계값은 60 이다', () => {
  assert.equal(QUALITY_WARN_BELOW, 60)
  assert.equal(isLowQuality(60), false)
  assert.equal(isLowQuality(59), true)
})

test('점수는 0~100 을 벗어나지 않는다', () => {
  assert.equal(scoreQuality({ textPageRatio: 9, tableCount: 99, avgOcrConfidence: 9, sectionDepth: 99, warningCount: 0 }), 100)
  assert.equal(scoreQuality({ textPageRatio: -1, tableCount: -1, avgOcrConfidence: -1, sectionDepth: -1, warningCount: 99 }), 0)
  assert.equal(scoreQuality({ textPageRatio: NaN, tableCount: 0, avgOcrConfidence: null, sectionDepth: 1, warningCount: 0 }), 10)
})

test('기계가 읽은 블록이 없으면 그 항목은 만점이다', () => {
  const base = { textPageRatio: 1, tableCount: 0, sectionDepth: 1, warningCount: 0 }
  // 사람이 쓴 글은 흔들림이 없다. 없는 것을 0점으로 두면 정상 문서가 손해를 본다
  assert.ok(scoreQuality({ ...base, avgOcrConfidence: null }) > scoreQuality({ ...base, avgOcrConfidence: 0.5 }))
})

// 라우터

test('한글 문서는 한글 파서가 읽고 그 이름이 meta 에 남는다', async () => {
  const r = await parseFile({ fileId: 'f1', fileName: '제안요청서.hwp', bytes: await 합성HWP() })
  assert.ok(r.ok, r.ok === false ? `${r.reason} ${r.detail}` : '')
  if (!r.ok) return
  // 파서를 올렸을 때 무엇을 다시 읽어야 하는지는 이 값으로만 안다
  assert.equal(r.doc.meta.parser, 'rhwp')
  assert.ok(r.doc.meta.parserVersion.length > 0)
  assert.deepEqual(r.attempts, [{ parser: 'rhwp', ok: true, reason: null }])
})

test('PDF 는 오피스 파서가 읽는다', async () => {
  const r = await parseFile({ fileId: 'f2', fileName: '공고문.pdf', bytes: await 합성PDF() })
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(r.doc.meta.parser, 'officeparser')
  assert.equal(r.doc.meta.format, 'pdf')
})

test('1순위가 실패하면 폴백 파서로 넘어간다', async () => {
  // HWPX 는 ZIP+XML 이라 한글 파서가 못 열어도 오피스 파서가 글자는 건진다.
  // 여기서는 한글 파서가 여는 정상 HWPX 라 1순위에서 끝나야 한다
  const mod = await initHwpEngine()
  const d = mod.HwpDocument.createEmpty()
  d.insertText(0, 0, 0, '제1장 사업개요')
  const hwpx = d.exportHwpx()
  d.free()

  const r = await parseFile({ fileId: 'f3', fileName: '과업내용서.hwpx', bytes: hwpx })
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(r.attempts.length, 1)
  assert.equal(r.attempts[0].parser, 'rhwp')
})

test('시도한 파서와 실패 사유가 남는다', async () => {
  // 배포용 비트를 켠 문서 — 한글 파서가 열기 전에 거절한다
  const bytes = Buffer.from(await 합성HWP())
  const at = bytes.indexOf(Buffer.from('HWP Document File', 'latin1'))
  bytes.writeUInt32LE(bytes.readUInt32LE(at + 36) | 0x04, at + 36)

  const r = await parseFile({ fileId: 'f4', fileName: '제안요청서.hwp', bytes: new Uint8Array(bytes) })
  assert.equal(r.ok, false)
  assert.equal(r.ok === false && r.reason, 'drm_distribution')
  // 「파싱 실패」 한 마디로는 사용자가 다음에 무엇을 해야 할지 모른다
  assert.deepEqual(r.attempts, [{ parser: 'rhwp', ok: false, reason: 'drm_distribution' }])
})

test('종류가 안 맞으면 파서를 아예 안 부른다', async () => {
  const r = await parseFile({ fileId: 'f5', fileName: '제안요청서.hwp', bytes: await 합성PDF() })
  assert.equal(r.ok === false && r.reason, 'extension_mismatch')
  assert.deepEqual(r.attempts, [], '거부해 놓고 파서를 불렀다')
})

test('맡을 파서가 없는 종류는 그렇게 말한다', async () => {
  const r = await parseFile({ fileId: 'f6', fileName: '도장.png', bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]) })
  assert.equal(r.ok === false && r.reason, 'no_parser')
})
