/**
 * 감사 로그 — 누가 무엇을 언제 했나
 *
 * ## 왜 따로 두나
 *
 * `rfp_audit_logs` 는 표도 정책도 이미 있는데 **쓰는 곳이 하나도 없었다**(실측 2026-09-30: 0행).
 * 넣는 코드를 창구마다 손으로 적게 두면 창구가 늘 때마다 빠지고, 빠진 사실은
 * 「그때 누가 지웠지」를 물을 때에야 드러난다. 그래서 넣는 모양을 한자리에 둔다.
 *
 * ## 왜 서비스롤을 안 쓰나
 *
 * 부르는 쪽의 사용자 클라이언트를 그대로 받는다. 넣기 정책(`rfp_audit_logs_append`)이
 * `org_id in rfp_my_orgs()` 를 검사하므로 **남의 조직 이름으로 기록을 심을 수 없다.**
 * 서비스롤로 쓰면 그 검사를 지나가고, 그러면 감사 로그가 감사의 대상이 된다.
 *
 * ## 왜 안 던지나
 *
 * 기록이 본 작업을 막으면 안 된다. 케이스를 만들었는데 감사 기록이 실패했다고 케이스를
 * 되돌리면, 사용자는 「만들기가 안 된다」를 겪고 우리는 이유를 모른다.
 * 유실 0 은 막는 것이 아니라 **떨어뜨리지 않는 것**으로 얻는다 — 실패를 돌려주고
 * 부르는 쪽이 남긴다. 조용히 넘어가지 않는다.
 */

/** 무슨 일이 있었나. 새 낱말을 지어내지 말고 여기 늘린다 */
export type AuditAction =
  | 'case.create'
  | 'case.delete'
  | 'case.restore'
  | 'profile.update'
  | 'rule.update'

export interface AuditEntry {
  orgId: string
  /** 누가. 기계가 한 일이면 null — 모르는 것을 지어내지 않는다 */
  userId: string | null
  action: AuditAction
  targetType: string | null
  targetId: string | null
  /** 무엇을. 비밀도 원문도 넣지 않는다 — 감사 로그는 읽히라고 있는 것이다 */
  detail?: Record<string, unknown>
}

export interface AuditResult {
  ok: boolean
  reason: string | null
}

export interface AuditDbClient {
  from(table: string): {
    insert(values: unknown): Promise<{ error: unknown }>
  }
}

/** uuid 로 안 생긴 값은 안 넣는다. 칸이 uuid 라 아무 글자나 넣으면 줄 전체가 죽는다 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function recordAudit(db: AuditDbClient, entry: AuditEntry): Promise<AuditResult> {
  try {
    const { error } = await db.from('rfp_audit_logs').insert({
      org_id: entry.orgId,
      user_id: entry.userId && UUID.test(entry.userId) ? entry.userId : null,
      action: entry.action,
      target_type: entry.targetType,
      target_id: entry.targetId && UUID.test(entry.targetId) ? entry.targetId : null,
      detail: entry.detail ?? {},
    })
    if (error) {
      const message = (error as { message?: unknown })?.message
      return { ok: false, reason: String(message ?? error) }
    }
    return { ok: true, reason: null }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}
