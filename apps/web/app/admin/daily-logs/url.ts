/**
 * 모니터링 화면 URL 빌더 — 기존 searchParams 보존 + 일부 덮어쓰기.
 * 빈 문자열/undefined 값은 파라미터에서 제거(깨끗한 공유 URL).
 */
const ROUTE = '/admin/daily-logs'

export function buildUrl(
  base: Record<string, string>,
  overrides: Record<string, string | undefined>,
): string {
  const merged: Record<string, string | undefined> = { ...base, ...overrides }
  const sp = new URLSearchParams()
  for (const [key, value] of Object.entries(merged)) {
    if (value !== undefined && value !== '') sp.set(key, value)
  }
  const qs = sp.toString()
  return qs ? `${ROUTE}?${qs}` : ROUTE
}
