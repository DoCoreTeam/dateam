/**
 * 나라장터 조달정보 연동 (설계서 3.2.3)
 *
 * ## 서비스 키를 env 에 안 두는 이유
 *
 * 키가 env 에 있으면 **바꿀 때마다 배포**해야 하고, 배포 권한이 없는 사람은 못 바꾼다.
 * 공공데이터포털 키는 신청·갱신·한도가 사람 손에 달린 값이라 화면에서 고칠 수 있어야 한다.
 * (저장소 관례: `org_content` 의 `META` 에 둔다 — Vercel 토큰과 같은 자리)
 *
 * ## 첨부를 못 받으면 그렇게 말한다
 *
 * 나라장터 첨부는 세션·리퍼러·용량 제한으로 자주 막힌다. 그때 «수집 실패» 로만 두면
 * 사용자는 시스템이 고장 난 줄 안다. **직접 올리면 된다**는 것을 알려 줘야 한다.
 */

export const G2B_BASE = 'https://apis.data.go.kr/1230000/ad/BidPublicInfoService'

/** META 안에서 키를 찾는 이름 — 화면이 이 이름으로 저장한다 */
export const G2B_KEY_FIELD = 'g2bServiceKey'

export interface MetaReader {
  from(table: string): {
    select(cols: string): {
      eq(col: string, v: string): { single(): Promise<{ data: unknown; error: unknown }> }
    }
  }
}

/**
 * 서비스 키를 DB 에서 읽는다.
 *
 * 없으면 **null 을 돌려준다.** 던지지 않는 이유: 키가 없는 것은 오류가 아니라
 * 아직 설정을 안 한 상태이고, 화면은 그때 「연동 설정하기」를 보여 줘야 한다.
 */
export async function readServiceKey(db: MetaReader): Promise<string | null> {
  const { data } = await db.from('org_content').select('value').eq('key', 'META').single()
  const meta = ((data as { value?: unknown })?.value ?? {}) as Record<string, unknown>
  const key = meta[G2B_KEY_FIELD]
  return typeof key === 'string' && key.trim() ? key.trim() : null
}

export type G2bFetchReason =
  | 'no_service_key'
  | 'not_found'
  | 'rate_limited'
  | 'upstream_error'
  | 'timeout'
  | 'bad_response'

export type G2bResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: G2bFetchReason; detail: string; /** 사용자에게 보여 줄 다음 행동 */ fallback: string }

/** 사유마다 다음에 무엇을 하면 되는지 — 「실패」만 보여 주면 사용자가 할 일이 없다 */
export const FALLBACK_GUIDE: Record<G2bFetchReason, string> = {
  no_service_key: '나라장터 연동 키가 없습니다. 설정에서 키를 넣거나 첨부를 직접 올려 주세요',
  not_found: '해당 공고를 찾지 못했습니다. 공고번호와 차수를 확인하거나 첨부를 직접 올려 주세요',
  rate_limited: '나라장터 호출 한도를 넘었습니다. 잠시 뒤 다시 시도하거나 첨부를 직접 올려 주세요',
  upstream_error: '나라장터가 응답하지 않습니다. 첨부를 직접 올리면 그대로 분석됩니다',
  timeout: '나라장터 응답이 늦습니다. 첨부를 직접 올리면 그대로 분석됩니다',
  bad_response: '나라장터 응답을 읽지 못했습니다. 첨부를 직접 올려 주세요',
}

export function fail<T>(reason: G2bFetchReason, detail = ''): G2bResult<T> {
  return { ok: false, reason, detail, fallback: FALLBACK_GUIDE[reason] }
}

export interface FetchNoticeInput {
  noticeNo: string
  round?: number
  serviceKey: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

/** 공고 한 건을 가져온다 */
export async function fetchNotice(input: FetchNoticeInput): Promise<G2bResult<Record<string, unknown>>> {
  const f = input.fetchImpl ?? fetch
  const url = new URL(`${G2B_BASE}/getBidPblancListInfoServcPPSSrch`)
  url.searchParams.set('serviceKey', input.serviceKey)
  url.searchParams.set('type', 'json')
  url.searchParams.set('numOfRows', '10')
  url.searchParams.set('pageNo', '1')
  url.searchParams.set('bidNtceNo', input.noticeNo)
  if (input.round !== undefined) url.searchParams.set('bidNtceOrd', String(input.round))

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 15_000)
  try {
    const res = await f(url.toString(), { signal: controller.signal })
    if (res.status === 429) return fail('rate_limited', '429')
    if (!res.ok) return fail('upstream_error', String(res.status))

    const json = await res.json() as G2bEnvelope
    const items = itemsOf(json)
    if (items === null) return fail('bad_response', '응답 모양이 다르다')
    if (items.length === 0) return fail('not_found', `${input.noticeNo}`)
    return { ok: true, data: items[0] }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return fail(message.includes('abort') ? 'timeout' : 'upstream_error', message)
  } finally {
    clearTimeout(timer)
  }
}

interface G2bEnvelope {
  response?: {
    header?: { resultCode?: string; resultMsg?: string }
    body?: { items?: unknown; totalCount?: number }
  }
}

/**
 * 공공데이터포털 응답에서 항목을 꺼낸다.
 *
 * `items` 가 배열일 때도 있고 객체 하나일 때도 있다 — **건수가 1이면 배열이 아니다.**
 * 이 차이를 안 다루면 「한 건짜리 공고만 조회 실패」라는 이상한 버그가 난다.
 */
export function itemsOf(json: G2bEnvelope): Record<string, unknown>[] | null {
  const body = json?.response?.body
  if (!body) return null
  const items = body.items
  if (items === undefined || items === null) return []
  if (Array.isArray(items)) return items as Record<string, unknown>[]
  if (typeof items === 'object') {
    const inner = (items as { item?: unknown }).item
    if (Array.isArray(inner)) return inner as Record<string, unknown>[]
    if (inner && typeof inner === 'object') return [inner as Record<string, unknown>]
    return [items as Record<string, unknown>]
  }
  return null
}
