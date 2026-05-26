/**
 * PostgREST 필터 파라미터에 사용자 입력을 안전하게 삽입하기 위한 이스케이프 유틸.
 * .or() raw 문자열 보간 시 `,`, `(`, `)`, `*`, `\` 등이 쿼리 구조를 깨는 것을 방지.
 */
export function safeLike(input: string, maxLen = 100): string {
  return input
    .replace(/[,()*\\[\]]/g, '') // PostgREST or/filter 구조 파괴 문자 제거
    .replace(/\0/g, '')           // null byte 제거
    .slice(0, maxLen)
    .trim()
}

export function safeEq(input: string, maxLen = 100): string {
  return input
    .replace(/\0/g, '')
    .slice(0, maxLen)
    .trim()
}
