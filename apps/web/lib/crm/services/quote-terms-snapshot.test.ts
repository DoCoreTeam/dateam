// 견적서 스냅샷 — 견적서는 **만든 날의 문서**다
//
// **왜 이 가드가 생겼나**: 조건 본문을 읽을 때마다 살아 있는 값을 따라가고 있었다.
// 그래서 관리자가 설정의 기본 거래 조건을 한 글자 고치면 **이미 보낸 견적서를 다시 열었을 때
// 조건이 바뀌어 있었다.** 고객이 든 종이와 우리 화면이 다른 말을 하면 그건 문서가 아니다.
//
// 그리고 고치다 더 조용한 것을 하나 찾았다 — `updateQuote` 는 `termIds` 를 받아 놓고
// `data` 에 안 실었다. 편집 화면에서 조건을 고쳐 저장하면 화면은 저장됐다고 말하는데
// **아무 일도 안 일어났다.** 선언은 있고 값은 안 가는, 이름만 보는 가드가 놓치는 자리다.
//
// 서비스는 DB 가 있어야 돌아가므로 여기서는 **소스를 읽어** 배선이 살아 있는지 본다
// (줄 나누기 규칙은 순수 함수라 직접 부른다).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { termsTextToLines } from './quote.ts'
import { assetHash } from './quote-asset.ts'

const QUOTE = readFileSync(new URL('./quote.ts', import.meta.url), 'utf8')
const DOCUMENT = readFileSync(new URL('./quote-document.ts', import.meta.url), 'utf8')
const DOMAIN = readFileSync(new URL('../domain/quote-document.ts', import.meta.url), 'utf8')

test('★ 줄 나누기 규칙이 읽는 쪽과 같다 — 다르면 굳힌 조건과 인쇄된 조건이 갈린다', () => {
  assert.deepEqual(termsTextToLines('결제: 30일\n\n납품: 8주\n'), ['결제: 30일', '납품: 8주'])
  assert.deepEqual(termsTextToLines('  앞뒤 공백  '), ['앞뒤 공백'])
  assert.deepEqual(termsTextToLines(''), [])
  assert.deepEqual(termsTextToLines(null), [])
  // 도메인이 supplier.terms 를 나누는 그 줄과 **같은 규칙**이어야 한다
  assert.ok(
    /split\('\\n'\)\.map\(\(t\) => t\.trim\(\)\)\.filter\(\(t\) => t !== ''\)/.test(DOMAIN),
    '도메인의 조건 나누기 규칙이 바뀌었다 — termsTextToLines 도 같이 바꿔야 한다',
  )
})

test('★ 만들 때 굳힌다 — 두 생성 경로가 **같은 값**을 쓴다', () => {
  const from = QUOTE.indexOf('export async function createQuote')
  // 다음 export 함수 앞까지가 createQuote 다 — 파일 전체를 보면 옆 함수의 줄이 섞인다
  const next = QUOTE.indexOf('export async function', from + 1)
  const body = QUOTE.slice(from, next > 0 ? next : undefined)
  // 스냅샷을 한 번 계산한다
  assert.ok(
    /^\s*const termsSnapshot = await resolveTermsSnapshot\(tx, termIds\)$/m.test(body),
    'createQuote 가 스냅샷을 안 굳힌다',
  )
  /*
    **이름이 아니라 값이 가는지를 본다.** 번호가 겹쳤을 때 도는 재시도 경로가 따로 있어,
    한쪽에만 실으면 «그날 번호가 겹친 견적만» 조건이 빈 채로 남는다.
    `create({ data: ... })` 가 두 번 있고 둘 다 termsSnapshot 을 실어야 한다.
  */
  const creates = body.match(/crmQuote\.create\(\{/g) ?? []
  assert.equal(creates.length, 2, `생성 경로가 ${creates.length}곳이다 — 가드의 전제가 바뀌었다`)
  const passed = body.match(/^\s+termsSnapshot,$/gm) ?? []
  assert.equal(passed.length, 2, `termsSnapshot 을 넘기는 곳이 ${passed.length}곳이다 — 두 경로 모두여야 한다`)
})

test('★ 고칠 때 다시 굳힌다 — termIds 를 받아 놓고 안 쓰던 자리다', () => {
  const update = QUOTE.slice(QUOTE.indexOf('export async function updateQuote'))
  /*
    **줄 전체를 본다.** 처음엔 `/data\.termIds = termIds/` 였는데, 그 줄을 `//` 로 주석
    처리해도 가드가 통과했다(일부러 깨서 확인하다 잡았다). 주석에 남은 코드는 코드가 아니다.
  */
  // 사용자가 고친 것은 반영한다 — 이 줄이 없으면 조건 편집이 조용히 사라진다
  assert.ok(/^\s*data\.termIds = termIds$/m.test(update), 'updateQuote 가 고른 조건을 저장하지 않는다')
  assert.ok(
    /^\s*data\.termsSnapshot = await resolveTermsSnapshot\(tx, termIds\)$/m.test(update),
    'updateQuote 가 조건을 다시 안 굳힌다',
  )
})

test('★ 복제한 견적도 굳은 조건을 물려받는다 — 다른 조건이 찍히면 「다른 안」이 아니다', () => {
  assert.ok(/^\s*[^/\n]*termsSnapshot: src\.termsSnapshot/m.test(QUOTE), '복제가 굳은 조건을 안 옮긴다')
})

test('★ 읽을 때 굳은 것이 먼저다 — 비어 있을 때만 살아 있는 조건을 본다', () => {
  assert.ok(
    /^\s*const useSnapshot = termsSnapshot\.length > 0$/m.test(DOCUMENT),
    '문서 조립이 굳은 조건을 보지 않는다',
  )
  // 굳은 조건이 있으면 **조건 표를 읽지 않는다** — 읽으면 지워진 조건에서 빈 배열이 돌아온다
  assert.ok(
    /^\s*!useSnapshot && termIds\.length > 0$/m.test(DOCUMENT),
    '굳은 조건이 있어도 조건 표를 또 읽는다',
  )
  assert.ok(
    /selectedTerms: useSnapshot\s*\n\s*\? termsSnapshot/.test(DOCUMENT),
    '인쇄에 굳은 조건을 쓰지 않는다',
  )
})

test('★ 스냅샷 칸이 읽기 목록에 있다 — 안 읽으면 굳혀도 화면에 안 닿는다', () => {
  assert.ok(/^\s*[^/\n]*termsSnapshot: true/m.test(QUOTE), 'SELECT 에 termsSnapshot 이 없다')
})

// ------------------------------------------------------------
// 조건만이 아니다 — 공급자와 로고도 그날 것으로 굳는다
//
// 사용자 지시 2026-09-20: 「그게 설령 로고나 회사명 대표이사가 바뀐거더라도
// 그때 당시의 유지가 핵심임」. 셋 중 하나라도 살아 있는 값을 따라가면
// 그 견적서는 어느 날 다른 문서가 된다.
// ------------------------------------------------------------

/** 주석에 남은 코드는 코드가 아니다 — 줄 앞이 주석인 줄은 못 세게 한다 */
function live(src: string): string {
  return src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
}

test('★ 만들 때 셋을 다 굳힌다 — 조건·공급자·로고', () => {
  const from = QUOTE.indexOf('export async function createQuote')
  const next = QUOTE.indexOf('export async function', from + 1)
  const body = live(QUOTE.slice(from, next > 0 ? next : undefined))

  assert.ok(/const termsSnapshot = await resolveTermsSnapshot\(tx, termIds\)/.test(body), '조건을 안 굳힌다')
  assert.ok(/const supplierSnapshot = await readQuoteSupplier\(/.test(body), '공급자를 안 굳힌다')
  assert.ok(/const logoAssetHash = await freezeAsset\(/.test(body), '로고를 안 굳힌다')

  /*
    **이름이 아니라 값이 가는지를 본다.** 번호가 겹쳤을 때 도는 재시도 경로가 따로 있어,
    한쪽에만 실으면 «그날 번호가 겹친 견적만» 굳지 않은 채 남는다.
  */
  const creates = body.match(/crmQuote\.create\(\{/g) ?? []
  assert.equal(creates.length, 2, `생성 경로가 ${creates.length}곳이다 — 가드의 전제가 바뀌었다`)
  for (const field of ['termsSnapshot', 'supplierSnapshot', 'logoAssetHash']) {
    const passed = body.match(new RegExp(`^\\s+${field},$`, 'gm')) ?? []
    assert.equal(passed.length, 2, `${field} 를 넘기는 곳이 ${passed.length}곳이다 — 두 경로 모두여야 한다`)
  }
})

test('★ 복제도 셋을 다 물려받는다 — 다른 안이 다른 회사 정보를 찍으면 안 된다', () => {
  const src = live(QUOTE)
  assert.ok(/termsSnapshot: src\.termsSnapshot/.test(src), '복제가 굳은 조건을 안 옮긴다')
  assert.ok(/supplierSnapshot: src\.supplierSnapshot/.test(src), '복제가 굳은 공급자를 안 옮긴다')
  assert.ok(/logoAssetHash: src\.logoAssetHash/.test(src), '복제가 굳은 로고를 안 옮긴다')
})

test('★ 고칠 때 공급자와 로고는 다시 안 굳는다 — 저장할 때마다 바뀌면 굳힌 것이 아니다', () => {
  const from = QUOTE.indexOf('export async function updateQuote')
  const next = QUOTE.indexOf('export async function', from + 1)
  const body = live(QUOTE.slice(from, next > 0 ? next : undefined))
  assert.ok(!/data\.supplierSnapshot/.test(body), 'updateQuote 가 공급자를 다시 굳힌다')
  assert.ok(!/data\.logoAssetHash/.test(body), 'updateQuote 가 로고를 다시 굳힌다')
  // 조건만은 다시 굳는다 — 사용자가 고른 것이기 때문이다
  assert.ok(/data\.termsSnapshot = await resolveTermsSnapshot/.test(body), '고른 조건을 다시 안 굳힌다')
})

test('★ 읽을 때 셋 다 굳은 것이 먼저다 — 굳은 값이 있으면 설정을 아예 안 읽는다', () => {
  const src = live(DOCUMENT)
  assert.ok(/const useSupplierSnapshot = Object\.keys\(supplierSnapshot\)\.length > 0/.test(src), '굳은 공급자를 안 본다')
  assert.ok(
    /useSupplierSnapshot \? Promise\.resolve\(supplierSnapshot\) : readQuoteSupplier\(db\)/.test(src),
    '굳은 공급자가 있어도 설정을 읽는다',
  )
  assert.ok(/logoAssetHash\s*\n?\s*\? readAsset\(db, logoAssetHash\)/.test(src), '굳은 로고를 안 읽는다')
})

test('★ 같은 그림은 행을 안 늘린다 — 해시가 내용에서 나온다', () => {
  const a = 'data:image/png;base64,AAAA'
  assert.equal(assetHash(a), assetHash('data:image/png;base64,AAAA'))
  assert.notEqual(assetHash(a), assetHash('data:image/png;base64,AAAB'))
  assert.match(assetHash(a), /^[0-9a-f]{64}$/, 'sha256 hex 가 아니다')
})

test('★ 읽는 쪽이 굳은 칸을 실제로 읽어 온다 — 안 읽으면 굳혀도 문서에 안 닿는다', () => {
  const src = live(QUOTE)
  for (const field of ['termsSnapshot: true', 'supplierSnapshot: true', 'logoAssetHash: true']) {
    assert.ok(src.includes(field), `SELECT 에 ${field} 가 없다`)
  }
})
