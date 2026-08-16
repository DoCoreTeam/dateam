// 다음에 할 일 (활동 규율)
//
// **이게 CRM 의 심장이다.** 그런데 우리에게는 없었다.
//
// Pipedrive 의 원칙: *"Pipedrive 는 활동 기반 영업 시스템이다 —
// **모든 열린 딜에는 다음 활동이 계획되어 있어야 한다.**"*
// 그래서 그쪽 보드에는 다음 활동이 없는 딜에 **노란 삼각형**이 뜨고,
// 활동을 완료하면 **즉시 다음 활동 입력창**이 열린다. 비워 두지 못하게 하는 것이다.
//
// 우리 보드는 "지금 어느 단계에 있나"만 보여 주는 **정적인 목록**이었다.
// 딜을 열어 봐도 "그래서 뭘 해야 하지?"에 답이 없었다.
// `CrmTask.dealId` 라는 재료는 있었는데 **아무도 안 읽었다.**
//
// **왜 새 테이블이 아닌가**: "다음 할 일"은 새로운 사실이 아니라
// **이미 있는 할 일 중 가장 급한 것**이다. 컬럼을 만들면 할 일 목록과 딜의 다음 할 일이
// 서로 어긋난다 — 하나를 끝내도 다른 하나가 남는다.

import type { CrmDb } from '../db/client.ts'
import { kstDateKey, kstTodayKey } from '../../datetime/kst.ts'

export type NextActionState =
  /** 기한이 지났다 — 가장 급하다 */
  | 'overdue'
  /** 오늘까지 */
  | 'today'
  /** 예정되어 있다 */
  | 'planned'
  /** 기한 없이 할 일만 있다 */
  | 'undated'
  /** **아무 계획이 없다** — Pipedrive 의 노란 삼각형 자리 */
  | 'none'

export const STATE_LABEL: Record<NextActionState, string> = {
  overdue: '기한 지남',
  today: '오늘까지',
  planned: '예정',
  undated: '기한 없음',
  none: '다음 할 일 없음',
}

export interface NextAction {
  dealId: string
  state: NextActionState
  taskId: string | null
  title: string | null
  /** KST 날짜(YYYY-MM-DD). 기한 없으면 null */
  dueDate: string | null
  /** 사람이 읽는 한 줄 — "3일 지났어요" · "내일까지" */
  hint: string
}

/** 며칠 뒤까지를 "곧"으로 볼지 — 넘으면 그냥 예정이다 */
const SOON_DAYS = 7

function daysBetween(fromKey: string, toKey: string): number {
  const a = Date.parse(`${fromKey}T00:00:00+09:00`)
  const b = Date.parse(`${toKey}T00:00:00+09:00`)
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  return Math.round((a - b) / 86_400_000)
}

/**
 * 한 딜의 다음 할 일을 고른다.
 *
 * **기한이 있는 것이 먼저다.** 기한 없는 할 일 열 개보다 내일까지인 하나가 급하다.
 * 기한이 같으면 먼저 만든 것을 앞에 둔다 — 순서가 매번 달라지면 사람이 못 믿는다.
 */
export function pickNext(
  dealId: string,
  tasks: { id: string; title: string; dueAt: Date | string | null; createdAt: Date | string }[],
  today: string,
): NextAction {
  if (tasks.length === 0) {
    return {
      dealId, state: 'none', taskId: null, title: null, dueDate: null,
      // 무엇을 하라는 말까지 해야 사람이 움직인다. "없음"만 쓰면 그냥 정보다
      hint: '다음에 뭘 할지 정해 주세요',
    }
  }

  const sorted = [...tasks].sort((a, b) => {
    const ad = a.dueAt ? 0 : 1
    const bd = b.dueAt ? 0 : 1
    if (ad !== bd) return ad - bd // 기한 있는 것 먼저
    if (a.dueAt && b.dueAt) {
      const d = new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()
      if (d !== 0) return d
    }
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  })

  const t = sorted[0]
  if (!t.dueAt) {
    return { dealId, state: 'undated', taskId: t.id, title: t.title, dueDate: null, hint: '기한 없음' }
  }

  const due = kstDateKey(typeof t.dueAt === 'string' ? t.dueAt : t.dueAt.toISOString())
  const diff = daysBetween(due, today)

  if (diff < 0) {
    return {
      dealId, state: 'overdue', taskId: t.id, title: t.title, dueDate: due,
      hint: `${-diff}일 지났어요`,
    }
  }
  if (diff === 0) {
    return { dealId, state: 'today', taskId: t.id, title: t.title, dueDate: due, hint: '오늘까지' }
  }
  return {
    dealId, state: 'planned', taskId: t.id, title: t.title, dueDate: due,
    hint: diff === 1 ? '내일까지' : diff <= SOON_DAYS ? `${diff}일 뒤` : due,
  }
}

/**
 * 여러 딜의 다음 할 일을 한 번에.
 *
 * **딜마다 따로 조회하지 않는다.** 보드에 딜이 100개면 조회가 100번이 된다 —
 * 화면이 느려지면 사람은 보드를 안 연다.
 */
export async function nextActions(
  db: CrmDb, dealIds: string[], now: Date = new Date(),
): Promise<Map<string, NextAction>> {
  const out = new Map<string, NextAction>()
  if (dealIds.length === 0) return out

  const today = kstTodayKey(now)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tasks = await (db as any).crmTask.findMany({
    where: { dealId: { in: dealIds }, status: { in: ['TODO', 'DOING'] } },
    select: { id: true, title: true, dueAt: true, createdAt: true, dealId: true },
    orderBy: { dueAt: 'asc' },
  }) as { id: string; title: string; dueAt: Date | null; createdAt: Date; dealId: string }[]

  const byDeal = new Map<string, typeof tasks>()
  for (const t of tasks) {
    const list = byDeal.get(t.dealId) ?? []
    list.push(t)
    byDeal.set(t.dealId, list)
  }

  for (const id of dealIds) out.set(id, pickNext(id, byDeal.get(id) ?? [], today))
  return out
}

/**
 * 다음 할 일이 없는 열린 딜을 센다.
 *
 * 이 숫자가 **영업 규율의 지표**다. 크면 딜이 조용히 멈춰 있다는 뜻이다.
 */
export async function countUnplanned(db: CrmDb, pipelineId?: string): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const open = await (db as any).crmDeal.findMany({
    where: { status: 'OPEN', ...(pipelineId ? { pipelineId } : {}) },
    select: { id: true },
    take: 500,
  }) as { id: string }[]
  if (open.length === 0) return 0

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const withTask = await (db as any).crmTask.findMany({
    where: { dealId: { in: open.map((d) => d.id) }, status: { in: ['TODO', 'DOING'] } },
    select: { dealId: true },
    distinct: ['dealId'],
  }) as { dealId: string }[]

  return open.length - withTask.length
}
