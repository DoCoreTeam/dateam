/**
 * AI 예산 서비스 (dacrm T1-07, 구현명세 §3.6)
 *
 * 이 파일이 막는 사고는 하나다: **모르는 사이에 돈이 나가는 것.**
 *
 * 규칙(명세 3.4·3.6):
 *   · spent < limit 정상 · 80% 도달 시 경보 1회 · 100% 도달 시 AI 소프트 차단
 *   · 소프트 차단이란 **AI 기능만** 멈추는 것이다. 코어 CRM(회사·인물·딜·태스크)은 계속 돌아간다.
 *     예산이 떨어졌다고 영업이 멈추면 그건 더 큰 손해다(DI-15).
 *   · 상한을 올리면 **즉시** 풀린다. 다음 배치를 기다리게 하면 그 사이 일이 멈춘다.
 *
 * 잠금이 왜 필요한가(DI-14): 잔여 1회분에 요청 두 개가 동시에 오면,
 * 잠그지 않은 두 트랜잭션은 같은 잔액을 읽고 **둘 다 통과시킨다.**
 * 넘긴 사실은 청구서로만 알게 된다. 그래서 확인과 차감이 한 트랜잭션이고, 조회는 FOR UPDATE 다.
 */

import type { Prisma } from '@prisma/client'
import { withCrmTx } from '../db/tx.ts'
import { writeAudit } from '../db/audit.ts'
import { CrmError } from '../domain/errors.ts'
import { evaluateBudget, BUDGET_ALERT_RATIO, type BudgetVerdict } from '../domain/state-machines.ts'
import { kstParts } from '../../datetime/kst.ts'

export interface BudgetRow {
  id: string
  month: string
  limitMinorUsd: bigint
  spentMinorUsd: bigint
  alertSentAt: Date | null
  blockedAt: Date | null
}

/**
 * 이번 달 키.
 *
 * KST 기준인 이유: 사용자가 "8월 예산"이라고 할 때의 8월은 한국 달력이다.
 * UTC 로 자르면 매월 1일 오전 9시 전까지 지난달 예산에 잡힌다.
 */
export function currentMonthKey(now: Date = new Date()): string {
  const p = kstParts(now.toISOString())
  if (!p) throw new CrmError('VALIDATION_FAILED', '기준 시각이 올바르지 않습니다.')
  return `${p.year}-${String(p.month).padStart(2, '0')}`
}

/** 예산을 아직 정하지 않은 워크스페이스의 기본 상한 (센트) — $50 */
export const DEFAULT_LIMIT_MINOR_USD = BigInt(5000)

/**
 * 확인 + 차감을 한 번에 한다.
 *
 * 나눠 두면(확인 → 호출 → 차감) 그 사이에 다른 요청이 같은 잔액을 보고 통과한다.
 * 그래서 **호출 직전에 예상 비용만큼 먼저 잡아 두고**, 실제 비용이 나오면 정산한다.
 * 은행이 카드 승인에 하는 것과 같다 — 승인 시점에 잡고 나중에 정산.
 */
export interface ReserveResult {
  budget: BudgetRow
  verdict: BudgetVerdict
}

/**
 * 잠금 조회 — 이 한 줄이 DI-14 의 전부다.
 *
 * Prisma 로는 FOR UPDATE 를 걸 수 없어 raw 로 간다.
 * 행이 없으면 만들고 다시 잠근다(동시 생성은 유니크 제약이 한쪽만 통과시킨다).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function lockMonth(tx: any, workspaceId: string, month: string): Promise<BudgetRow> {
  const rows = await tx.$queryRaw<BudgetRow[]>`
    SELECT id, month, "limitMinorUsd", "spentMinorUsd", "alertSentAt", "blockedAt"
    FROM crm_ai_budget
    WHERE "workspaceId" = ${workspaceId} AND month = ${month}
    FOR UPDATE
  `
  if (rows.length > 0) return rows[0]

  await tx.crmAiBudget.create({
    data: { month, limitMinorUsd: DEFAULT_LIMIT_MINOR_USD, spentMinorUsd: BigInt(0) },
  })
  const again = await tx.$queryRaw<BudgetRow[]>`
    SELECT id, month, "limitMinorUsd", "spentMinorUsd", "alertSentAt", "blockedAt"
    FROM crm_ai_budget
    WHERE "workspaceId" = ${workspaceId} AND month = ${month}
    FOR UPDATE
  `
  return again[0]
}

/**
 * 상한 0 = "이번 달 AI 를 쓰지 않겠다".
 *
 * 판정 함수(evaluateBudget)는 상한 0·사용 0 을 아직 안 넘은 것으로 본다 — 산술로는 맞다.
 * 하지만 **첫 호출부터 막힌다.** 화면이 그 사이를 "정상"이라고 말하면
 * 사용자는 왜 안 되는지 모른 채 같은 버튼을 계속 누른다(실브라우저에서 잡음).
 * 그래서 "꺼짐"을 별도 사실로 내보낸다 — 화면이 이 판정을 다시 만들지 않게.
 */
export function isAiDisabled(limitMinorUsd: bigint): boolean {
  return limitMinorUsd === BigInt(0)
}

/** 사용자에게 보여줄 차단 문구 (명세 3.6-2 원문) */
export const BUDGET_BLOCKED_MESSAGE =
  'AI 예산이 소진되어 이번 달 AI 기능이 중지되었습니다. 설정에서 상한을 조정할 수 있습니다.'

/**
 * AI 호출 직전에 부른다. 차단 상태면 던지고, 아니면 예상 비용을 미리 잡는다.
 *
 * 예상 비용을 0 으로 부르면 "확인만" 한다 — 비용을 모르는 호출(mock 등)이 그렇다.
 */
export async function reserveBudget(
  workspaceId: string,
  /** 안 주면 최소 1센트 — 0 으로 두면 상한 0("AI 끄기")을 지나간다 */
  estimateMinorUsd: bigint = BigInt(1),
  now: Date = new Date(),
): Promise<ReserveResult> {
  const month = currentMonthKey(now)

  /**
   * 판정과 기록을 **나눠서** 한다.
   *
   * 처음엔 한 트랜잭션에서 차단을 기록하고 바로 던졌는데,
   * throw 가 그 트랜잭션을 통째로 되돌려서 **차단 기록이 안 남았다**(실측).
   * 그래서 판정만 트랜잭션 안에서 하고, 차단 표시는 밖에서 따로 커밋한다.
   */
  const outcome = await withCrmTx(workspaceId, async (tx) => {
    const b = await lockMonth(tx, workspaceId, month)

    const before = evaluateBudget({
      limitMinorUsd: b.limitMinorUsd, spentMinorUsd: b.spentMinorUsd,
      alertSentAt: b.alertSentAt, blockedAt: b.blockedAt,
    })
    if (before.level === 'blocked') {
      return { blocked: true as const, id: b.id, hadBlockedAt: Boolean(b.blockedAt) }
    }

    const nextSpent = b.spentMinorUsd + estimateMinorUsd
    const after = evaluateBudget({
      limitMinorUsd: b.limitMinorUsd, spentMinorUsd: nextSpent,
      alertSentAt: b.alertSentAt, blockedAt: b.blockedAt,
    })

    /**
     * 선점하면 한도를 넘는 호출은 **보내지 않는다.**
     *
     * 잔여 10 인데 예상 50 짜리를 통과시키면 그 한 번으로 40 을 넘긴다.
     * "넘으면 다음부터 막는다"는 한도가 아니라 사후 통보다.
     * 다만 선점분을 실제로 잡아 두지는 않는다 — 안 나간 호출의 돈을 쓴 것으로 세면 안 된다.
     */
    if (after.level === 'blocked' && estimateMinorUsd > BigInt(0)) {
      return { blocked: true as const, id: b.id, hadBlockedAt: Boolean(b.blockedAt) }
    }

    const data: Prisma.CrmAiBudgetUpdateManyMutationInput = { spentMinorUsd: nextSpent }
    if (after.shouldSendAlert) data.alertSentAt = now
    if (after.shouldBlock) data.blockedAt = now

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tx as any).crmAiBudget.updateMany({ where: { id: b.id }, data })

    return {
      blocked: false as const,
      result: {
        budget: { ...b, spentMinorUsd: nextSpent, blockedAt: after.shouldBlock ? now : b.blockedAt },
        verdict: after,
      },
    }
  })

  if (outcome.blocked) {
    // 차단 사실은 남긴다 — 언제부터 막혔는지 못 답하면 사용자는 "갑자기 안 된다"만 겪는다
    if (!outcome.hadBlockedAt) {
      await withCrmTx(workspaceId, async (tx) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (tx as any).crmAiBudget.updateMany({ where: { id: outcome.id }, data: { blockedAt: now } })
      })
    }
    throw new CrmError('BUDGET_BLOCKED', BUDGET_BLOCKED_MESSAGE)
  }

  return outcome.result
}

/**
 * 실제 비용으로 정산한다.
 *
 * 미리 잡은 값(estimate)과 실제가 다르면 차액만 더하거나 뺀다.
 * 뺄 때 음수로 내려가지 않게 막는 이유: 정산이 두 번 들어와도 잔액이 늘어나면 안 된다.
 */
export async function settleBudget(
  workspaceId: string,
  reservedMinorUsd: bigint,
  actualMinorUsd: bigint,
  now: Date = new Date(),
): Promise<BudgetRow> {
  const month = currentMonthKey(now)
  const delta = actualMinorUsd - reservedMinorUsd

  return withCrmTx(workspaceId, async (tx) => {
    const b = await lockMonth(tx, workspaceId, month)
    const next = b.spentMinorUsd + delta
    const ZERO = BigInt(0)
    const spent = next < ZERO ? ZERO : next

    const after = evaluateBudget({
      limitMinorUsd: b.limitMinorUsd, spentMinorUsd: spent,
      alertSentAt: b.alertSentAt, blockedAt: b.blockedAt,
    })

    const data: Prisma.CrmAiBudgetUpdateManyMutationInput = { spentMinorUsd: spent }
    if (after.shouldSendAlert) data.alertSentAt = now
    if (after.shouldBlock) data.blockedAt = now

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tx as any).crmAiBudget.updateMany({ where: { id: b.id }, data })
    return { ...b, spentMinorUsd: spent }
  })
}

/**
 * 상한을 바꾼다. 올려서 여유가 생기면 **즉시** 차단을 푼다(명세 3.6-4).
 *
 * 다음 호출 때 풀리게 두면, 상한을 올린 사용자가 화면에서 여전히 막힌 것을 본다.
 */
export async function setBudgetLimit(
  workspaceId: string,
  actorId: string | null,
  limitMinorUsd: bigint,
  now: Date = new Date(),
): Promise<BudgetRow> {
  if (limitMinorUsd < BigInt(0)) {
    throw new CrmError('VALIDATION_FAILED', '상한은 0 이상이어야 합니다.', { field: 'limitMinorUsd' })
  }
  const month = currentMonthKey(now)

  return withCrmTx(workspaceId, async (tx) => {
    const b = await lockMonth(tx, workspaceId, month)

    const after = evaluateBudget({
      limitMinorUsd, spentMinorUsd: b.spentMinorUsd,
      alertSentAt: b.alertSentAt, blockedAt: b.blockedAt,
    })

    // 여유가 생겼으면 차단·경보를 함께 푼다.
    // 경보까지 푸는 이유: 상한이 올라 80% 아래로 내려왔는데 경보 플래그가 남아 있으면,
    // 다시 80% 에 닿았을 때 아무도 모른다.
    const cleared = after.level === 'ok'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tx as any).crmAiBudget.updateMany({
      where: { id: b.id },
      data: {
        limitMinorUsd,
        blockedAt: after.shouldBlock ? (b.blockedAt ?? now) : null,
        ...(cleared ? { alertSentAt: null } : {}),
      },
    })

    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'budget.limit_changed',
      targetType: 'budget', targetId: b.id,
      beforeJson: { limitMinorUsd: b.limitMinorUsd.toString(), blockedAt: b.blockedAt },
      afterJson: { limitMinorUsd: limitMinorUsd.toString(), blockedAt: after.shouldBlock ? now : null },
    })

    return {
      ...b, limitMinorUsd,
      blockedAt: after.shouldBlock ? (b.blockedAt ?? now) : null,
      alertSentAt: cleared ? null : b.alertSentAt,
    }
  })
}

/** 화면이 읽는 현재 상태 — 쓰기 없이 */
export async function getBudget(
  workspaceId: string,
  now: Date = new Date(),
): Promise<{ month: string; limitMinorUsd: bigint; spentMinorUsd: bigint; verdict: BudgetVerdict }> {
  const month = currentMonthKey(now)

  return withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = await (tx as any).crmAiBudget.findFirst({ where: { month } })
    const limitMinorUsd = b?.limitMinorUsd ?? DEFAULT_LIMIT_MINOR_USD
    const spentMinorUsd = b?.spentMinorUsd ?? BigInt(0)
    return {
      month, limitMinorUsd, spentMinorUsd,
      verdict: evaluateBudget({
        limitMinorUsd, spentMinorUsd,
        alertSentAt: b?.alertSentAt ?? null, blockedAt: b?.blockedAt ?? null,
      }),
    }
  })
}

export { BUDGET_ALERT_RATIO }
