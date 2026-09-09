import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsePlain, decodeText, stripHtml, toParagraphs } from './plain.ts'
import { parseFile } from './index.ts'

const enc = (s: string) => new TextEncoder().encode(s)

test('평문 공고문이 실제로 읽힌다 — 예전에는 unsupported_format 으로 죽었다', async () => {
  const r = await parseFile({
    fileId: 'f1',
    fileName: '공고문.txt',
    bytes: enc('제1장 사업 개요\n\n사업명: 차세대 플랫폼\n\n예산: 12억원'),
  })
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.doc.blocks.length, 3)
    assert.equal(r.doc.meta.parser, 'plain')
  }
})

test('빈 줄로 문단을 나눈다', () => {
  assert.deepEqual(toParagraphs('가\n\n나\n\n다'), ['가', '나', '다'])
})

test('문단이 없으면 줄로 나눈다 — 한 덩이로 두면 근거를 못 가리킨다', () => {
  assert.deepEqual(toParagraphs('첫 줄\n둘째 줄\n셋째 줄'), ['첫 줄', '둘째 줄', '셋째 줄'])
})

test('UTF-8 을 그대로 읽는다', () => {
  assert.equal(decodeText(enc('한글 공고문')), '한글 공고문')
})

test('EUC-KR 도 읽는다 — 공공기관 파일에 아직 섞여 있다', () => {
  // '한글' 의 EUC-KR 바이트
  const euckr = new Uint8Array([0xc7, 0xd1, 0xb1, 0xdb])
  assert.equal(decodeText(euckr), '한글')
})

test('HTML 태그를 벗긴다 — 마크업이 근거로 남으면 안 된다', () => {
  const html = '<html><body><p>사업명: 플랫폼</p><p>예산: 12억</p><script>var x=1</script></body></html>'
  const text = stripHtml(html)
  assert.equal(text.includes('<p>'), false)
  assert.equal(text.includes('var x=1'), false)
  assert.ok(text.includes('사업명: 플랫폼'))
})

test('HTML 파일은 태그를 벗기고 문단으로 만든다', () => {
  const r = parsePlain(enc('<html><body><p>사업명: 플랫폼</p><p>예산: 12억</p></body></html>'), {
    fileId: 'f1', fileName: '공고.html',
  })
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.doc.meta.format, 'html')
    assert.ok(r.doc.blocks.some((b) => b.text.includes('사업명')))
  }
})

test('글자가 없으면 실패다 — 빈 문서를 성공으로 두면 리포트가 비어 나온다', () => {
  const r = parsePlain(enc('   \n\n  '), { fileId: 'f1', fileName: 'a.txt' })
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.reason, 'empty')
})

test('평문은 품질 감점이 없다 — 표·좌표가 없는 것은 형식의 성질이다', () => {
  const r = parsePlain(enc('가\n\n나'), { fileId: 'f1', fileName: 'a.txt' })
  assert.equal(r.ok, true)
  if (r.ok) assert.ok(r.doc.meta.qualityScore >= 60, String(r.doc.meta.qualityScore))
})

test('블록마다 다른 ID 를 준다 — 같으면 근거가 서로를 덮는다', () => {
  const r = parsePlain(enc('가\n\n나\n\n다'), { fileId: 'f1', fileName: 'a.txt' })
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(new Set(r.doc.blocks.map((b) => b.blockId)).size, 3)
})
