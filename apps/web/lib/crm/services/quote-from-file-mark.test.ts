/**
 * 「파일에서 온 견적」 표시 가드
 *
 * ## 무엇을 지키나
 *
 * 이 표시의 쓸모는 하나다 — **읽은 그대로인 견적을 사람이 쓴 견적과 구분해 보이는 것**.
 * 그래서 두 방향을 같이 잠근다.
 *
 * ⓐ **켜지는가**: 파일에서 만들면 찍히고, 한 번 고쳐 저장하면 풀린다.
 *   안 찍히면 배지가 영영 안 뜨고, 안 풀리면 다 고친 견적에 「수정 전」이 붙어 있다.
 *
 * ⓑ **막지 않는가**: 이 값이 상태 전이·승인·문서 출력 어디에도 닿지 않는다.
 *   사용자 지시(2026-09-19: "사용자에게 자율성을 줘 ... 그냥 편의로 할 수도 있다")가 이 절의 근거다.
 *   「수정 전이니 보내지 마세요」는 편해 보여서 언제든 되살아난다 —
 *   되살아나는 순간 이 가드가 깨지게 해 둔다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf-8')
const SERVICE = read('lib/crm/services/quote.ts')
const SCHEMA = read('prisma/schema.prisma')
const SQL = read('../../supabase/migrations/258_crm_quote_from_file.sql')

/** 이 표시가 사는 두 칸 */
const COLUMNS = ['fromFileAt', 'sourceFileName'] as const

test('★ 마이그레이션이 열 둘을 더하고 무엇인지 적는다', () => {
  for (const col of COLUMNS) {
    assert.match(SQL, new RegExp(`ADD COLUMN IF NOT EXISTS "${col}"`),
      `${col} 을 더하지 않는다`)
    assert.match(SQL, new RegExp(`COMMENT ON COLUMN crm_quote\\."${col}"`),
      `${col} 이 무엇인지 DB 에 안 적혀 있다 — 다음 사람은 이름만 보고 뜻을 지어낸다`)
  }
  // 이미 적용된 판을 다시 돌려도 죽지 않아야 한다 (IF NOT EXISTS)
  assert.ok(!/ADD COLUMN "(fromFileAt|sourceFileName)"/.test(SQL),
    'IF NOT EXISTS 없이 더한다 — 재적용이 실패한다')
})

test('★ 스키마와 타입이 같은 칸을 안다', () => {
  assert.match(SCHEMA, /fromFileAt\s+DateTime\?/, '스키마에 fromFileAt 이 없다')
  assert.match(SCHEMA, /sourceFileName\s+String\?/, '스키마에 sourceFileName 이 없다')
  for (const col of COLUMNS) {
    assert.match(SERVICE, new RegExp(`${col}: true`),
      `${col} 을 안 읽는다 — 화면이 배지를 달 근거에 닿지 못한다`)
  }
})

test('★ 파일에서 만들면 찍힌다 — 시각은 서버가 정한다', () => {
  assert.match(SERVICE, /sourceFileName\?: string \| null/,
    '만들 때 파일 이름을 받는 자리가 없다')
  assert.match(SERVICE, /fromFileAt: new Date\(\)/,
    '시각을 서버가 찍지 않는다')
  /*
    보낸 쪽이 시각을 주면 「수정 전」 표시를 지운 채로 만들 수 있다.
    받는 키 목록에 fromFileAt 이 없어야 그 길이 막힌다.
  */
  const keys = SERVICE.slice(SERVICE.indexOf('const QUOTE_KEYS'), SERVICE.indexOf('function rejectUnknownKeys'))
  assert.ok(!/fromFileAt/.test(keys), '바깥이 시각을 정할 수 있다 — 표시를 위조할 수 있다')

  /*
    번호가 겹치면 create 를 한 번 더 부른다. 그 갈래를 빠뜨리면
    **하필 동시에 만든 견적만** 표시가 안 붙는다 — 재현이 안 돼 영원히 안 고쳐진다.
  */
  const create = SERVICE.slice(SERVICE.indexOf('export async function createQuote'),
    SERVICE.indexOf('export async function updateQuote'))
  assert.equal(create.match(/\.\.\.fromFile,/g)?.length, 2,
    'create 두 갈래 중 한쪽에만 얹었다')
})

test('★ 한 번 고쳐 저장하면 풀린다 — 출처는 남는다', () => {
  const update = SERVICE.slice(SERVICE.indexOf('export async function updateQuote'),
    SERVICE.indexOf('function amountsChanged'))
  assert.match(update, /if \(before\.fromFileAt\) data\.fromFileAt = null/,
    '저장해도 「수정 전」이 안 풀린다')
  assert.ok(!/data\.sourceFileName = null/.test(update),
    '출처까지 지운다 — 고친 뒤에도 그 파일에서 온 것은 사실이다')
})

/*
  **이 절이 이 파일의 이유다.**

  잠그는 편이 늘 더 안전해 보인다 — 그래서 「수정 전이면 못 보낸다」는 언제든 되돌아온다.
  그러면 읽은 값이 이미 맞는 흔한 경우에도 사람은 화면을 열어 없는 오타를 만들어야 한다.
  자율성은 사용자에게 있고, 이 표시는 **말해 줄 뿐 막지 않는다**.
*/
test('★ 아무것도 막지 않는다 — 표시 전용', () => {
  /** 이 셋이 「보낼 수 있나·승인됐나·복제하면 뭐가 따라가나」를 정하는 자리다 */
  const gates: Array<[string, string]> = [
    ['approveQuote', 'export async function transitQuote'],
    ['transitQuote', 'export async function deleteQuote'],
    ['duplicateQuote', 'export async function approveQuote'],
  ]
  for (const [fn, until] of gates) {
    const start = SERVICE.indexOf(`export async function ${fn}`)
    const end = SERVICE.indexOf(until)
    assert.ok(start > 0 && end > start, `${fn} 의 범위를 못 잡았다 — 가드가 엉뚱한 곳을 본다`)
    const body = SERVICE.slice(start, end)
    for (const col of COLUMNS) {
      assert.ok(!new RegExp(`\\b${col}\\b`).test(body),
        `${fn} 이 ${col} 을 본다 — 표시가 게이트가 됐다`)
    }
  }
})
