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

/** uuid 칼럼에 넣을 값인가, 아니면 PostgREST 가 22P02 로 실패해 500 이 된다 (P0170 I05) */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(input: unknown): input is string {
  return typeof input === 'string' && UUID.test(input)
}
