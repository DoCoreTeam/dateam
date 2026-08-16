/**
 * 단계 이동 검토 (dacrm — 진입 조건표를 대신하는 판단)
 *
 * **왜 만들었나**: 단계 진입 조건표는 워크스페이스 하나에 스위치를 342개 만들어 놓고
 * 하나도 켜져 있지 않았다. 사용자가 그 화면을 보고 한 말이 이 기능의 출발점이다 —
 * "안 봄 / 알려 줌 / 막음 이게 뭔지 모르겠고, 저걸 했을 때 뭐가 어떻게 되는지도 모르겠다."
 *
 * 스위치가 묻는 질문(**칸이 비었나**)과 사람이 알고 싶은 것(**이 딜, 넘어가도 되나**)이
 * 서로 다른 질문이라 아무도 켜지 않았다. 그래서 질문을 바꾼다.
 *
 * **막지 않는다.** 이 검토는 이동이 **끝난 뒤에** 돈다.
 *   · 이동을 막으면 그건 조건표를 AI 로 다시 만든 것뿐이다
 *   · 이동 트랜잭션 안에서 돌면 AI 가 느린 날 저장이 느려지고, AI 가 죽는 날 저장이 죽는다
 *   · 사람은 자기 딜을 우리보다 잘 안다 — 우리가 아는 것은 여기 모은 몇 줄이 전부다
 *
 * **절대 던지지 않는다.** 예산·모델·파싱 실패는 전부 "지금은 못 봐 드려요"로 끝난다.
 * 조언이 실패했다고 방금 성공한 이동이 실패처럼 보이면 그게 더 큰 사고다.
 */

import { runAi } from '../ai/runner.ts'
import { adapterFromSetting } from './quick-create.ts'
import {
  stageReviewPrompt, buildStageReviewBrief, parseStageReview,
  type StageReviewBrief, type StageReviewOutput,
} from '../ai/prompts/stage-review.v1.ts'
import type { CrmDb } from '../db/client.ts'
import { getCrmDb } from '../db/client.ts'
import { kstDateKey } from '../../datetime/kst.ts'

/** 이 호출의 예상 비용(센트) — 예산이 0 인 워크스페이스는 여기서 막힌다 */
const ESTIMATE_MINOR_USD = BigInt(1)

/** 브리핑에 싣는 최근 기록 수 — 많이 넣으면 모델이 뭉뚱그린다 */
const MAX_ACTIVITIES = 6

function daysAgo(from: Date | string | null, now: Date): number | null {
  if (!from) return null
  const t = new Date(from).getTime()
  if (Number.isNaN(t)) return null
  return Math.floor((now.getTime() - t) / 86_400_000)
}

export interface StageReviewResult {
  review: StageReviewOutput | null
  /** 왜 못 봤나 — 빈 화면에 이유가 없으면 사람은 고장으로 읽는다 */
  reason: string | null
}

/**
 * 검토에 필요한 사실을 모은다.
 *
 * 여기 없는 것은 모델도 모른다. 그래서 **판단에 실제로 쓰이는 것만** 모은다 —
 * 금액·성사일·담당자처럼 화면이 이미 보여 주는 값은 "왜 그게 지금 문제인가"를
 * 말하기 위한 재료이고, 최근 기록·미팅 정리는 그 판단의 근거다.
 */
export async function buildStageReview(
  db: CrmDb, dealId: string, now: Date = new Date(),
): Promise<StageReviewBrief | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deal = await (db as any).crmDeal.findFirst({
    where: { id: dealId },
    select: {
      id: true, name: true, pipelineId: true, stageId: true,
      amountMinor: true, currency: true, expectedCloseDate: true, ownerId: true,
      company: { select: { name: true } },
      stage: { select: { name: true } },
    },
  })
  if (!deal) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stages = await (db as any).crmStage.findMany({
    where: { pipelineId: deal.pipelineId }, orderBy: { position: 'asc' },
    select: { id: true, name: true },
  }) as { id: string; name: string }[]

  // 직전 이동 — 어디서 왔는지, 거기 얼마나 머물렀는지
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const history = await (db as any).crmStageHistory.findMany({
    where: { dealId }, orderBy: { movedAt: 'desc' }, take: 1,
    select: { fromStageId: true, movedAt: true, durationSec: true },
  }) as { fromStageId: string | null; movedAt: Date; durationSec: number | null }[]
  const last = history[0] ?? null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const owner = deal.ownerId ? await (db as any).crmMember.findFirst({
    where: { id: deal.ownerId }, select: { displayName: true },
  }) : null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contactCount = await (db as any).crmDealContact.count({ where: { dealId } })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tasks = await (db as any).crmTask.findMany({
    where: { dealId, status: { in: ['TODO', 'DOING'] } },
    select: { title: true }, take: 10,
  }) as { title: string }[]

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const activities = await (db as any).crmActivity.findMany({
    where: { dealId }, orderBy: { occurredAt: 'desc' }, take: MAX_ACTIVITIES,
    select: { type: true, title: true, occurredAt: true },
  }) as { type: string; title: string; occurredAt: Date }[]

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meeting = await (db as any).crmMeeting.findFirst({
    where: { dealId, summaryMd: { not: null } },
    orderBy: { startedAt: 'desc' }, select: { summaryMd: true },
  })

  const fromStage = last?.fromStageId
    ? stages.find((s) => s.id === last.fromStageId)?.name ?? null
    : null

  return {
    dealName: deal.name,
    companyName: deal.company?.name ?? null,
    fromStage,
    toStage: deal.stage?.name ?? '(단계 없음)',
    stageNames: stages.map((s) => s.name),
    amountText: deal.amountMinor === null
      ? null
      : `${deal.amountMinor.toString()} ${deal.currency ?? 'KRW'}`,
    closeDateText: deal.expectedCloseDate ? kstDateKey(deal.expectedCloseDate) : null,
    ownerName: owner?.displayName ?? null,
    contactCount,
    openTasks: tasks.map((t) => t.title),
    recentActivities: activities.map((a) => ({
      kind: a.type, title: a.title, daysAgo: daysAgo(a.occurredAt, now) ?? 0,
    })),
    lastMeetingSummary: meeting?.summaryMd ?? null,
    // 이력은 초로 적힌다 — 사람이 읽는 단위는 날이다
    daysInPrevStage: last?.durationSec == null ? null : Math.floor(last.durationSec / 86_400),
  }
}

export async function reviewStageMove(
  workspaceId: string, dealId: string, now: Date = new Date(),
): Promise<StageReviewResult> {
  const db = getCrmDb(workspaceId)

  let brief: StageReviewBrief | null = null
  try {
    brief = await buildStageReview(db, dealId, now)
  } catch {
    return { review: null, reason: '딜을 읽지 못했어요.' }
  }
  if (!brief) return { review: null, reason: '딜을 찾을 수 없어요.' }

  try {
    const { output } = await runAi<StageReviewOutput>({
      db, workspaceId,
      // 새 종류를 만들지 않는다 — enum 을 늘리면 마이그레이션이 필요하다.
      // 성격상 어시스턴트(사람을 돕는 조언)이고, 어느 프롬프트였는지는 버전이 기록한다.
      kind: 'ASSISTANT',
      prompt: stageReviewPrompt,
      input: buildStageReviewBrief(brief),
      inputRef: { dealId, stage: brief.toStage },
      parse: parseStageReview,
      adapter: await adapterFromSetting(db),
      estimateMinorUsd: ESTIMATE_MINOR_USD,
    })
    return { review: output, reason: null }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const budget = /BUDGET|예산/i.test(msg)
    return {
      review: null,
      reason: budget
        ? 'AI 예산 한도에 걸려 이번엔 못 봤어요. 설정에서 상한을 올릴 수 있습니다.'
        : '지금은 확인해 드리지 못했어요.',
    }
  }
}
