import 'server-only'

/**
 * 무장 상태 — 읽고 쓰는 자리
 *
 * 판정은 `arming-policy.ts`·`disarm.ts` 가 한다. 여기는 DB 왕복과 기록만 맡는다.
 *
 * **무장은 사람만 한다.** 이 모듈의 무장 함수는 `actorUserId` 를 필수로 받고,
 * 없으면 아무것도 안 한다 — DB 검사 제약이 한 번 더 막지만, 여기서 먼저 막아야
 * 「왜 안 됐나」에 답할 수 있다.
 */

import { createAdminClient } from '@/lib/supabase/server'
import {
  checkArming, isArmed, expiryFrom, mayDisarm,
  type ArmContext, type ArmEnv, type ArmState, type ArmDecision,
} from './arming-policy.ts'
import { shouldDisarm, disarmReason, type DisarmContext } from './disarm.ts'

export interface StoredArming extends ArmState {
  env: ArmEnv
  disarmReason: string | null
}

export async function readArming(env: ArmEnv): Promise<StoredArming> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from('trading_arming')
    .select('env, armed, expires_at, armed_by, disarm_reason')
    .eq('env', env)
    .maybeSingle()
  if (error) throw new Error(`무장 상태를 읽지 못했습니다: ${error.message}`)
  if (!data) {
    /**
     * 행이 없으면 **해제**다. 「모르니까 무장」은 절대 없다 —
     * 읽기가 실패했을 때 돈이 나가는 쪽으로 기울면 안 된다.
     */
    return { env, armed: false, expiresAt: new Date(0), armedBy: null, disarmReason: 'no_row' }
  }
  return {
    env,
    armed: data.armed === true,
    expiresAt: new Date(data.expires_at),
    armedBy: (data.armed_by as string | null) ?? null,
    disarmReason: (data.disarm_reason as string | null) ?? null,
  }
}

/** 지금 주문을 낼 수 있나. 만료까지 본다 */
export async function armedNow(env: ArmEnv, now: Date): Promise<boolean> {
  return isArmed(await readArming(env), now)
}

export type ArmResult =
  | { armed: true; expiresAt: Date }
  | { armed: false; reason: string; userMessage: string }

export interface ArmInput {
  env: ArmEnv
  /** **필수다.** 사람만 무장한다 (§15.3 실행 방식) */
  actorUserId: string
  ctx: ArmContext
  now: Date
  hours: number
}

/** 무장한다. 관문을 지나고 사람이 눌러야 한다 */
export async function arm(input: ArmInput): Promise<ArmResult> {
  if (!input.actorUserId) {
    return { armed: false, reason: 'no_actor', userMessage: '사람만 무장할 수 있습니다' }
  }
  const decision: ArmDecision = checkArming(input.ctx)
  if (!decision.allowed) {
    return {
      armed: false,
      reason: decision.blocks.map((b) => b.check).join('+'),
      userMessage: decision.blocks.map((b) => b.userMessage).join(' · '),
    }
  }

  const expiresAt = expiryFrom(input.now, input.hours)
  const snapshot = { checkedAt: input.now.toISOString(), env: input.env, ctx: input.ctx }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { error } = await admin.from('trading_arming').upsert({
    env: input.env,
    armed: true,
    expires_at: expiresAt.toISOString(),
    armed_by: input.actorUserId,
    armed_at: input.now.toISOString(),
    gate_snapshot: snapshot,
    disarm_reason: null,
    updated_at: input.now.toISOString(),
  }, { onConflict: 'env' })
  if (error) throw new Error(`무장하지 못했습니다: ${error.message}`)

  await logArmingEvent({
    env: input.env, action: 'arm', actorKind: 'human', actorUserId: input.actorUserId,
    reason: 'human_armed', snapshot,
  })
  return { armed: true, expiresAt }
}

/**
 * 푼다. **언제나 된다.**
 *
 * 장치가 풀 때는 `actorUserId` 가 없다 — DB 검사 제약이 「무장은 사람만」을 지키고
 * 해제는 장치도 할 수 있게 둔다.
 */
export async function disarm(input: {
  env: ArmEnv
  reason: string
  actorUserId: string | null
  now: Date
}): Promise<void> {
  mayDisarm()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { error } = await admin.from('trading_arming').upsert({
    env: input.env,
    armed: false,
    // 만료도 과거로 민다. 「무장 아님」이 두 겹으로 참이 된다
    expires_at: new Date(input.now.getTime() - 1000).toISOString(),
    armed_by: null,
    armed_at: null,
    disarm_reason: input.reason.slice(0, 300),
    updated_at: input.now.toISOString(),
  }, { onConflict: 'env' })
  if (error) throw new Error(`해제하지 못했습니다: ${error.message}`)

  await logArmingEvent({
    env: input.env,
    action: 'disarm',
    actorKind: input.actorUserId ? 'human' : 'system',
    actorUserId: input.actorUserId,
    reason: input.reason,
    snapshot: {},
  })
}

/**
 * 멈추는 장치를 재고 걸리면 푼다.
 *
 * 매분 부른다. 무장은 하루를 가는데 그 사이에 관문이 깨질 수 있다 —
 * 무장할 때 한 번만 재면 「아침에 멀쩡했으니 하루 종일 멀쩡하다」가 된다.
 */
export async function enforceDisarm(env: ArmEnv, ctx: DisarmContext): Promise<string> {
  const hits = shouldDisarm(ctx)
  if (hits.length === 0) return 'armed'
  const reason = disarmReason(hits)
  await disarm({ env, reason, actorUserId: null, now: ctx.now })
  return `disarmed:${reason}`
}

async function logArmingEvent(input: {
  env: ArmEnv
  action: 'arm' | 'disarm'
  actorKind: 'human' | 'system'
  actorUserId: string | null
  reason: string
  snapshot: Record<string, unknown>
}): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { error } = await admin.from('trading_arming_events').insert({
    env: input.env,
    action: input.action,
    actor_kind: input.actorKind,
    actor_user_id: input.actorUserId,
    reason: input.reason.slice(0, 300),
    gate_snapshot: input.snapshot,
  })
  if (error) throw new Error(`무장 기록을 적지 못했습니다: ${error.message}`)
}
