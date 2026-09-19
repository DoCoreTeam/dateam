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

/* ── 세로줄 표 ───────────────────────────────────── */

const MD = [
  '견적서',
  '',
  '| 품명 | 수량 | 단가 |',
  '| --- | ---: | :--- |',
  '| H100 | 2 | 100,000,000 |',
  '| 설치 및 셋업 | 1 | 10,000,000 |',
  '',
  '합계 210,000,000 원',
].join('\n')

test('★ 마크다운 표가 표로 읽힌다 — 구분줄은 표에 안 들어간다', () => {
  const r = parsePlain(enc(MD), { fileId: 'f1', fileName: 'a.md' })
  assert.equal(r.ok, true)
  if (!r.ok) return

  assert.equal(r.doc.tables.length, 1, '표를 못 찾았다')
  const t = r.doc.tables[0]
  assert.equal(t.rows, 3, '머리 1 + 본문 2 가 아니다 (구분줄이 섞였는지 본다)')
  assert.equal(t.cols, 3)
  assert.deepEqual(
    t.cells.filter((c) => c.r === 0).map((c) => c.text),
    ['품명', '수량', '단가'],
    '셀 앞뒤 공백이 안 지워졌다',
  )
  assert.ok(!t.cells.some((c) => c.text.includes('---')), '구분줄이 표 안에 들어갔다')

  // 표 앞뒤 글은 순서를 지켜 문단으로 남는다
  const types = r.doc.blocks.map((b) => b.type)
  assert.deepEqual(types, ['paragraph', 'table', 'paragraph'])
  assert.equal(r.doc.blocks[0].text, '견적서')
  assert.match(r.doc.blocks[2].text, /합계 210,000,000/)
})

test('★ 구분줄이 없으면 표가 아니다 — 「3 | 4호기」 같은 글을 표로 만들지 않는다', () => {
  const r = parsePlain(enc('설비는 3 | 4호기에 있습니다\n다음 줄 | 도 세로줄'), {
    fileId: 'f1', fileName: 'a.md',
  })
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.doc.tables.length, 0, '세로줄만 보고 표를 만들었다')
  assert.ok(r.doc.blocks.every((b) => b.type === 'paragraph'))
})

test('셀 안의 세로줄(\\|)은 살아남는다 — 잘라 버리면 열이 하나 늘어난다', () => {
  const md = '| 품명 | 비고 |\n| --- | --- |\n| A\\|B | 병기 |'
  const r = parsePlain(enc(md), { fileId: 'f1', fileName: 'a.md' })
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.doc.tables[0].cols, 2, '셀 안 세로줄에서 잘렸다')
  assert.equal(r.doc.tables[0].cells.find((c) => c.r === 1 && c.c === 0)?.text, 'A|B')
})

test('코드 울타리 안의 표는 표가 아니다 — 예제를 값으로 읽으면 안 된다', () => {
  const md = '```\n| a | b |\n| --- | --- |\n| 1 | 2 |\n```\n밖의 글'
  const r = parsePlain(enc(md), { fileId: 'f1', fileName: 'a.md' })
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.doc.tables.length, 0)
})

test('표가 둘이면 둘로 갈린다 — 한 덩이로 묶으면 머리줄이 값이 된다', () => {
  const md = '| a | b |\n| --- | --- |\n| 1 | 2 |\n\n| c | d |\n| --- | --- |\n| 3 | 4 |'
  const r = parsePlain(enc(md), { fileId: 'f1', fileName: 'a.md' })
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.doc.tables.length, 2)
  assert.equal(r.doc.blocks.filter((b) => b.type === 'table').length, 2)
})

test('표를 알아보면 품질 점수에 실린다 — 0 으로 굳어 있던 값', () => {
  const withTable = parsePlain(enc(MD), { fileId: 'f1', fileName: 'a.md' })
  const without = parsePlain(enc('견적서\n\n합계 210,000,000 원'), { fileId: 'f1', fileName: 'a.md' })
  assert.equal(withTable.ok && without.ok, true)
  if (!withTable.ok || !without.ok) return
  assert.ok(
    withTable.doc.meta.qualityScore > without.doc.meta.qualityScore,
    `표가 있는 문서 점수 ${withTable.doc.meta.qualityScore} 가 없는 문서 ${without.doc.meta.qualityScore} 보다 높지 않다`,
  )
})

test('표 블록에도 저마다 다른 ID 가 붙는다 — 같으면 근거가 서로를 덮는다', () => {
  const md = '| a | b |\n| --- | --- |\n| 1 | 2 |\n\n| c | d |\n| --- | --- |\n| 3 | 4 |'
  const r = parsePlain(enc(md), { fileId: 'f1', fileName: 'a.md' })
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(new Set(r.doc.blocks.map((b) => b.blockId)).size, r.doc.blocks.length)
  assert.equal(new Set(r.doc.tables.map((t) => t.tableId)).size, r.doc.tables.length)
})
