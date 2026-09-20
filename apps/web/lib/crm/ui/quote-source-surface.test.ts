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
import { pickOriginal, drawKindOf } from './quote-original.ts'

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
  assert.equal(drawKindOf('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), 'other')
  assert.equal(drawKindOf(null), 'other')
})
