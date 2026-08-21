// lib/system-log/record.ts — 사건을 남기는 **유일한 통로**
//
// ## 쓰기 규칙 셋 — 로그가 장애를 키우면 안 된다
//
// ① **원래 요청을 막지 않는다.** 로그 저장이 실패해도 사용자 작업은 그대로 끝난다.
//    (감사·로깅이 사용자 저장을 막으면 안 된다 — 이 저장소가 이미 한 번 배운 것)
// ② **같은 지문은 분당 상한.** 초당 수십 번 터지는 오류가 로그 쓰기로 DB 를 한 번 더 때리면
//    장애가 장애를 키운다. 상한을 넘으면 **버리는 게 아니라 세기만 한다.**
// ③ **키·토큰을 지운다.** 로그가 유출 경로가 되면 안 된다(`maskSecrets`).
//
// ## 왜 console.error 186곳을 안 고치나
//
// 고칠 수는 있지만 그 자체가 별건이고, 그 사이 아무것도 안 보인다.
// **길목 몇 개**만 잡으면 AI·CRM·잡·크론·클라이언트가 이미 덮인다 — 거기부터 연다.

import { classifySystemReason, severityOf, fingerprintOf, type SystemReason } from './reason.ts'
import { headlineOf, detailOf, truncateRaw, maskSecrets } from './narrate.ts'

export interface RecordInput {
  source: 'host_ai' | 'crm_ai' | 'crm_api' | 'host_api' | 'ci_job' | 'crm_job' | 'cron' | 'client'
  error: unknown
  feature?: string | null
  route?: string | null
  actorId?: string | null
  workspaceId?: string | null
  /** 사유를 이미 알고 있으면 넘긴다(호출부가 SSOT 판정을 갖고 있을 때) */
  reason?: SystemReason | null
  /** 지금 사용자가 이것 때문에 막혀 있는가 — 심각도가 달라진다 */
  blocksUser?: boolean
  /** 원문에 안 나오는 짧은 단서(모델 이름 등) */
  hint?: string | null
  context?: Record<string, unknown>
}

/**
 * 같은 지문을 분당 몇 번까지 쓸 것인가.
 *
 * 넘으면 **버리지 않고 센다** — 다음 쓰기의 context 에 "그 사이 N번 더" 로 실려 간다.
 * 조용히 버리면 화면의 횟수가 실제보다 작아지고, 관리자는 덜 심각한 일로 읽는다.
 */
const PER_FINGERPRINT_PER_MINUTE = 3
const WINDOW_MS = 60_000

interface Throttle { count: number; suppressed: number; windowStart: number }
const throttle = new Map<string, Throttle>()

/** 모듈 메모리라 배포·인스턴스마다 따로다. 그래도 폭주는 충분히 막는다(정확한 집계는 DB 가 한다). */
function passesThrottle(fingerprint: string, now: number): { allow: boolean; suppressed: number } {
  const cur = throttle.get(fingerprint)
  if (!cur || now - cur.windowStart >= WINDOW_MS) {
    throttle.set(fingerprint, { count: 1, suppressed: 0, windowStart: now })
    return { allow: true, suppressed: cur ? cur.suppressed : 0 }
  }
  if (cur.count < PER_FINGERPRINT_PER_MINUTE) {
    cur.count += 1
    const s = cur.suppressed
    cur.suppressed = 0
    return { allow: true, suppressed: s }
  }
  cur.suppressed += 1
  return { allow: false, suppressed: cur.suppressed }
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try { return JSON.stringify(error) } catch { return String(error) }
}

function prismaCodeOf(error: unknown): string | null {
  const c = (error as { code?: unknown })?.code
  return typeof c === 'string' && /^P\d{4}$/.test(c) ? c : null
}

/**
 * 사건 하나를 남긴다. **절대 던지지 않는다.**
 *
 * `await` 하지 않아도 된다 — 부르는 쪽은 원래 하던 일을 계속하면 된다.
 */
export async function recordSystemEvent(input: RecordInput): Promise<void> {
  try {
    const rawMessage = messageOf(input.error)
    const message = maskSecrets(rawMessage)
    const reason = input.reason
      ?? classifySystemReason({ prismaCode: prismaCodeOf(input.error), message })
    const fingerprint = fingerprintOf(input.source, reason, message)

    const { allow, suppressed } = passesThrottle(fingerprint, Date.now())
    if (!allow) return

    const narrate = {
      source: input.source, reason,
      feature: input.feature ?? null, route: input.route ?? null,
      hint: input.hint ?? null,
    }

    const stack = input.error instanceof Error && input.error.stack ? input.error.stack : rawMessage

    /**
     * 여기서 **늦게** 부른다. 위에서 import 하면 `lib/supabase/server.ts` 가 끌고 오는
     * `next/headers` 가 `gemini-call.ts` 같은 순수 모듈의 그래프에 섞인다 —
     * 그러면 요청 밖(잡·테스트)에서 그 모듈을 못 쓰게 된다.
     */
    const { createAdminClient } = await import('../supabase/server.ts')
    const admin = createAdminClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any).from('system_events').insert({
      fingerprint,
      source: input.source,
      severity: severityOf(reason, { blocksUser: input.blocksUser }),
      reason,
      feature: input.feature ?? null,
      route: input.route ?? null,
      actor_id: input.actorId ?? null,
      workspace_id: input.workspaceId ?? null,
      headline: headlineOf(narrate),
      detail: detailOf(narrate),
      raw: truncateRaw(maskSecrets(stack)),
      context: { ...(input.context ?? {}), ...(suppressed > 0 ? { suppressed } : {}) },
    })
  } catch (e) {
    /**
     * 여기서 던지면 **로그 때문에 사용자 작업이 실패한다.** 그건 로그를 남긴 목적을 뒤집는 일이다.
     * 표가 아직 없는 환경(마이그레이션 전)에서도 앱은 그대로 돌아야 한다.
     */
    console.warn('[system-log] 기록 실패(무시함)', e instanceof Error ? e.message : String(e))
  }
}

/** 기다리지 않고 남긴다 — 원래 요청의 응답 시간에 영향을 주지 않는다 */
export function recordSystemEventAsync(input: RecordInput): void {
  void recordSystemEvent(input)
}
