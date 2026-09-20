/**
 * 상세 화면의 «돌아갈 곳» (SSOT)
 *
 * **왜 필요한가**: 상세 화면들이 `back` 을 고정 주소로 적고 있다(`/crm/deals` 등).
 * 그래서 **딜 → 회사 → 뒤로** 를 누르면 딜이 아니라 회사 «목록»으로 간다 —
 * 사용자는 왔던 길로 돌아가려 했는데 낯선 화면에 떨어진다
 * (사용자 지적: 「뒤로가기 하면 이전에 있었던 화면으로 가는거 우리 정책인데
 *  방금 딜에서 뒤로 가기 했더니 이전 화면으로 안갔음」).
 *
 * **왜 브라우저 뒤로가기가 아닌가**: 화면의 「← 딜 목록」은 **어디로 가는지 이름이 적힌 링크**다.
 * 그것을 `history.back()` 으로 바꾸면 이름과 동작이 어긋난다(적힌 곳과 다른 데로 간다).
 * 그래서 **주소에 실어 온 곳**이 있으면 그리로, 없으면 목록으로 간다 — 이름도 함께 바뀐다.
 *
 * **왜 쿠키가 아닌가**: `lib/nav/return-to.ts` 의 쿠키 방식은 **외부로 나갔다 오는**
 * OAuth 왕복용이다. 화면 사이 이동은 주소만으로 충분하고, 주소면 링크를 공유해도 같은 흐름이 된다.
 */

import { sanitizeReturnTo, withReturnTo, RETURN_TO_PARAM } from '../../nav/return-to.ts'

export { RETURN_TO_PARAM }

export interface BackTarget {
  href: string
  label: string
}

/**
 * 돌아갈 곳을 정한다.
 *
 * `returnTo` 가 있으면 그리로(라벨도 그때 함께 실려 온 것을 쓴다), 없으면 기본 목록으로.
 * **검증은 `sanitizeReturnTo` 가 한다** — 절대 URL·`//`·CR/LF 를 막아 열린 리다이렉트를 차단한다.
 */
export function backTarget(
  params: { get(key: string): string | null },
  fallback: BackTarget,
): BackTarget {
  const raw = params.get(RETURN_TO_PARAM)
  const safe = raw ? sanitizeReturnTo(raw, '') : ''
  if (!safe) return fallback
  const label = params.get('returnLabel')?.trim()
  return { href: safe, label: label || '돌아가기' }
}

/**
 * **지금 이 화면**을 «돌아올 곳» 한 벌로 만든다.
 *
 * 쿼리를 함께 싣는 이유: 할 일 화면의 범위·검색어, 리포트의 기간·탭은 전부 주소에 있다.
 * 경로만 실으면 돌아왔을 때 조건이 초기화되고, 사용자는 방금 하던 추리기를 다시 해야 한다.
 *
 * 화면마다 `pathname + '?' + params` 를 손으로 이으면 어떤 화면은 `?` 가 두 번 붙고
 * 어떤 화면은 쿼리를 잃는다. 그래서 잇는 자리를 여기 하나로 둔다.
 */
export interface HereTarget {
  /** 쿼리까지 붙은 지금 주소 */
  path: string
  /** 돌아갈 곳의 이름. 도착 화면의 뒤로 단추에 그대로 적힌다 */
  label: string
}

export function hereNow(
  pathname: string,
  search: { toString(): string } | string | null | undefined,
  label: string,
): HereTarget {
  const q = typeof search === 'string' ? search : (search?.toString() ?? '')
  const clean = q.replace(/^\?/, '')
  return { path: clean ? `${pathname}?${clean}` : pathname, label }
}

/**
 * 다른 상세로 가는 링크에 «여기» 를 실어 준다.
 *
 * 라벨까지 함께 싣는 이유: 도착한 화면이 「← 딜 목록」이 아니라 **「← 수원시청」** 이라고
 * 말해야 사용자가 어디로 돌아가는지 안다. 주소만 실으면 도착 화면은 이름을 지어내야 한다.
 */
export function linkWithBack(href: string, here: HereTarget): string {
  const withPath = withReturnTo(href, here.path)
  const sep = withPath.includes('?') ? '&' : '?'
  return `${withPath}${sep}returnLabel=${encodeURIComponent(here.label)}`
}

/**
 * 상세 주소인가 — `/crm/<개체>/<id>` 모양.
 *
 * 서버가 만들어 준 주소를 화면이 그대로 그리는 자리가 있다(오늘 화면의 「살펴볼 것」).
 * 그 목록에는 상세 주소와 허브 주소가 섞여 오므로, 감싸기 전에 어느 쪽인지 가른다 —
 * 허브에까지 돌아올 곳을 실으면 주소만 길어지고 뒤로 단추가 없는 화면에 쓰이지도 않는다.
 */
export const DETAIL_HREF = /^\/crm\/(?:deals|companies|people|meetings|quotes)\/[^/?#]+$/

/** 상세 주소일 때만 «돌아올 곳»을 싣는다 */
export function withBackIfDetail(href: string, here: HereTarget): string {
  return DETAIL_HREF.test(href) ? linkWithBack(href, here) : href
}
