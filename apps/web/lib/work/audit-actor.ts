// audit-actor.ts — actor 규율 stub (SET LOCAL app.actor_id 배선 준비 지점 표식).
//
// 배경: 146_audit_backbone.sql의 fn_audit()는 `current_setting('app.actor_id', true)`를 먼저 읽고,
//   없으면 auth.uid()로 폴백한다. createClient()(사용자 세션)로 쓰는 경로는 auth.uid()가 곧 실제
//   행위자라 문제가 없다. 그러나 createAdminClient()(서비스롤)로 쓰는 경로는 auth.uid()가 없어
//   actor_id가 owner_id로 폴백된다 — 즉 "관리자/시스템이 대신 쓴 것"과 "본인이 쓴 것"이 감사로그에서
//   구분되지 않는다(예: lib/work/autolink-run.ts의 AI 자동연결, lib/weekly-report/draft-server.ts의
//   서버 생성 write).
//
// 왜 지금 실배선하지 않는가: createAdminClient()는 supabase-js의 일반 REST/PostgREST 경로라
//   커넥션이 요청마다 재사용/풀링되며 세션이 유지되지 않는다. `SET LOCAL`은 같은 트랜잭션(같은 커넥션) 내
//   에서만 유효한데, PostgREST 단발 호출에 SET LOCAL을 안전히 앞세우려면 RPC(SECURITY DEFINER 함수)나
//   트랜잭션 래핑이 필요하다 — 이는 신규 SQL 마이그레이션 없이는 불가능하다.
//   ⚠️ 이 작업 범위에서는 신규 SQL 함수/마이그레이션 추가가 금지되어 있으므로(CEO가 별도 처리),
//   본 파일은 best-effort no-op stub으로만 존재한다. 실패해도 무방 — 실패 시 fn_audit는 기존과
//   동일하게 auth.uid()→owner_id 폴백 동작을 유지한다(런타임 안전 우선, 회귀 없음).
//
// 실배선 시 필요 작업(TODO — 별도 마이그레이션 PR):
//   1) `CREATE FUNCTION set_config_actor(p_actor uuid) RETURNS void ... SET LOCAL app.actor_id = p_actor` (SECURITY DEFINER)
//   2) 서비스롤 write 직전 호출 지점 배선: lib/work/autolink-run.ts(runAutolink 등 AI write 직전),
//      lib/weekly-report/draft-server.ts(트랜잭션 저장 RPC 직전)
//   3) RPC가 없으면 이 함수는 조용히 실패하므로 먼저 마이그레이션 배포 후 배선한다.
//
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

/**
 * 서비스롤 write 직전, 실제 행위자(actor)를 감사 트리거에 알리기 위한 best-effort 훅.
 * 현재는 대응하는 RPC(`set_config_actor`)가 배포돼 있지 않으므로 항상 no-op에 가깝다.
 * RPC가 없거나 실패해도 절대 원 write를 막지 않는다(catch 후 무시).
 *
 * 호출 지점 표식(TODO):
 *   - lib/work/autolink-run.ts: runAutolink()가 daily_log_relations/work_entity_links를
 *     createAdminClient()로 생성하기 직전 → `await setAuditActor(db, actor)` (actor='ai' 또는 요청자 id)
 *   - lib/weekly-report/draft-server.ts: 트랜잭션 저장 RPC 호출 직전 → `await setAuditActor(admin, actorId)`
 */
export async function setAuditActor(supabase: Db, actorId: string | null | undefined): Promise<void> {
  if (!actorId) return
  try {
    // 대응 RPC 미배포 상태 — 존재하지 않으면 즉시 실패하고 catch에서 흡수된다.
    await supabase.rpc('set_config_actor', { p_actor: actorId })
  } catch {
    // no-op: RPC 부재/실패 시에도 원 write는 계속 진행(감사 actor는 auth.uid()/owner_id로 폴백).
  }
}
