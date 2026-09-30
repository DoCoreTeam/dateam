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
  lookbackDaysSince, DEFAULT_LOOKBACK_DAYS, MAX_LOOKBACK_DAYS,
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

// 훑는 폭과 크론 — I10

test('마지막 성공이 없으면 기본폭으로 간다', () => {
  assert.equal(lookbackDaysSince(null, Date.UTC(2026, 8, 30)), DEFAULT_LOOKBACK_DAYS)
  assert.equal(lookbackDaysSince(Number.NaN, Date.UTC(2026, 8, 30)), DEFAULT_LOOKBACK_DAYS)
})

test('밀린 만큼 폭이 늘어난다', () => {
  const now = Date.UTC(2026, 8, 30)
  const 하루 = 24 * 60 * 60 * 1000
  // 사흘 멈췄으면 사흘치를 되갚아야 한다. 폭이 늘 2일이면 가운데 하루가 영영 안 들어온다
  assert.equal(lookbackDaysSince(now - 3 * 하루, now), 4, '사흘 밀렸는데 사흘치를 안 훑는다')
  assert.equal(lookbackDaysSince(now - 10 * 하루, now), 11)
})

test('막 성공했어도 기본폭 아래로 안 내려간다', () => {
  const now = Date.UTC(2026, 8, 30)
  // 경계에 걸친 공고를 놓치면 그 한 건은 영영 안 들어온다. 겹쳐 훑는 비용은 중복 제거가 흡수한다
  assert.equal(lookbackDaysSince(now, now), DEFAULT_LOOKBACK_DAYS)
  assert.equal(lookbackDaysSince(now - 60_000, now), DEFAULT_LOOKBACK_DAYS)
})

test('시계가 뒤로 가도 폭이 음수가 되지 않는다', () => {
  const now = Date.UTC(2026, 8, 30)
  assert.equal(lookbackDaysSince(now + 5 * 24 * 60 * 60 * 1000, now), DEFAULT_LOOKBACK_DAYS)
})

test('아무리 밀려도 상한을 넘지 않는다', () => {
  const now = Date.UTC(2026, 8, 30)
  // 상한이 없으면 오래 꺼져 있던 저장소가 수백 일을 한 번에 훑으려 들고 그 호출은 타임아웃으로 죽는다.
  // 죽으면 마지막 성공이 또 안 올라가 다음에는 더 넓어진다
  assert.equal(lookbackDaysSince(now - 400 * 24 * 60 * 60 * 1000, now), MAX_LOOKBACK_DAYS)
  assert.ok(MAX_LOOKBACK_DAYS > DEFAULT_LOOKBACK_DAYS)
})

test('모으는 쪽이 고정폭을 안 쓴다', () => {
  const src = stripComments(readFileSync(new URL('../radar/collect.ts', import.meta.url), 'utf8'))
  assert.match(src, /lookbackDaysSince\s*\(/, '폭을 마지막 성공에서 안 센다')
  // 고정값을 그대로 넘기면 밀린 구간을 영영 못 되갚는다
  assert.doesNotMatch(src, /inquiryRange\([^)]*DEFAULT_LOOKBACK_DAYS/, '고정폭을 그대로 넘긴다')
})

test('vercel.json 의 RFP 일정이 실제 라우트를 가리킨다', () => {
  const vercel = JSON.parse(readFileSync(new URL('../../../vercel.json', import.meta.url), 'utf8')) as {
    crons: { path: string; schedule: string }[]
  }
  const rfp = vercel.crons.filter((c) => c.path.startsWith('/api/rfp/'))
  assert.ok(rfp.length >= 2, `RFP 일정이 ${rfp.length}개다 — 워커와 레이더 둘이 있어야 한다`)

  for (const c of rfp) {
    // 경로가 라우트와 안 맞으면 크론이 404 를 두드리고 아무도 모른다
    const file = new URL(`../../../app${c.path}/route.ts`, import.meta.url)
    assert.ok(readFileSync(file, 'utf8').length > 0, `${c.path} 에 라우트 파일이 없다`)
    assert.match(c.schedule, /^[\d*/,\- ]+$/, `${c.path} 의 일정이 크론 모양이 아니다`)
  }
  assert.ok(rfp.some((c) => c.path === '/api/rfp/worker/tick'), '워커 일정이 없다')
  assert.ok(rfp.some((c) => c.path === '/api/rfp/radar'), '레이더 일정이 없다')
})

test('크론이 부르는 창구가 GET 을 훑기로 받는다', () => {
  // Vercel 크론은 GET 으로 온다. 훑기를 POST 에만 두면 목록만 읽고 돌아간다 —
  // 이 저장소는 크론이 POST 에만 열린 창구를 여덟 시간 두드린 적이 있다.
  //
  // **GET 의 몸통을 따로 떼어 본다.** 파일 어딘가에 isMachineCall 이 있는 것으로는 모자란다 —
  // 처음 쓴 가드가 그래서 통과했다(GET 의 넘김을 지웠는데 POST 쪽 호출을 보고 초록이었다)
  for (const path of ['../../../app/api/rfp/radar/route.ts', '../../../app/api/rfp/worker/tick/route.ts']) {
    const src = stripComments(readFileSync(new URL(path, import.meta.url), 'utf8'))
    const body = reachableFromGet(src)
    assert.ok(body !== null, `${path} 에 GET 이 없다`)
    assert.match(body, /isMachineCall\s*\(/, `${path} 의 GET 이 기계 호출을 안 가린다`)
  }
})

/**
 * GET 이 실제로 닿는 코드.
 *
 * GET 이 한 줄로 다른 함수에 넘기는 모양(`return tick(req)`)이 흔하다. 그 한 줄만 보고
 * 「기계 호출을 안 가린다」고 하면 멀쩡한 코드를 빨갛게 만든다 — 실제로 그랬다.
 * 그래서 **한 번 따라간다.** 이름이 아니라 값이 어디로 가는지를 보는 것과 같은 이유다.
 */
function reachableFromGet(src: string): string | null {
  const body = functionBody(src, 'GET')
  if (body === null) return null
  const delegate = body.match(/return\s+([A-Za-z_$][\w$]*)\s*\(/)
  if (!delegate) return body
  return body + (functionBody(src, delegate[1]) ?? '')
}

/** 이름 붙은 함수의 몸통을 중괄호 짝으로 떼어 낸다 */
function functionBody(src: string, name: string): string | null {
  const at = src.search(new RegExp(`function\\s+${name}\\s*\\(`))
  if (at < 0) return null
  const open = src.indexOf('{', at)
  if (open < 0) return null
  let depth = 0
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}') {
      depth -= 1
      if (depth === 0) return src.slice(open + 1, i)
    }
  }
  return null
}

test('레이더가 기계 갈래에서만 서비스롤을 쓴다', () => {
  const src = stripComments(readFileSync(new URL('../../../app/api/rfp/radar/route.ts', import.meta.url), 'utf8'))
  // 서비스롤은 RLS 를 통째로 지나간다. 그 위의 사람 확인이 기계 토큰이어야 한다
  assert.match(src, /machine\s*\?\s*createAdminClient\(\)/, '사람 경로에서도 서비스롤을 쓴다')
  assert.match(src, /machineAuthUnconfigured\s*\(/, '토큰이 아예 없을 때를 안 가린다')
  assert.match(src, /requireMemberApi\s*\(/, '사람 인증 갈래가 사라졌다')
})

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}
