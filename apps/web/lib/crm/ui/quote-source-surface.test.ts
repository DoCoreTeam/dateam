/**
 * 출처와 대조가 화면에서 조용히 사라지지 않게 한다
 *
 * **왜**: 파일에서 읽은 견적의 출처(`sourceFileName`)는 2026-09-14 부터 DB 에 들어가 있었는데
 *   **화면이 한 번도 안 읽었다.** 값은 있고 서버도 주는데 그리는 자리가 없어서,
 *   사용자에게는 그 기능이 처음부터 없는 것과 똑같았다
 *   (사용자 지적 2026-09-20: 「원본 캡쳐되어서 대조 할 수 있는 기능이 안보이는데」).
 *
 *   이런 결함은 타입 검사도 단위 시험도 못 잡는다 — 코드는 다 맞고 부르지만 않는다.
 *   그래서 **부르는 자리**를 여기서 붙잡는다.
 *
 * **이름만 찾지 않는다**: `includes('QuoteOriginalCompare')` 는 import 만 남아도 통과하고,
 *   `includes('quoteId')` 는 선언만 남아도 통과한다. 여는 꺾쇠부터 닫는 자리까지 잘라 내
 *   **그 안에 값이 실제로 넘어가는지** 본다.
 *
 * 검사 여섯:
 *   1) 서버가 출처를 문서 «곁»에 싣는다 (문서 안에 넣으면 종이에 찍힌다)
 *   2) 화면이 그 값을 받아 파일 이름을 그린다
 *   3) 대조 부품에 견적 id·견적서·원본 유무 콜백이 «값으로» 넘어간다
 *   4) 출처 줄은 화면 전용이라 인쇄에서 빠진다
 *   5) 대조 오버레이도 인쇄에서 빠진다
 *   6) 원본 고르기 규칙이 실제로 그렇게 고른다 (값이 나오는 단정)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pickOriginal, drawKindOf, pdfViewerHash } from './quote-original.ts'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

const VIEW = join(WEB, 'app/(crm)/crm/quotes/[id]/QuoteDocumentView.tsx')
const VIEW_CSS = join(WEB, 'app/(crm)/crm/quotes/[id]/quote-document.module.css')
const COMPARE_CSS = join(WEB, 'components/ui/crm/quote-original-compare.module.css')
const SERVICE = join(WEB, 'lib/crm/services/quote-document.ts')

function read(path: string): string {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.length > 500, `${path} 를 못 읽었다 — 검사가 헛돈다`)
  return src
}

/**
 * `<Tag ... />` 한 덩어리를 통째로 잘라 낸다.
 *
 * 중괄호를 세면서 나아간다 — prop 값 안에 또 JSX 가 들어 있어(`sheet={<QuoteSheet ... />}`)
 * 처음 만나는 `/>` 에서 끊으면 **안쪽 부품의 닫는 자리**에서 잘린다.
 */
function elementOf(src: string, tag: string): string {
  const start = src.indexOf(`<${tag}`)
  assert.notEqual(start, -1, `${tag} 를 그리는 자리가 없다`)
  let depth = 0
  for (let i = start; i < src.length; i += 1) {
    const c = src[i]
    if (c === '{') depth += 1
    else if (c === '}') depth -= 1
    else if (depth === 0 && c === '/' && src[i + 1] === '>') return src.slice(start, i + 2)
    else if (depth === 0 && c === '>' && src[i - 1] !== '=') return src.slice(start, i + 1)
  }
  assert.fail(`${tag} 의 닫는 자리를 못 찾았다`)
}

test('서버는 출처를 문서 곁에 싣는다 — 문서 «안»이 아니다', () => {
  const src = read(SERVICE)
  /*
    `source:` 가 응답에 있고, 그 값이 견적의 파일 이름에서 온다.
    상수를 박아 두거나 빈 값을 넘기면 화면은 늘 「출처 없음」이 된다.
  */
  assert.match(src, /source:\s*quote\.sourceFileName/, '응답의 source 가 견적의 파일 이름을 안 읽는다')
  assert.match(src, /fileName:\s*quote\.sourceFileName/, 'source.fileName 에 실제 파일 이름이 안 들어간다')
  assert.match(src, /fromFileAt:\s*quote\.fromFileAt/, 'source.fromFileAt 에 실제 시각이 안 들어간다')

  // 문서(QuoteDocument)를 만드는 입력에는 안 들어가야 한다 — 들어가면 고객 종이에 찍힌다
  const build = src.slice(src.indexOf('buildQuoteDocument({'), src.indexOf('return {'))
  assert.ok(build.length > 200, 'buildQuoteDocument 호출을 못 잘랐다 — 검사가 헛돈다')
  assert.ok(
    !build.includes('sourceFileName') && !build.includes('fromFileAt'),
    '출처가 고객이 받는 문서 안으로 들어갔다 — 종이에 우리 저장소 사정이 찍힌다',
  )
})

test('견적 화면이 출처 값을 받아 파일 이름을 그린다', () => {
  const src = read(VIEW)
  assert.match(src, /source:\s*\{\s*fileName:\s*string/, '응답 형에 source 가 없다')
  // 조건과 값이 한 벌이다. 조건만 있고 값을 안 그리면 빈 줄이 뜬다
  assert.match(src, /\{data\.source\s*&&\s*\(/, '출처가 있을 때만 그리는 조건이 없다')
  assert.match(src, /\{data\.source\.fileName\}/, '파일 이름을 실제로 그리는 자리가 없다')
  assert.match(src, /\{QUOTE_SOURCE\.label\}/, '무슨 줄인지 말하는 이름표가 없다')
  // 「이름은 있는데 파일이 없다」 — 이 줄이 빠지면 사용자는 기능이 없는 줄 안다
  assert.match(src, /hasOriginal === false/, '원본이 없다는 사실을 말하는 자리가 없다')
  assert.match(src, /\{QUOTE_SOURCE\.missing\}/, '원본 없음 문구를 실제로 그리지 않는다')
})

test('대조 부품에 값이 실제로 넘어간다 — 선언만으로는 안 된다', () => {
  const src = read(VIEW)
  const el = elementOf(src, 'QuoteOriginalCompare')

  assert.match(el, /quoteId=\{quoteId\}/, '대조 부품이 어느 견적인지 못 받는다')
  // 오른쪽 칸에 세울 견적서. 안 넘기면 대조 화면 절반이 빈다
  assert.match(el, /sheet=\{<QuoteSheet\b/, '대조 부품이 견적서를 못 받는다')
  assert.match(el, /onOriginal=\{setHasOriginal\}/, '원본 유무가 화면으로 안 돌아온다')
  assert.match(el, /onChanged=\{/, '원본이 바뀐 사실이 첨부 절로 안 간다')

  // 첨부 절도 반대 방향으로 알려 줘야 둘이 같은 말을 한다
  const panel = elementOf(src, 'AttachmentPanel')
  assert.match(panel, /target="QUOTE"/, '첨부 절이 견적이 아니라 다른 대상을 본다')
  assert.match(panel, /targetId=\{quoteId\}/, '첨부 절이 어느 견적인지 못 받는다')
  assert.match(panel, /onChanged=\{/, '첨부 절에서 올린 원본이 도구줄에 안 닿는다')
})

test('출처 줄은 종이에 안 나간다', () => {
  const src = read(VIEW)
  const css = read(VIEW_CSS)

  // 출처 줄이 화면 전용 상자 안에 있다
  assert.match(src, /styles\.screenOnly\}\s*\$\{styles\.source\}/, '출처 줄이 화면 전용으로 안 묶여 있다')

  const print = css.slice(css.indexOf('@media print'))
  assert.ok(print.length > 100, '인쇄 규칙을 못 잘랐다 — 검사가 헛돈다')
  for (const cls of ['.screenOnly', '.attachments', '.toolbar']) {
    assert.ok(print.includes(cls), `인쇄에서 ${cls} 를 안 숨긴다`)
  }
})

test('대조 화면도 종이에 안 나간다', () => {
  const css = read(COMPARE_CSS)
  const print = css.slice(css.indexOf('@media print'))
  assert.ok(print.includes('.overlay'), '대조 오버레이가 인쇄에서 안 빠진다')
  assert.match(print, /display:\s*none/, '인쇄에서 감추는 규칙이 없다')
})

test('원본 고르기는 매입 견적서 최신을 고르고, 없으면 나머지 최신을 고른다', () => {
  const at = (s: string) => `2026-09-20T${s}:00.000Z`
  const items = [
    { id: 'a', fileName: '명함.png', mimeType: 'image/png', kind: 'BUSINESS_CARD', createdAt: at('10:00') },
    { id: 'b', fileName: '옛 원본.pdf', mimeType: 'application/pdf', kind: 'SUPPLY_QUOTE', createdAt: at('11:00') },
    { id: 'c', fileName: '새 원본.pdf', mimeType: 'application/pdf', kind: 'SUPPLY_QUOTE', createdAt: at('12:00') },
  ]
  // 값이 나오는 단정이다 — null 이 아닌 «어느 것»인지까지 본다
  assert.equal(pickOriginal(items)?.id, 'c')

  const noSupply = items.filter((i) => i.kind !== 'SUPPLY_QUOTE')
  assert.equal(pickOriginal(noSupply)?.id, 'a', '매입 견적서가 없으면 나머지 중 최신을 골라야 한다')
  assert.equal(pickOriginal([]), null)

  assert.equal(drawKindOf('application/pdf'), 'pdf')
  assert.equal(drawKindOf('image/webp'), 'image')
  // 엑셀은 v0.10.32x 부터 «표로 펴서» 그린다 — 예전엔 여기서 other 로 떨어져 대조가 안 됐다
  assert.equal(drawKindOf('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), 'sheet')
  assert.equal(drawKindOf('application/x-hwp'), 'other')
  assert.equal(drawKindOf(null), 'other')
})

/* ── 구성 줄이 화면까지 가나 (v0.10.30x) ─────────── */

/*
  **왜 여기서 또 보나**: 읽는 쪽이 구성을 받아도 화면이 안 그리면 사용자에게는
  그 기능이 없는 것과 같다. 이 저장소가 반복한 사고가 정확히 그 모양이고
  (값은 있는데 그리는 자리가 없다), 이 파일이 그 자리를 붙잡는 자리다.

  **이름만 찾지 않는다** — 구성이 실제로 «값으로» 흐르는지 본다.
*/

const REVIEW = join(WEB, 'components/ui/crm/quote-review.tsx')
const SHAPE = join(WEB, 'lib/crm/domain/quote-spec.ts')
const FROM_FILE = join(WEB, 'lib/crm/services/quote-from-file.ts')

test('★ 읽은 구성이 폼 값으로 흘러간다 — 받아 놓고 안 넘기면 저장에서 사라진다', () => {
  const src = read(REVIEW)
  assert.match(src, /descriptionMd: joinSpec\(l\.spec, l\.components\)/,
    '구성을 규격 아래로 붙이지 않는다 — 폼에는 규격 한 줄만 들어간다')
  assert.match(src, /components = usable\.map/,
    '검수 모양이 구성을 담지 않는다 — 화면이 몇 줄인지 셀 수 없다')
})

test('★ 검수 목록이 구성을 실제로 그린다 — 선언만 하고 안 그리면 사라진 것과 같다', () => {
  const src = read(REVIEW)
  assert.match(src, /<ComponentsFold lines=\{review\.components\[i\] \?\? \[\]\}/,
    '구성 부품에 값이 안 넘어간다')
  assert.match(src, /fillComponentsFold\(lines\.length, open\)/,
    '몇 줄인지 말하지 않는다 — 숨긴 것과 사라진 것이 화면에서 같아진다')
})

test('★ 구성을 붙이고 다시 가르는 규칙이 한 곳이다 — 화면 밖이라 실제로 돌려 볼 수 있다', () => {
  const src = read(SHAPE)
  assert.match(src, /export function joinSpec/)
  assert.match(src, /export function splitSpec/)
  assert.ok(!src.includes("from '@/"),
    '화면 별칭을 물면 node --test 가 이 규칙을 못 돌린다 — 안 돌려 본 규칙은 가드가 아니다')
})

test('★ 붙인 것을 다시 가르면 원래대로다 — 두 규칙이 갈리면 화면과 종이가 달라진다', async () => {
  const { joinSpec, splitSpec } = await import('../domain/quote-spec.ts')
  const merged = joinSpec('AMD 9355 32Core x 2Ea', ['Dual AMD EPYC', '12-Channel DDR5'])
  assert.equal(merged, 'AMD 9355 32Core x 2Ea\nDual AMD EPYC\n12-Channel DDR5')
  assert.deepEqual(splitSpec(merged), {
    spec: 'AMD 9355 32Core x 2Ea',
    components: ['Dual AMD EPYC', '12-Channel DDR5'],
  })
  // 규격이 없고 구성만 있는 줄도 있다 — 첫 줄을 규격으로 삼는다
  assert.equal(joinSpec(null, ['가', '나']), '가\n나')
  assert.equal(joinSpec('', []), '')
})

test('★ 읽기 상한이 설정에서 온다 — 스키마에 박아 두면 설정을 바꿔도 안 바뀐다', () => {
  const src = read(FROM_FILE)
  assert.match(src, /readQuoteImportConfig\(db\)/, '설정을 안 읽는다')
  assert.match(src, /irToSourceText\(parsed\.doc, \{ maxChars: config\.maxChars \}\)/,
    '글자 수 상한이 설정을 안 따른다')
  assert.match(src, /parseQuoteFromDocDoc\(text, limits\)/,
    '항목·구성 상한이 설정을 안 따른다')
})

test('★ 한 쪽짜리 문서는 그 한 쪽을 채워 준다 — 아는 것을 안 쓰면 대조가 1쪽으로 떨어진다', () => {
  const src = read(FROM_FILE)
  assert.match(src, /const onlyPage = read\.pages\.length === 1 \? read\.pages\[0\] : null/)
  assert.match(src, /pageStart: q\.pageStart \?\? onlyPage/)
})

test('★ 건 카드가 원본 몇 쪽인지 말한다 — 두 건짜리 파일에서 내 건을 찾는 유일한 단서다', () => {
  const src = read(REVIEW)
  assert.match(src, /fillSourcePage\(review\.pageStart, review\.pageEnd\)/, '검수 머리말이 쪽을 안 말한다')
  assert.match(src, /fillSourcePage\(r\.pageStart, r\.pageEnd\)/, '고르는 목록이 쪽을 안 말한다')
})

test('쪽을 모르면 아무 말도 안 한다 — 1쪽이라고 넘겨짚으면 틀린 자리를 가리킨다', async () => {
  const { fillSourcePage } = await import('../../terms/quote.ts')
  assert.equal(fillSourcePage(null, null), null)
  assert.equal(fillSourcePage(2, 2), '원본 2쪽')
  assert.equal(fillSourcePage(2, 3), '원본 2-3쪽')
})

/* ── 구성이 종이까지 가나 ─────────────────────────── */

const SHEET = join(WEB, 'app/(crm)/crm/quotes/[id]/QuoteSheet.tsx')

test('★ 견적서 규격 자리가 줄바꿈을 살린다 — 안 살리면 여러 줄이 한 줄로 뭉친다', () => {
  const css = read(VIEW_CSS)
  const rule = css.slice(css.indexOf('.spec {'), css.indexOf('}', css.indexOf('.spec {')) + 1)
  assert.match(rule, /white-space:\s*pre-line/, '규격이 아직 한 줄로 뭉친다')
})

test('★ 견적서가 구성을 값으로 그린다 — 선언만으로는 종이에 안 나온다', () => {
  const src = read(SHEET)
  assert.match(src, /l\.components\.map\(/, '구성을 안 그린다')
  assert.match(src, /data-print=\{doc\.meta\.printComponents\}/,
    '인쇄 설정이 그 자리에 안 붙는다 — 접기를 골라도 종이에 다 나온다')
})

/**
 * `@media print { ... }` 덩어리를 **중괄호를 세어** 잘라 낸다.
 *
 * 마지막 하나만 보면 안 된다 — 이 파일에는 인쇄 블록이 둘이고, 규칙이 앞쪽에 있으면
 * 가드가 「인쇄에서 안 접힌다」고 거짓말한다(실제로 그렇게 한 번 틀렸다).
 */
function printBlocks(css: string): string[] {
  const out: string[] = []
  let at = css.indexOf('@media print')
  while (at >= 0) {
    const open = css.indexOf('{', at)
    let depth = 0
    let i = open
    for (; i < css.length; i += 1) {
      if (css[i] === '{') depth += 1
      else if (css[i] === '}') { depth -= 1; if (depth === 0) break }
    }
    out.push(css.slice(open, i + 1))
    at = css.indexOf('@media print', i)
  }
  return out
}

test('★ 접기는 인쇄에서만 한다 — 화면에서도 숨기면 사라진 것과 구분이 안 된다', () => {
  const css = read(VIEW_CSS)
  const blocks = printBlocks(css)
  assert.ok(blocks.length > 0, '인쇄 블록을 못 찾았다 — 가드가 헛돌고 있다')

  const RULE = /\.components\[data-print='collapse'\]\s*\{\s*display:\s*none/
  assert.ok(blocks.some((b) => RULE.test(b)), '인쇄에서 접히지 않는다')

  // 인쇄 블록을 도려낸 나머지에 같은 규칙이 있으면 화면에서도 사라진다
  const outside = blocks.reduce((acc, b) => acc.replace(b, ''), css)
  assert.ok(!RULE.test(outside), '화면에서도 숨기고 있다')
})

/* ── 대조가 그 건을 먼저 세우나 (v0.10.31x) ─────── */

test('★ 조각이 있으면 조각을 고른다 — 파일 전체를 세우면 사람이 자기 건을 찾아야 한다', () => {
  const items = [
    { id: 'a1', fileName: '원본.pdf', mimeType: 'application/pdf', kind: 'SUPPLY_QUOTE', createdAt: '2026-09-20T01:00:00Z' },
    { id: 'a2', fileName: '원본_2쪽.png', mimeType: 'image/png', kind: 'SUPPLY_QUOTE', createdAt: '2026-09-20T02:00:00Z' },
  ]
  assert.equal(pickOriginal(items, 'a2')?.id, 'a2')
  // 조각을 안 알려 주면 예전 규칙 그대로 — 가장 나중 매입 견적서
  assert.equal(pickOriginal(items)?.id, 'a2')
})

test('★ 조각이 지워졌으면 파일 전체로 물러선다 — 빈 화면이 되면 대조 자체를 못 한다', () => {
  const items = [
    { id: 'a1', fileName: '원본.pdf', mimeType: 'application/pdf', kind: 'SUPPLY_QUOTE', createdAt: '2026-09-20T01:00:00Z' },
  ]
  assert.equal(pickOriginal(items, 'gone')?.id, 'a1')
})

test('★ 쪽을 알면 그 쪽부터 연다 — 모르면 넘겨짚지 않는다', () => {
  assert.equal(pdfViewerHash(2), '#navpanes=0&view=FitH&page=2')
  assert.equal(pdfViewerHash(null), '#navpanes=0&view=FitH')
  assert.equal(pdfViewerHash(0), '#navpanes=0&view=FitH', '0쪽은 없다')
  assert.equal(pdfViewerHash(2.9), '#navpanes=0&view=FitH&page=2')
})

test('★ 대조 부품에 조각과 쪽이 값으로 넘어간다 — 선언만으로는 안 열린다', () => {
  const src = read(VIEW)
  const tag = src.slice(src.indexOf('<QuoteOriginalCompare'))
  const end = tag.indexOf('/>')
  const props = tag.slice(0, end)
  assert.match(props, /snapshotId=\{data\.source\?\.snapshotId/, '조각 id 가 안 넘어간다')
  assert.match(props, /pageStart=\{data\.source\?\.pageStart/, '쪽이 안 넘어간다')
})

test('★ 대조 화면이 그 쪽을 열고, 전체로 갈 길을 남긴다', () => {
  const src = read(join(WEB, 'components/ui/crm/QuoteOriginalCompare.tsx'))
  assert.match(src, /pdfViewerHash\(pageStart\)/, '늘 1쪽부터 연다')
  assert.match(src, /QUOTE_SOURCE\.showWhole/, '전체로 갈 길이 없다')
  assert.match(src, /fillSourcePage\(pageStart, pageEnd\)/, '몇 쪽을 보는지 말하지 않는다')
})

test('★ 내려받기는 파일 전체다 — 오려 둔 그림을 내려받아 봐야 원본 문서가 아니다', () => {
  const src = read(join(WEB, 'components/ui/crm/QuoteOriginalCompare.tsx'))
  const dl = src.slice(src.indexOf('const download = useCallback'))
  assert.match(dl.slice(0, 400), /\(whole \?\? original\)\.id/, '조각을 내려받게 되어 있다')
})

/* ── 읽은 묶음이 견적의 묶음이 되나 ─────────────── */

/*
  **왜 여기서 보나**: 읽기 모양에 묶음 이름을 받아 놓고 아무 화면도 안 쓰면
  그것은 「선언만 되고 소비 코드 0」이다 — 이 저장소가 여러 번 겪은 그 모양이고,
  이 플랜의 완료 정의가 그것을 금지한다.
*/

const REVIEW_SRC = join(WEB, 'components/ui/crm/quote-review.tsx')
const FROM_FILE_MODAL = join(WEB, 'components/ui/crm/QuoteFromFileModal.tsx')

test('★ 원본이 묶어 부른 말이 검수 모양에 실린다', () => {
  const src = read(REVIEW_SRC)
  assert.match(src, /const groups = usable\.map\(\(l\) => \(l\.groupLabel/,
    '묶음 이름을 받아 놓고 안 담는다')
})

test('★ 그 말로 묶음이 만들어지고 항목이 제 묶음에 들어간다', async () => {
  const { groupPickedLines } = await import('../domain/quote-group.ts')
  const got = groupPickedLines(['하드웨어', '하드웨어', '용역', null])
  assert.deepEqual(got.sections, [{ name: '하드웨어' }, { name: '용역' }])
  assert.deepEqual(got.sectionIndexes, [0, 0, 1, null])

  const src = read(FROM_FILE_MODAL)
  assert.match(src, /const grouped = pickedSections\(review\)/, '묶음을 안 만든다')
  assert.match(src, /sections: grouped\.sections/, '만든 묶음을 안 보낸다')
  assert.match(src, /sectionIndex: grouped\.sectionIndexes\[i\]/, '항목이 제 묶음을 안 가리킨다')
})

test('★ 묶음 이름이 하나도 없으면 묶음을 안 만든다 — 빈 묶음은 소계를 헛돌게 한다', async () => {
  const { groupPickedLines } = await import('../domain/quote-group.ts')
  const got = groupPickedLines([null, null, '  '])
  assert.deepEqual(got.sections, [])
  assert.deepEqual(got.sectionIndexes, [null, null, null])
})

test('차례는 원본에 나온 순서다 — 이름순으로 뒤집으면 원본과 견적의 줄 순서가 갈린다', async () => {
  const { groupPickedLines } = await import('../domain/quote-group.ts')
  const got = groupPickedLines(['하드웨어', '가나다'])
  assert.deepEqual(got.sections, [{ name: '하드웨어' }, { name: '가나다' }])
})

/* ── 쪽이 없는 원본도 세우나 (v0.10.32x) ─────────── */

/*
  **왜**: 견적서는 엑셀로 오는 일이 흔한데, 그동안 대조 화면은 「이 형식은 화면 안에
  못 그려요」로 끝났다 — 대조하러 연 화면이 대조를 못 하는 상태다.
  PDF 처럼 쪽을 오릴 수도 없다(엑셀에는 쪽이라는 것이 없다). 대신 표로 편다.
*/

test('★ 엑셀은 그릴 수 있는 것으로 본다 — 「못 그려요」로 떨어지면 대조가 안 된다', () => {
  assert.equal(drawKindOf('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), 'sheet')
  assert.equal(drawKindOf('application/vnd.ms-excel'), 'sheet')
  assert.equal(drawKindOf('text/csv'), 'sheet')
  // 매개변수가 붙어 와도 같은 형식이다 — 브라우저가 붙여 주는 일이 있다
  assert.equal(drawKindOf('text/csv; charset=utf-8'), 'sheet')
})

test('그릴 수 없는 형식은 그대로 남는다 — 없는 것을 있는 척하지 않는다', () => {
  assert.equal(drawKindOf('application/x-hwp'), 'other')
  assert.equal(drawKindOf(null), 'other')
  assert.equal(drawKindOf('application/pdf'), 'pdf')
  assert.equal(drawKindOf('image/png'), 'image')
})

test('★ 대조 화면이 표를 값으로 그리고, 못 펴면 예전 안내로 물러선다', () => {
  const src = read(join(WEB, 'components/ui/crm/QuoteOriginalCompare.tsx'))
  assert.match(src, /const got = await readSheetPreview\(bytes\)/, '표를 안 편다')
  assert.match(src, /sheet\.rows\.map\(/, '편 표를 안 그린다')
  assert.match(src, /setNotDrawable\(true\)/, '못 폈을 때 물러설 길이 없다')
  assert.match(src, /draw === 'other' \|\| notDrawable/, '못 폈는데도 안내가 안 뜬다')
})

test('★ 셀 값을 HTML 로 조립하지 않는다 — 남의 문서에서 온 글이다', () => {
  const src = read(join(WEB, 'components/ui/crm/QuoteOriginalCompare.tsx'))
  assert.ok(!/dangerouslySetInnerHTML/.test(src), '남이 심은 것이 우리 화면에서 돈다')
  const preview = read(join(WEB, 'lib/crm/ui/quote-sheet-preview.ts'))
  assert.ok(!/innerHTML|<td|<table/.test(preview), '읽는 쪽이 마크업을 만든다')
})

test('★ 표 읽는 도구는 그 자리에서만 불러온다 — 위에서 물면 견적 화면이 무거워진다', () => {
  const src = read(join(WEB, 'lib/crm/ui/quote-sheet-preview.ts'))
  const head = src.slice(0, src.indexOf('export function cellText') >= 0
    ? src.indexOf('export function cellText') : src.indexOf('export const MAX_SHEET_ROWS'))
  assert.ok(!/^import .*'xlsx'/m.test(head), '맨 위에서 표 도구를 물고 있다')
  assert.match(src, /await import\('xlsx'\)/, '동적으로 안 불러온다')
})

test('★ 내려받기 길은 그대로 남는다 — 화면에 그렸다고 원본을 못 받으면 안 된다', () => {
  const src = read(join(WEB, 'components/ui/crm/QuoteOriginalCompare.tsx'))
  assert.match(src, /QUOTE_SOURCE\.download/, '내려받기가 사라졌다')
})

/* ── 구성이 눈으로 갈리나 (v0.10.32x) ────────────── */

/*
  **왜**: 구성이 규격과 같은 크기·같은 색으로 붙어 있으면 한 문단으로 읽힌다.
  실제로 그렇게 보였다(사용자 지적 2026-09-21: 「줄바꿈이랑 영역 구분이 안되어 보이니깐
  그냥 한문장으로 쭉있는것 같자나」).

  처음에는 왼쪽 세로선과 줄머리 점으로 갈랐다. 그것으로는 모자랐다 — 사양 한 줄이 길어
  두세 줄로 접히면 점이 어디 붙었는지 눈이 못 쫓는다. 그래서 **줄과 줄 사이를 가로선으로**
  가른다(사용자 지시: 「연한 줄로 구분 하면 되자나 그래서 깔끔하게」).

  가드가 보는 것은 **선이 줄마다 걸리는가**다. 첫 줄 위에만 선을 두고 나머지를 붙여 놓으면
  여전히 한 덩어리이므로, `li` 에 걸린 선과 첫 줄을 빼는 규칙을 함께 본다.
*/

test('★ 견적서의 구성이 줄마다 가로선으로 갈린다', () => {
  const css = read(VIEW_CSS)
  const rule = css.slice(css.indexOf('.components {'), css.indexOf('.components li:last-child') + 120)
  assert.match(rule, /\.components li \{[^}]*border-top:/, '줄마다 걸리는 선이 없다 — 한 덩어리로 읽힌다')
  assert.match(rule, /\.components \{[^}]*border-top:/, '규격 아래 선이 없다 — 규격과 구성이 안 갈린다')
  assert.match(rule, /li:first-child \{[^}]*border-top: none/, '첫 줄 위 선을 안 뺐다 — 규격 아래 선과 겹쳐 두꺼워진다')
})

test('★ 검수 목록의 구성도 견적서와 같은 모양이다 — 다르면 대조가 흔들린다', () => {
  const css = read(join(WEB, 'components/ui/crm/quote-panel.module.css'))
  const rule = css.slice(css.indexOf('.componentsList {'))
  assert.match(rule.slice(0, 700), /\.componentsList li \{[^}]*border-top:/, '줄마다 걸리는 선이 없다')
  assert.match(rule.slice(0, 900), /li:first-child \{[^}]*border-top: none/, '첫 줄 위 선을 안 뺐다')
})

/*
  **한 덩어리로 들어온 글을 사람이 한 번에 나눌 수 있어야 한다.**

  표식이 지워진 채 합쳐져 온 견적은 서버가 되살릴 근거가 없다(원본은 그림으로만 남는다).
  그때 남는 길은 사람이 편집기에서 나누는 것뿐이라, 그 길을 막으면 그 견적은 영영
  한 문단으로 남는다.
*/
test('★ 편집기가 표식대로 줄을 나눠 굳힌다 — 보이기만 갈라선 저장본이 안 바뀐다', () => {
  // 규격·비고 칸은 편집 모달이 800줄에 닿아 옆 부품으로 나갔다
  const src = read(join(WEB, 'components/ui/crm/QuoteLineSpecFields.tsx'))
  assert.match(src, /QUOTE\.lineSpecSplitAction/, '나누기 단추가 없다')
  assert.match(src, /onClick=\{\(\) => onSpec\(split\)\}/, '누르는 것이 적힌 글을 안 바꾼다')
  assert.match(src, /\{!locked && split !== null &&/, '나눌 것이 없어도 단추를 낸다')

  // 부품이 실제로 걸려 있어야 화면에 나온다 — 만들어만 두면 아무 데도 안 뜬다
  const modal = read(join(WEB, 'components/ui/crm/QuoteEditorModal.tsx'))
  assert.match(modal, /<QuoteLineSpecFields/, '편집기가 그 부품을 안 부른다')
  assert.match(modal, /onSpec=\{\(v\) => setLine\(i, \{ descriptionMd: v \}\)\}/, '규격 값이 안 돌아온다')
  assert.match(modal, /onRemark=\{\(v\) => setLine\(i, \{ remark: v \}\)\}/, '비고 값이 안 돌아온다')
})

/*
  **비고는 적는 자리와 받아들이는 자리 둘 다에 있어야 한다**
  (사용자 지시 2026-09-21: 「견적 입력하는 쪽에도 있고 받아들이는쪽에도 있고 해야지」).
  한쪽만 있으면 읽은 값을 못 고치거나, 적은 값이 읽기에서 덮인다.
*/
test('★ 비고를 적는 칸이 있다 — 폼에 칸이 없으면 아무도 못 채운다', () => {
  const src = read(join(WEB, 'components/ui/crm/QuoteLineSpecFields.tsx'))
  assert.match(src, /QUOTE\.lineRemark\}/, '비고 라벨이 없다')
  assert.match(src, /value=\{remark\}/, '비고 칸이 값을 안 그린다')
  assert.match(src, /onChange=\{\(e\) => onRemark\(e\.target\.value\)\}/, '적은 값이 안 돌아간다')
  assert.match(src, /maxLength=\{MAX_REMARK\}/, '길이 상한이 없다 — 밖에서 온 값이다')
})

test('★ 적은 비고가 저장까지 간다 — 화이트리스트가 모르는 이름을 지운다', () => {
  const shape = read(join(WEB, 'components/ui/crm/quote-draft-shape.ts'))
  assert.match(shape, /remark: l\.remark\.trim\(\) \|\| null/, '초안이 비고를 안 싣는다')

  const svc = read(join(WEB, 'lib/crm/services/quote.ts'))
  const keys = svc.slice(svc.indexOf('const LINE_KEYS'), svc.indexOf('const QUOTE_KEYS'))
  assert.match(keys, /'remark'/, '화이트리스트에 없어 저장에서 조용히 버려진다')
  assert.match(svc, /remark: normalizeText\(line\.remark\)/, '저장이 비고를 안 쓴다')
})

test('★ 파일에서 읽은 비고가 초안으로 온다 — 읽어도 담을 자리가 없으면 버려진다', () => {
  for (const f of ['components/ui/crm/quote-review.tsx', 'components/ui/crm/QuoteFillPanel.tsx']) {
    const src = read(join(WEB, f))
    assert.match(src, /remark: l\.remark \?\? ''/, `${f} 가 읽은 비고를 안 옮긴다`)
  }
  const schema = read(join(WEB, 'lib/crm/ai/schemas/quote-from-doc.ts'))
  assert.match(schema, /remark: softString/, '읽기 스키마에 비고가 없다 — 모델이 줘도 버려진다')
})

test('★ 규격 칸이 어떻게 갈리는지 그 자리에서 말한다 — 적고 나서도 모르면 안 된다', () => {
  const src = read(join(WEB, 'components/ui/crm/QuoteLineSpecFields.tsx'))
  assert.match(src, /QUOTE\.lineSpecSplitHint/, '갈림 안내가 없다')
  assert.match(src, /fillSpecSplit\(splitSpec\(spec\)\.components\.length\)/,
    '몇 줄로 갈리는지 숫자로 안 말한다')
})

test('★ 합쳐져 온 구성을 원문 줄로 되살린다 — 화면이 아니라 읽는 자리에서', () => {
  const src = read(join(WEB, 'lib/crm/services/quote-from-file.ts'))
  assert.match(src, /restoreComponents\(l, sourceLines\)/, '되살리지 않는다')
  assert.match(src, /read\.text \? read\.text\.split/, '원문 줄을 안 넘긴다')
})


/* ── 비고가 값으로 흐르나 (v0.10.34x) ─────────────── */

/*
  **왜**: 비고는 표 열을 세우는 것만으로는 안 보인다. 값이 **쿼리 → 서비스 → 문서**
  세 자리를 다 지나야 화면에 뜬다. 한 자리만 빠져도 타입은 맞는데 칸이 빈다.

  이 저장소가 같은 결함을 네 번 밟았다(선언만 하고 안 넘김·펼침 누락 등).
  그래서 이름이 아니라 **값이 가는 자리**를 하나씩 본다.
*/

test('★ 비고가 쿼리에서 실려 온다 — LINE_SELECT 에 없으면 값이 아예 안 온다', () => {
  const src = read(join(WEB, 'lib/crm/services/quote.ts'))
  const sel = src.slice(src.indexOf('const LINE_SELECT'), src.indexOf('const SELECT'))
  assert.match(sel, /remark: true/, '쿼리가 비고를 안 읽는다')
})

test('★ 비고가 서비스에서 문서 입력으로 넘어간다', () => {
  const src = read(join(WEB, 'lib/crm/services/quote-document.ts'))
  assert.match(src, /remark: l\.remark/, '서비스가 비고를 안 넘긴다')
})

test('★ 비고가 문서 줄에 실린다', () => {
  const src = read(join(WEB, 'lib/crm/domain/quote-document.ts'))
  assert.match(src, /remark: text\(l\.remark\) \|\| null/, '문서가 비고를 안 싣는다')
})
