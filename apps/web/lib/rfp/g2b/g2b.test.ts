/**
 * 나라장터 공고 연동 가드 (설계서 3.2.3)
 *
 * 여기서 잠그는 것 셋
 * - 응답이 rfp_sources 칸으로 사상되는가
 * - 서비스 키가 env 가 아니라 DB 에서 오는가
 * - 실패마다 다음에 무엇을 하면 되는지 알려 주는가
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  readServiceKey, fetchNotice, itemsOf, fail, FALLBACK_GUIDE, G2B_KEY_FIELD, type MetaReader,
} from './client.ts'
import {
  toSourceRow, toDbColumns, toAmount, toIsoDate, toIsoDateTime, looksItProject, looksUrgent,
} from './map.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** 실제 응답 모양 — 필드 이름은 공공데이터포털 규격 그대로 */
const 응답 = {
  bidNtceNo: '20260300123',
  bidNtceOrd: '01',
  bidNtceNm: '차세대 인공지능 데이터 플랫폼 구축 사업',
  ntceInsttNm: '한국전력공사',
  dminsttNm: '한국전력공사 디지털본부',
  asignBdgtAmt: '2,000,000,000',
  presmptPrce: '1,818,181,818',
  bssamt: '1,900,000,000',
  bidNtceDt: '20260301',
  opengDt: '2026041014 00',
  cntrctCnclsMthdNm: '협상에 의한 계약',
  sucsfbidMthdNm: '협상에 의한 계약',
  ntceKindNm: '일반공고',
}

function 가짜META(value: Record<string, unknown> | null): MetaReader {
  return {
    from() {
      return {
        select() {
          return {
            eq() {
              return { async single() { return { data: value === null ? null : { value }, error: null } } }
            },
          }
        },
      }
    },
  }
}

// 서비스 키

test('서비스 키를 DB 에서 읽는다', async () => {
  const key = await readServiceKey(가짜META({ [G2B_KEY_FIELD]: 'abc123' }))
  assert.equal(key, 'abc123')
})

test('키가 없으면 던지지 않고 null 이다', async () => {
  // 키가 없는 것은 오류가 아니라 아직 설정을 안 한 상태다
  assert.equal(await readServiceKey(가짜META({})), null)
  assert.equal(await readServiceKey(가짜META(null)), null)
  assert.equal(await readServiceKey(가짜META({ [G2B_KEY_FIELD]: '   ' })), null)
})

test('소스에 env 에서 키를 읽는 코드가 없다', () => {
  // env 에 있으면 바꿀 때마다 배포해야 하고, 배포 권한이 없는 사람은 못 바꾼다
  const client = readFileSync(path.join(HERE, 'client.ts'), 'utf8')
  const route = readFileSync(path.join(HERE, '../../../app/api/rfp/g2b/route.ts'), 'utf8')
  assert.equal(/process\.env/.test(client), false, 'client.ts 가 env 를 읽는다')
  assert.equal(/process\.env/.test(route), false, 'route.ts 가 env 를 읽는다')
  assert.match(client, /org_content/)
})

// 응답 꺼내기

test('건수가 1이면 배열이 아닌 응답도 읽는다', () => {
  // 이 차이를 안 다루면 「한 건짜리 공고만 조회 실패」라는 이상한 버그가 난다
  assert.equal(itemsOf({ response: { body: { items: [응답] } } })?.length, 1)
  assert.equal(itemsOf({ response: { body: { items: { item: 응답 } } } })?.length, 1)
  assert.equal(itemsOf({ response: { body: { items: { item: [응답, 응답] } } } })?.length, 2)
  assert.deepEqual(itemsOf({ response: { body: {} } }), [])
  assert.equal(itemsOf({}), null)
})

// 사상

test('응답이 rfp_sources 칸으로 사상된다', () => {
  const row = toSourceRow(응답)
  assert.equal(row.sourceSystem, 'g2b')
  assert.equal(row.noticeNo, '20260300123')
  assert.equal(row.noticeRound, 1)
  assert.equal(row.title, '차세대 인공지능 데이터 플랫폼 구축 사업')
  assert.equal(row.announcingAgency, '한국전력공사')
  assert.equal(row.demandAgency, '한국전력공사 디지털본부')
  assert.equal(row.noticeDate, '2026-03-01')
  assert.equal(row.contractMethod, '협상에 의한 계약')
})

test('금액 셋을 구분한다', () => {
  const row = toSourceRow(응답)
  // 하나로 접으면 제안 가격 계산이 통째로 틀린다
  assert.equal(row.budgetAmount, 2_000_000_000)
  assert.equal(row.estimatedPrice, 1_818_181_818)
  assert.equal(row.basePrice, 1_900_000_000)
})

test('원본을 통째로 남긴다', () => {
  const row = toSourceRow({ ...응답, 새로생긴필드: '값' })
  // 필드 이름은 말없이 바뀐다. 원본이 있어야 그때 확인할 수 있다
  assert.equal((row.raw as Record<string, unknown>).새로생긴필드, '값')
})

test('IT 사업과 긴급 공고를 알아본다', () => {
  assert.equal(looksItProject(응답), true)
  assert.equal(looksItProject({ bidNtceNm: '청사 옥상 방수 공사' }), false)
  assert.equal(looksItProject({}), null)
  assert.equal(looksUrgent({ bidNtceNm: '긴급 공고' }), true)
  assert.equal(looksUrgent({ ntceKindNm: '재공고' }), true)
  assert.equal(looksUrgent(응답), false)
})

test('금액 표기를 숫자로 편다', () => {
  assert.equal(toAmount('1,234,000'), 1_234_000)
  assert.equal(toAmount('1234000원'), 1_234_000)
  assert.equal(toAmount(1234), 1234)
  assert.equal(toAmount('금액 미정'), null)
  assert.equal(toAmount(null), null)
})

test('날짜 표기를 ISO 로 편다', () => {
  assert.equal(toIsoDate('20260301'), '2026-03-01')
  assert.equal(toIsoDate('2026-03-01 14:00'), '2026-03-01')
  assert.equal(toIsoDateTime('202604101400'), '2026-04-10T14:00:00+09:00')
  assert.equal(toIsoDateTime('2026-04-10 14:00'), '2026-04-10T14:00:00+09:00')
  assert.equal(toIsoDate('날짜 미정'), null)
})

test('DB 칸 이름으로 바꾼다', () => {
  const db = toDbColumns(toSourceRow(응답), 'org-1')
  assert.equal(db.org_id, 'org-1')
  assert.equal(db.notice_no, '20260300123')
  assert.equal(db.budget_amount, 2_000_000_000)
  assert.equal(db.is_it_project, true)
  assert.ok(db.raw)
})

// 실패 안내

test('실패마다 다음에 무엇을 하면 되는지 알려 준다', () => {
  // 「수집 실패」로만 두면 사용자는 시스템이 고장 난 줄 안다
  for (const reason of Object.keys(FALLBACK_GUIDE) as (keyof typeof FALLBACK_GUIDE)[]) {
    const r = fail(reason)
    assert.equal(r.ok, false)
    assert.ok(r.ok === false && r.fallback.length > 10, `${reason} 에 안내가 없다`)
    // 직접 올리면 된다는 것을 알려 줘야 한다
    assert.match(r.ok === false ? r.fallback : '', /올려|직접|다시 시도/)
  }
})

test('한도 초과와 없는 공고를 구분한다', async () => {
  const 한도 = await fetchNotice({
    noticeNo: 'x', serviceKey: 'k',
    fetchImpl: (async () => ({ ok: false, status: 429 }) as unknown as Response) as typeof fetch,
  })
  assert.equal(한도.ok === false && 한도.reason, 'rate_limited')

  const 없음 = await fetchNotice({
    noticeNo: 'x', serviceKey: 'k',
    fetchImpl: (async () => ({
      ok: true, status: 200,
      async json() { return { response: { body: { items: [] } } } },
    }) as unknown as Response) as typeof fetch,
  })
  assert.equal(없음.ok === false && 없음.reason, 'not_found')
})

test('응답 모양이 다르면 성공으로 넘기지 않는다', async () => {
  const r = await fetchNotice({
    noticeNo: 'x', serviceKey: 'k',
    fetchImpl: (async () => ({ ok: true, status: 200, async json() { return { 이상한: '모양' } } }) as unknown as Response) as typeof fetch,
  })
  assert.equal(r.ok === false && r.reason, 'bad_response')
})

test('공고를 찾으면 그 항목을 돌려준다', async () => {
  const r = await fetchNotice({
    noticeNo: '20260300123', round: 1, serviceKey: 'k',
    fetchImpl: (async (url) => {
      assert.match(String(url), /bidNtceNo=20260300123/)
      assert.match(String(url), /bidNtceOrd=1/)
      // 키를 주소에 실어 보낸다 — 공공데이터포털 규격이다
      assert.match(String(url), /serviceKey=k/)
      return { ok: true, status: 200, async json() { return { response: { body: { items: [응답] } } } } } as unknown as Response
    }) as typeof fetch,
  })
  assert.equal(r.ok, true)
  assert.equal(r.ok === true && (r.data as Record<string, unknown>).bidNtceNo, '20260300123')
})
