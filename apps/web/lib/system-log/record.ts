// lib/system-log/record.ts — 사건을 남기는 **유일한 통로**
//
// ## 쓰기 규칙 셋 — 로그가 장애를 키우면 안 된다
//
// ① **원래 요청을 막지 않는다.** 로그 저장이 실패해도 사용자 작업은 그대로 끝난다.
//    (감사·로깅이 사용자 저장을 막으면 안 된다 — 이 저장소가 이미 한 번 배운 것)
//    단 "막지 않는다"가 "기다리지 않는다"는 아니다 — 아래 참조.
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

/** 로그 한 줄 쓰는 데 이보다 오래 걸리면 포기한다 — 로그가 응답을 붙들면 안 된다 */
const WRITE_TIMEOUT_MS = 3_000

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

/** CrmError 는 코드로 사유를 이미 말한다 — 문장을 추측하지 않는다 */
function crmCodeOf(error: unknown): string | null {
  const c = (error as { code?: unknown })?.code
  return typeof c === 'string' && /^[A-Z_]{4,}$/.test(c) ? c : null
}

/**
 * 이건 실패가 아니다 — 남기면 진짜 실패가 그 안에 묻힌다.
 *
 * `Dynamic server usage` 는 Next 가 **정적 렌더를 포기하고 동적으로 가겠다**고
 * 스스로에게 던지는 제어 흐름 신호다. 사용자에게는 아무 일도 일어나지 않는다.
 * 실측(2026-08-21): 이 한 줄이 시스템 로그의 대부분을 차지했다.
 */
const NOT_A_FAILURE = [
  /Dynamic server usage/i,
  /DYNAMIC_SERVER_USAGE/,
  /NEXT_(REDIRECT|NOT_FOUND)/,
]

/**
 * 사건 하나를 남긴다. **절대 던지지 않는다.**
 *
 * `await` 하지 않아도 된다 — 부르는 쪽은 원래 하던 일을 계속하면 된다.
 */
export async function recordSystemEvent(input: RecordInput): Promise<void> {
  try {
    const rawMessage = messageOf(input.error)
    const message = maskSecrets(rawMessage)
    // 프레임워크가 자기에게 던지는 신호는 로그가 아니다
    if (NOT_A_FAILURE.some((re) => re.test(rawMessage))) return

    const reason = input.reason
      ?? classifySystemReason({
        crmCode: crmCodeOf(input.error),
        prismaCode: prismaCodeOf(input.error),
        message,
      })
    const fingerprint = fingerprintOf(input.source, reason, message)

    const { allow, suppressed } = passesThrottle(fingerprint, Date.now())
    if (!allow) return

    const narrate = {
      source: input.source, reason,
      feature: input.feature ?? null, route: input.route ?? null,
      hint: input.hint ?? null,
      // 사실 문장과 해결책이 같은 말을 하도록 — 안 넘기면 둘이 서로를 뒤집는다
      webSearch: input.context?.webSearch === true,
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
    const insert = (admin as any).from('system_events').insert({
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

    /**
     * DB 가 느려도 응답이 무한정 늦어지지 않게 — 못 남기는 것보다 늦게 답하는 게 낫지만, 한도는 있다.
     *
     * **반환된 오류를 반드시 본다.** supabase-js 는 실패를 던지지 않고 `{ error }` 로 돌려준다.
     * 처음엔 그 값을 안 봐서, `workspace_id` 타입이 안 맞아 모든 insert 가 거절당하는데도
     * 아무 소리 없이 0건이 쌓였다(v0.7.584 실측). **침묵을 없애려고 만든 것이 침묵했다.**
     */
    const raced = await Promise.race([
      insert,
      new Promise<{ error: { message: string } }>((resolve) =>
        setTimeout(() => resolve({ error: { message: `${WRITE_TIMEOUT_MS}ms 안에 못 썼습니다` } }), WRITE_TIMEOUT_MS)),
    ]) as { error?: { message?: string } | null }
    if (raced?.error) throw new Error(raced.error.message ?? '알 수 없는 오류')
  } catch (e) {
    /**
     * 여기서 던지면 **로그 때문에 사용자 작업이 실패한다.** 그건 로그를 남긴 목적을 뒤집는 일이다.
     * 표가 아직 없는 환경(마이그레이션 전)에서도 앱은 그대로 돌아야 한다.
     */
    console.error('[system-log] 기록 실패(사용자 작업은 계속됨)',
      e instanceof Error ? e.message : String(e))
  }
}

/**
 * **기다린다.** 이름은 남겨 두되(호출부 다수) 동작은 await 다.
 *
 * 처음엔 `void recordSystemEvent(input)` 이었다. 그런데 실측(v0.7.584)에서
 * AI 한도 실패가 **한 건도 안 남았다** — 라우트가 응답을 돌려주는 순간
 * 뒤에 남은 promise 가 그대로 사라졌기 때문이다.
 * 로그가 정작 필요한 순간에만 사라지는 구조라, 그건 로그가 없는 것과 같다.
 *
 * 대신 `WRITE_TIMEOUT_MS` 로 상한을 둔다 — DB 가 느려도 응답이 그만큼만 늦어진다.
 * 이 경로는 **이미 실패한 요청**이라 수백 ms 는 사용자 체감에 들어오지 않는다.
 */
export async function recordSystemEventAsync(input: RecordInput): Promise<void> {
  await recordSystemEvent(input)
}
