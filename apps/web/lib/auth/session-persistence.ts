/**
 * 로그인 상태 유지, 브라우저를 닫아도 로그인이 남는지 정한다.
 *
 * 왜 세 자리 모두에서 거르나: `@supabase/ssr` 은 인증 쿠키를 쓸 때마다 maxAge 를 **400일로 덮어쓴다**
 * (node_modules/@supabase/ssr/dist/main/cookies.js, cookieOptions 로 넘긴 값도 무시된다).
 * 토큰은 미들웨어·서버·브라우저 세 자리에서 갱신되므로 한 자리라도 안 거르면
 * 「유지 안 함」으로 들어온 세션이 첫 갱신(약 1시간) 때 400일짜리로 바뀐다.
 *
 * 기본은 유지다. 선호 쿠키가 없으면 지금까지처럼 400일, 기존 세션의 동작이 바뀌지 않는다.
 * 선호 쿠키는 비밀이 아니다. 브라우저 쪽도 읽어야 하므로 httpOnly 를 걸지 않는다.
 * 인증 판정에는 쓰이지 않고 쿠키 수명만 바꾼다.
 */

/** 값이 '1' 이면 이번 브라우저를 닫을 때까지만 로그인이 남는다 */
export const SESSION_ONLY_COOKIE = 'ax_session_only'

/** 정확히 '1' 일 때만 「유지 안 함」. 그 밖의 값(없음·변조)은 기본값인 유지로 본다 */
export function isSessionOnly(value: string | null | undefined): boolean {
  return value === '1'
}

/** 로그인 폼의 체크박스 값. 체크된 체크박스만 'on' 을 보낸다 */
export function wantsPersistentLogin(formValue: FormDataEntryValue | null): boolean {
  return formValue === 'on'
}

type CookieOptions = Record<string, unknown>

/**
 * 인증 쿠키를 쓸 옵션에서 수명을 뺀다 → 브라우저를 닫으면 사라지는 쿠키가 된다.
 * 지우기(maxAge 0)는 그대로 둔다. 빼면 지우려던 쿠키가 세션 쿠키로 되살아난다.
 */
export function applySessionPersistence<T extends CookieOptions | undefined>(
  options: T,
  sessionOnly: boolean,
): T {
  if (!sessionOnly || !options) return options
  if (options.maxAge === 0) return options
  return Object.fromEntries(
    Object.entries(options).filter(([key]) => key !== 'maxAge' && key !== 'expires'),
  ) as T
}
