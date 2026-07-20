/**
 * DB/외부 오류 로깅 SSOT.
 *
 * 왜 필요한가: 목록 심층분석 서버액션들이 Postgres 에러 객체를 로그 없이 버리고
 * 고정 문자열만 반환해 왔다(예: '세션 저장 중 오류가 발생했습니다').
 * 그 결과 마이그 161 미적용으로 `column "command" does not exist`(42703)가
 * 매 요청마다 터지는데도 화면·서버 로그 어디에도 원인이 남지 않아,
 * 원인 규명에 DB 직접 조회가 필요했다.
 *
 * 규칙: 사용자에겐 행동 가능한 메시지를, 서버 로그엔 원문을. 둘을 분리한다.
 * 저장을 막지 않는다 — 로깅은 실패해도 호출부 흐름에 영향을 주지 않는다.
 */

interface PostgrestLikeError {
  message?: string
  code?: string
  details?: string
  hint?: string
}

/**
 * 오류 원문을 서버 로그에 남긴다. 반환값 없음 — 호출부는 사용자 메시지를 별도로 반환한다.
 *
 * @param scope 발생 위치 식별자 (예: 'saveAnalysisSession:sessions.insert')
 * @param err   Supabase/Postgrest 에러 객체 또는 임의 예외
 * @param extra 진단에 도움되는 부가 컨텍스트 (id 등 — 개인정보·원문 본문은 넣지 말 것)
 */
export function logDbError(scope: string, err: unknown, extra?: Record<string, unknown>): void {
  try {
    const e = (err ?? {}) as PostgrestLikeError
    console.error('[ai-chat/db-error]', {
      scope,
      code: e.code ?? null,
      message: e.message ?? String(err),
      details: e.details ?? null,
      hint: e.hint ?? null,
      ...(extra ?? {}),
    })
  } catch {
    // 로깅 실패가 호출부를 깨뜨리지 않는다
  }
}
