import 'server-only'
import { createAdminClient } from '@/lib/supabase/server'

/**
 * 관리자가 구성원에게 한 일을 남긴다
 *
 * **왜 트리거로 안 하나**: 구성원 표에도 범용 감사 트리거를 붙였다(마이그 265).
 * 그런데 트리거는 「무엇이 바뀌었나」만 안다. 구성원 관리는 **남의 계정을 고치는 일**이라
 * 서비스 권한으로 쓰고, 그 경로에는 `auth.uid()` 가 없어 **누가 했는지가 비어 있다.**
 *
 * 그리고 칼럼 비교만으로는 **의도**가 안 보인다. `role: admin → member` 는 강등인지
 * 퇴사 처리의 일부인지 구분되지 않고, 2단계 인증 해제는 구성원 표를 건드리지도 않는다.
 *
 * 그래서 둘을 나눠 맡긴다.
 *   트리거 → 무엇이 바뀌었나 (어떤 경로로 바뀌든, 앱 밖에서 바뀌어도)
 *   이 파일 → 누가 왜 했나
 *
 * **기록이 저장을 막지 않는다.** 남기다 실패해도 관리자의 일은 그대로 끝난다
 * (146 의 fn_audit 와 같은 규율). 대신 실패 사실을 서버 로그에 남긴다.
 */

// 이름과 문구는 admin-audit-labels 에 있다 (테스트가 읽을 수 있게 server-only 밖으로 뺐다)
export { ADMIN_ACTION_LABEL, type AdminAction } from './admin-audit-labels.ts'
import type { AdminAction } from './admin-audit-labels.ts'

export interface AdminAuditInput {
  /** 누가 했나 */
  actorId: string
  /** 누구에게 했나. 초대처럼 대상 계정이 아직 없으면 null */
  targetId: string | null
  action: AdminAction
  /** 사람이 읽을 한 줄. 목록에 그대로 뜬다 */
  title: string
  before?: unknown
  after?: unknown
  /** 실패한 시도도 남긴다 — 막힌 시도가 성공한 일보다 중요할 때가 있다 */
  status?: 'success' | 'failure'
  errorDetail?: string
}

export async function logAdminAction(input: AdminAuditInput): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any
    const { error } = await admin.from('activity_log').insert({
      module: 'admin_users',
      entity_id: input.targetId,
      user_id: input.targetId ?? input.actorId,
      actor_id: input.actorId,
      action: input.action,
      status: input.status ?? 'success',
      title: input.title,
      before_snapshot: input.before ?? null,
      after_snapshot: input.after ?? null,
      // 이 칼럼은 jsonb 다. 문자열을 그대로 넣으면 «Token ... is invalid» 로 죽는다(실측)
      error_detail: input.errorDetail ? { message: input.errorDetail } : null,
    })
    if (error) console.error('[admin-audit] 기록 실패', input.action, error.message ?? error)
  } catch (e) {
    console.error('[admin-audit] 기록 실패', input.action, e)
  }
}
