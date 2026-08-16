// 다음 최선 행동 (dacrm FR-05 딜 인텔리전스)
//
// **무엇을 하나**: 멈춰 있는 딜을 골라 "다음에 뭘 하면 좋을지" AI 에게 묻는다.
//
// **왜 멈춘 딜만인가**: 어제 미팅한 딜에 "연락해 보세요"는 방해다.
// 도움이 필요한 것은 **아무 일도 안 일어나고 있는 딜**이고, 그건 스스로 드러나지 않는다.
//
// **왜 자동으로 만들지 않나**: AI 가 만든 할 일이 목록에 그냥 쌓이면
// 사람은 그 목록 전체를 안 믿게 된다. 이 저장소의 AI UX 표준(§5-3)대로
// **후보 + 근거 → 사람이 고름 → 반영**이다. 자동 등록은 하지 않는다.
//
// **AI 가 실패해도 화면은 산다.** 예산 초과·모델 오류·파싱 실패 전부
// "지금은 제안을 못 드려요"로 끝난다 — 오늘 화면이 통째로 안 뜨면 그게 더 큰 사고다.

import { runAi } from '../ai/runner.ts'
import { adapterFromSetting } from './quick-create.ts'
import {
  nextBestActionPrompt, buildDealBriefs, parseNextBestActions,
  MAX_DEALS_PER_RUN, type DealBrief, type NextBestActionSuggestion,
} from '../ai/prompts/next-best-action.v1.ts'
import type { CrmDb } from '../db/client.ts'
import { kstDateKey } from '../../datetime/kst.ts'

/** 며칠 넘게 아무 일도 없으면 "멈춘" 것으로 보나 */
export const STALE_DAYS = 10

/** 이 호출의 예상 비용(센트) — 예산이 0 인 워크스페이스는 여기서 막힌다 */
const ESTIMATE_MINOR_USD = BigInt(2)

function daysAgo(from: Date | string | null, now: Date): number | null {
  if (!from) return null
  const t = new Date(from).getTime()
  if (Number.isNaN(t)) return null
  return Math.floor((now.getTime() - t) / 86_400_000)
}

/**
 * 도움이 필요한 딜을 고른다.
 *
 * **조건**: 열려 있고 · 오래 안 움직였고 · **이미 잡힌 할 일이 없다.**
 * 할 일이 있는 딜은 사람이 이미 다음을 정해 둔 것이라 제안이 방해다.
 */
export async function pickStaleDeals(
  db: CrmDb, now: Date = new Date(), limit = MAX_DEALS_PER_RUN,
): Promise<DealBrief[]> {
  const cutoff = new Date(now.getTime() - STALE_DAYS * 86_400_000)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deals = await (db as any).crmDeal.findMany({
    where: { status: 'OPEN', updatedAt: { lt: cutoff } },
    select: {
      id: true, name: true, stageId: true, amountMinor: true, currency: true, updatedAt: true,
      company: { select: { name: true } },
      stage: { select: { name: true } },
    },
    orderBy: { updatedAt: 'asc' },
    take: limit * 3, // 할 일 있는 것을 걸러내면 줄어든다
  }) as {
    id: string; name: string; stageId: string; amountMinor: bigint | null
    currency: string | null; updatedAt: Date
    company: { name: string } | null; stage: { name: string } | null
  }[]

  if (deals.length === 0) return []
  const ids = deals.map((d) => d.id)

  // 이미 다음을 정해 둔 딜은 뺀다 — 정해 둔 사람에게 또 제안하면 그게 소음이다
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tasks = await (db as any).crmTask.findMany({
    where: { dealId: { in: ids }, status: { in: ['TODO', 'DOING'] } },
    select: { dealId: true, title: true },
  }) as { dealId: string; title: string }[]

  const taskByDeal = new Map<string, string[]>()
  for (const t of tasks) {
    const list = taskByDeal.get(t.dealId) ?? []
    list.push(t.title)
    taskByDeal.set(t.dealId, list)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const activities = await (db as any).crmActivity.findMany({
    where: { dealId: { in: ids } },
    select: { dealId: true, type: true, title: true, occurredAt: true },
    orderBy: { occurredAt: 'desc' },
    take: 200,
  }) as { dealId: string; type: string; title: string; occurredAt: Date }[]

  const lastByDeal = new Map<string, { kind: string; title: string; daysAgo: number }>()
  for (const a of activities) {
    if (lastByDeal.has(a.dealId)) continue // 최신순이라 첫 것이 마지막 활동
    lastByDeal.set(a.dealId, {
      kind: a.type, title: a.title, daysAgo: daysAgo(a.occurredAt, now) ?? 0,
    })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meetings = await (db as any).crmMeeting.findMany({
    where: { dealId: { in: ids }, summaryMd: { not: null } },
    select: { dealId: true, summaryMd: true },
    orderBy: { startedAt: 'desc' },
    take: 50,
  }) as { dealId: string; summaryMd: string | null }[]

  const summaryByDeal = new Map<string, string>()
  for (const m of meetings) {
    if (!summaryByDeal.has(m.dealId) && m.summaryMd) summaryByDeal.set(m.dealId, m.summaryMd)
  }

  // 지금 단계에 들어온 시각 — 이력이 없으면 마지막 수정 시각으로 본다
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const history = await (db as any).crmStageHistory.findMany({
    where: { dealId: { in: ids } },
    select: { dealId: true, toStageId: true, movedAt: true },
    orderBy: { movedAt: 'desc' },
    take: 200,
  }) as { dealId: string; toStageId: string; movedAt: Date }[]

  const enteredByDeal = new Map<string, Date>()
  for (const h of history) {
    if (!enteredByDeal.has(h.dealId)) enteredByDeal.set(h.dealId, h.movedAt)
  }

  const out: DealBrief[] = []
  for (const d of deals) {
    const openTasks = taskByDeal.get(d.id) ?? []
    if (openTasks.length > 0) continue // 이미 정해 뒀다

    out.push({
      dealId: d.id,
      name: d.name,
      companyName: d.company?.name ?? null,
      stageName: d.stage?.name ?? '(단계 없음)',
      daysInStage: daysAgo(enteredByDeal.get(d.id) ?? d.updatedAt, now),
      amountText: d.amountMinor === null ? null : `${d.amountMinor.toString()} ${d.currency ?? 'KRW'}`,
      lastActivity: lastByDeal.get(d.id) ?? null,
      lastMeetingSummary: summaryByDeal.get(d.id) ?? null,
      openTasks,
    })
    if (out.length >= limit) break
  }

  return out
}

export interface NextBestActionResult {
  suggestions: (NextBestActionSuggestion & {
    dealName: string
    /** 그대로 할 일로 만들 때 쓸 기한(KST 날짜) */
    dueDate: string
  })[]
  /** 몇 개를 보고 물었나 — 0이면 물을 것이 없었다는 뜻이다 */
  looked: number
  /** 왜 제안이 없나 — 빈 화면에 이유가 없으면 사람은 고장으로 읽는다 */
  reason: string | null
}

/**
 * 멈춘 딜에 대해 다음 행동을 묻는다.
 *
 * **절대 던지지 않는다.** 예산 초과·모델 오류·파싱 실패 전부
 * "지금은 제안을 못 드려요"로 돌려준다 — 오늘 화면이 통째로 안 뜨면 그게 더 큰 사고다.
 */
export async function suggestNextBestActions(
  db: CrmDb, workspaceId: string, now: Date = new Date(),
): Promise<NextBestActionResult> {
  let deals: DealBrief[] = []
  try {
    deals = await pickStaleDeals(db, now)
  } catch {
    return { suggestions: [], looked: 0, reason: '딜을 읽지 못했어요.' }
  }

  if (deals.length === 0) {
    return {
      suggestions: [], looked: 0,
      reason: `${STALE_DAYS}일 넘게 멈춘 딜이 없어요. 지금은 제안할 게 없습니다.`,
    }
  }

  const nameById = new Map(deals.map((d) => [d.dealId, d.name]))
  const ids = deals.map((d) => d.dealId)

  try {
    const { output } = await runAi<NextBestActionSuggestion[]>({
      db,
      workspaceId,
      /**
       * `ASSISTANT` 를 쓴다. 전용 종류를 만들면 enum 마이그레이션이 필요한데,
       * 이 제안은 성격상 어시스턴트(사람을 돕는 조언)라 굳이 나눌 이유가 없다.
       * 어느 프롬프트에서 나왔는지는 프롬프트 버전이 이미 기록한다.
       */
      kind: 'ASSISTANT',
      prompt: nextBestActionPrompt,
      input: buildDealBriefs(deals),
      // 원문을 복제하지 않는다 — 참조만 남긴다
      inputRef: { dealIds: ids },
      parse: (text) => parseNextBestActions(text, ids),
      /**
       * 어느 모델로 물을지는 quick-create 와 **같은 함수**가 정한다.
       * 두 벌로 두면 한쪽만 고치게 되고, 그러면 같은 워크스페이스가 두 모델을 쓴다.
       */
      adapter: await adapterFromSetting(db),
      estimateMinorUsd: ESTIMATE_MINOR_USD,
    })

    return {
      looked: deals.length,
      suggestions: output.map((s) => ({
        ...s,
        dealName: nameById.get(s.dealId) ?? '',
        dueDate: kstDateKey(new Date(now.getTime() + s.dueInDays * 86_400_000).toISOString()),
      })),
      // 볼 딜은 있었는데 제안이 0이면 그것도 답이다 — "억지로 만들지 않았다"는 뜻
      reason: output.length === 0
        ? `멈춘 딜 ${deals.length}건을 봤는데 지금 딱히 제안할 게 없었어요.`
        : null,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // 예산 차단은 사람이 고칠 수 있는 일이라 그대로 말한다
    const budget = /BUDGET|예산/i.test(msg)
    return {
      suggestions: [], looked: deals.length,
      reason: budget
        ? 'AI 예산 한도에 걸렸어요. 설정에서 상한을 올리면 다시 볼 수 있습니다.'
        : '지금은 제안을 못 드려요. 잠시 후 다시 시도해 주세요.',
    }
  }
}
