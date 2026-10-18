// 계약서 종이와 내보내기 (P0132 I12)
//
// 지키는 것 넷
// - 종이 HTML 과 docx 의 조항 글이 같다 (docx 는 풀어서 대조한다, 만든 객체를 믿지 않는다)
// - 같은 버전은 같은 종이, 버전 번호를 주면 그 버전으로 굽는다
// - 굽는 HTML 에 스크립트가 못 낀다, 칸 값은 escape 된다
// - PDF 는 render-document 한 자리를 지나고, 종이 글꼴 이름이 그 자리가 얹는 자형 이름과 같다
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { Packer } from 'docx'

import {
  buildContractDocx, clauseBlocks, contractFileName, contractPaperHtml, contractPaperInnerHtml,
  CONTRACT_PAPER_CSS, type ContractPaperInput,
} from './contract-paper.ts'
import { stripTags } from './contract-body.ts'
import { EXPORT_FONT_FAMILY } from '../../export/font-subset.ts'
import { loadContractPaper, parseExportFormat, parseVersionNo } from '../services/contract-export.ts'
import { CrmError } from './errors.ts'

const ROOT = process.cwd()

function paper(over: Partial<ContractPaperInput> = {}): ContractPaperInput {
  return {
    contractNo: 'CT-2026-0001',
    title: 'GPU 서버 공급 계약서',
    versionNo: 2,
    clauses: [
      { id: 'c1', title: '제1조 (목적)', html: '<p>을은 갑에게 GPU 서버를 공급한다.</p>' },
      {
        id: 'c2', title: '제2조 (대금)',
        html: '<p>총액은 34,980,000원이다.</p><table><tr><th>품목</th><th>금액</th></tr><tr><td>H100 &amp; NVL</td><td>34,980,000</td></tr></table><ul><li>선금 30%</li><li>잔금 70%</li></ul>',
      },
    ],
    fieldValues: {
      'supplier.name': { value: '도코어', source: 'auto' },
      'customer.name': { value: '<b>고객</b>사', source: 'manual' },
      'contract.date': { value: '2026년 10월 19일', source: 'manual' },
    },
    signature: null,
    ...over,
  }
}

/** zip 한 벌에서 이름이 같은 항목 하나를 푼다 — 의존을 늘리지 않으려고 중앙 디렉터리를 직접 읽는다 */
function unzipEntry(zip: Buffer, name: string): string {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  assert.ok(eocd >= 0, 'zip 끝 표지가 없습니다')
  let p = zip.readUInt32LE(eocd + 16)
  const count = zip.readUInt16LE(eocd + 10)
  for (let i = 0; i < count; i += 1) {
    const method = zip.readUInt16LE(p + 10)
    const size = zip.readUInt32LE(p + 20)
    const nameLen = zip.readUInt16LE(p + 28)
    const extraLen = zip.readUInt16LE(p + 30)
    const commentLen = zip.readUInt16LE(p + 32)
    const local = zip.readUInt32LE(p + 42)
    const entry = zip.subarray(p + 46, p + 46 + nameLen).toString('utf8')
    if (entry === name) {
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
      const raw = zip.subarray(start, start + size)
      return (method === 0 ? raw : inflateRawSync(raw)).toString('utf8')
    }
    p += 46 + nameLen + extraLen + commentLen
  }
  throw new Error(`zip 안에 ${name} 이 없습니다`)
}

/** docx 본문의 문단과 칸 글을 순서대로 */
function docxTexts(xml: string): string[] {
  return [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)]
    .map((m) => [...m[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join(''))
    .map((s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"'))
    .filter((s) => s.trim() !== '')
}

test('docx 를 풀면 조항 제목과 글과 표 칸이 종이와 같은 순서로 들어 있다', async () => {
  const input = paper()
  const buf = await Packer.toBuffer(buildContractDocx(input))
  const texts = docxTexts(unzipEntry(Buffer.from(buf), 'word/document.xml'))

  const expected: string[] = []
  for (const cl of input.clauses) {
    expected.push(stripTags(cl.title))
    for (const b of clauseBlocks(cl.html)) {
      if (b.type === 'p') expected.push(b.text)
      else for (const row of b.rows) expected.push(...row)
    }
  }
  let at = 0
  for (const want of expected) {
    const i = texts.indexOf(want, at)
    assert.ok(i >= 0, `docx 에 「${want}」 가 없거나 순서가 다릅니다`)
    at = i + 1
  }
  // 값이 실제로 나오는지 — 빈 기대로 초록이 되지 않게
  assert.ok(texts.includes('H100 & NVL'), '표 칸의 엔티티가 풀리지 않았습니다')
  assert.ok(texts.includes('- 선금 30%'))
  assert.ok(texts.some((t) => t.includes('CT-2026-0001') && t.includes('2')), '꼬리에 계약서 번호와 버전이 없습니다')
})

test('종이 HTML 의 조항 글과 docx 문단이 같은 글이다 — 미리보기와 파일이 갈라지지 않는다', () => {
  const input = paper()
  const html = contractPaperInnerHtml(input)
  for (const cl of input.clauses) {
    for (const b of clauseBlocks(cl.html)) {
      const words = b.type === 'p' ? [b.text.replace(/^- /, '')] : b.rows.flat()
      for (const w of words) assert.ok(stripTags(html).replace(/&amp;/g, '&').includes(w), `종이에 「${w}」 가 없습니다`)
    }
  }
})

test('표는 글로 뭉개지지 않고 줄과 칸으로 남는다', () => {
  const blocks = clauseBlocks(paper().clauses[1].html)
  const table = blocks.find((b) => b.type === 'table')
  assert.deepEqual(table, { type: 'table', rows: [['품목', '금액'], ['H100 & NVL', '34,980,000']] })
})

test('같은 재료는 같은 종이다', () => {
  assert.equal(contractPaperHtml(paper()), contractPaperHtml(paper()))
  assert.notEqual(contractPaperHtml(paper()), contractPaperHtml(paper({ versionNo: 3 })))
})

test('굽는 HTML 에 스크립트와 이벤트가 못 끼고 칸 값은 escape 된다', () => {
  const html = contractPaperHtml(paper({
    title: '<img src=x onerror=alert(1)>',
    clauses: [{ id: 'x', title: '제1조', html: '<p onclick="x()">글</p><script>alert(1)</script><iframe src="//e"></iframe>' }],
  }))
  assert.doesNotMatch(html, /<script/i)
  assert.doesNotMatch(html, /<iframe/i)
  assert.doesNotMatch(html, /<[^>]*\son(click|error)\s*=/i, '태그에 이벤트 속성이 남았습니다')
  assert.match(html, /&lt;img src=x/)
  assert.match(html, /&lt;b&gt;고객&lt;\/b&gt;사/, '서명란 칸 값이 escape 되지 않았습니다')
})

test('종이 글꼴은 굽는 자리가 얹는 자형 이름을 쓴다 — 다르면 자형이 실려도 한 글자도 안 쓰인다', () => {
  assert.ok(CONTRACT_PAPER_CSS.includes(EXPORT_FONT_FAMILY), `종이 CSS 에 ${EXPORT_FONT_FAMILY} 가 없습니다`)
  assert.ok(contractPaperHtml(paper()).includes(EXPORT_FONT_FAMILY))
})

test('PDF 는 render-document 한 자리를 지난다', () => {
  const src = readFileSync(join(ROOT, 'lib/crm/services/contract-export.ts'), 'utf8')
  assert.match(src, /import\('..\/..\/export\/render-document\.ts'\)/)
  assert.match(src, /renderDocument\(\{ html: contractPaperHtml\(paper\)/, 'PDF 가 종이 HTML 로 굽히지 않습니다')
  assert.doesNotMatch(src, /puppeteer/, '계약서가 직접 굽고 있습니다')
})

// ------------------------------------------------------------
// 버전 고르기
// ------------------------------------------------------------

function fakeDb() {
  const versions = [1, 2, 3].map((n) => ({
    versionNo: n, kind: 'EDITED', body: [{ id: 'c1', title: '제1조', html: `<p>버전 ${n} 글</p>` }],
    fieldValues: {}, quoteSnapshot: null, signatureSnapshot: n === 1 ? null : { partyA: '공급자', partyB: '고객', mark: 'sign', showCeo: false },
  }))
  return {
    crmContract: {
      findFirst: async ({ where }: { where: { id: string } }) => where.id === 'k1'
        ? { id: 'k1', contractNo: 'CT-1', title: '계약', currentVersionNo: 3, totalMinor: null }
        : null,
    },
    crmContractVersion: {
      findFirst: async ({ where }: { where: { versionNo: number } }) => versions.find((v) => v.versionNo === where.versionNo) ?? null,
    },
  }
}

test('버전을 안 주면 지금 버전, 주면 그 버전으로 굽는다', async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = fakeDb() as any
  const now = await loadContractPaper(db, 'k1', null)
  assert.equal(now.versionNo, 3)
  assert.match(contractPaperInnerHtml(now), /버전 3 글/)
  const old = await loadContractPaper(db, 'k1', 1)
  assert.equal(old.versionNo, 1)
  assert.match(contractPaperInnerHtml(old), /버전 1 글/)
  assert.equal(old.signature, null)
  assert.equal(now.signature?.mark, 'sign')
  await assert.rejects(loadContractPaper(db, 'k1', 9), (e) => e instanceof CrmError && e.code === 'NOT_FOUND')
})

test('버전과 형식 값이 틀리면 조용히 지금 버전으로 굽지 않고 막는다', () => {
  assert.equal(parseVersionNo(null), null)
  assert.equal(parseVersionNo(''), null)
  assert.equal(parseVersionNo('2'), 2)
  for (const bad of ['0', '-1', '1.5', 'abc']) assert.throws(() => parseVersionNo(bad), CrmError)
  assert.equal(parseExportFormat('docx'), 'docx')
  for (const bad of [null, 'xlsx', 'PDF']) assert.throws(() => parseExportFormat(bad), CrmError)
})

test('파일 이름에 경로 문자가 안 남는다', () => {
  assert.equal(contractFileName({ contractNo: 'CT/2026 01', versionNo: 2 }, 'pdf'), 'CT_2026_01_계약서_버전2.pdf')
})

test('내보내기 창구는 멤버 확인 뒤에 내보내기 권한을 따로 묻는다', () => {
  const src = readFileSync(join(ROOT, 'app/api/crm/contracts/[id]/export/route.ts'), 'utf8')
  assert.match(src, /withCrmApi\('MEMBER'/)
  assert.ok(src.indexOf('canExport(') > src.indexOf("withCrmApi('MEMBER'"), '권한 확인이 창구 안에 없습니다')
  assert.ok(src.indexOf('canExport(') < src.indexOf('exportContract('), '권한 확인 전에 굽고 있습니다')
})
