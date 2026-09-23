// 지금 봐야 할 것 (dacrm FR-12 인앱 알림)
//
// **왜 "알림"이 아니라 "지금 봐야 할 것"인가**:
// 흔한 알림 센터는 사건이 생길 때마다 한 줄씩 쌓는다. 그러면 두 가지가 일어난다 —
// ① 읽음 처리만 하고 실제로는 아무것도 안 한다 ② 며칠 지나면 아무도 안 연다.
// 알림이 죽는 이유는 알림이 **과거의 사건**이기 때문이다.
//
// 그래서 사건을 쌓지 않고 **지금 상태**를 본다.
// 기한 지난 할 일은 처리하면 사라지고, 대기 중인 제안은 수락하면 사라진다.
// 읽음 표시가 필요 없다 — 조치하면 사라지는 것이 곧 읽음이다.
//
// **새 테이블을 만들지 않는다.** 재료가 이미 전부 있다:
// 할 일 기한 · 대기 제안 · 자동화가 만든 것(감사 로그) · 오래 멈춘 딜.
// 알림 테이블을 새로 만들면 그 순간부터 **같은 사실이 두 곳에** 있게 되고,
// 하나를 처리해도 다른 하나가 남는다.

import type { CrmDb } from '../db/client.ts'
import { kstDateKey, kstTodayKey } from '../../datetime/kst.ts'

export type AttentionKind = 'overdue' | 'due_today' | 'suggestion' | 'stalled'

/** 위에서부터 급한 순 — 화면은 위에서 아래로 읽힌다 */
export const KIND_ORDER: AttentionKind[] = ['overdue', 'due_today', 'suggestion', 'stalled']

export const KIND_LABEL: Record<AttentionKind, string> = {
  overdue: '기한 지남',
  due_today: '오늘까지',
  suggestion: '확인 기다림',
  stalled: '오래 멈춤',
}

export interface AttentionItem {
  kind: AttentionKind
  id: string
  title: string
  /** 왜 여기 떴는지 — 이유를 안 쓰면 사람은 무시하는 법부터 배운다 */
  reason: string
  href: string
}

export interface Attention {
  items: AttentionItem[]
  /** 종류별 개수 — 뱃지 숫자의 근거 */
  counts: Record<AttentionKind, number>
  total: number
  /** 상한에 걸려 잘렸나 — 조용히 자르면 "이게 전부"로 읽는다 */
  truncated: boolean
}

/** 한 종류에 이만큼씩 — 한 종류가 목록을 다 먹으면 나머지를 못 본다 */
const PER_KIND = 5

/** 며칠 넘게 한 단계에 있으면 "멈춘" 것으로 보나 — 자동화 기본값과 같은 감각 */
const STALLED_DAYS = 14

const EMPTY: Record<AttentionKind, number> = { overdue: 0, due_today: 0, suggestion: 0, stalled: 0 }

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000)
}

/**
 * 누구의 것을 볼 것인가.
 *
 * **왜 인자로 받나** (실측 2026-09-22): 예전에는 이 함수가 보는 사람을 아예 안 받았다.
 * 그래서 어느 계정으로 로그인해도 「오늘」 화면에 **같은 목록**이 떴다
 * (사용자 지적: 「아무계정이나 들어가도 동일한 목록이 나오고 있음」).
 * 인자를 기본값으로 두면 부르는 쪽이 안 넘겨도 조용히 전체가 나가므로 **필수로 받는다.**
 */
export interface AttentionScope {
  /**
   * 담당자가 이 안에 든 것만 본다. `null` 이면 제한 없음(전사 범위인 사람).
   * 빈 배열은 「아무것도 아님」이라 결과가 비는데, 그것도 맞는 답이다 —
   * 담당이 하나도 없는 사람에게 남의 일을 보여 줄 이유가 없다.
   */
  ownerMemberIds: readonly string[] | null
}

/** 워크스페이스 전체 — 전사 범위이거나 관리자 화면에서 쓴다 */
export const ALL_SCOPE: AttentionScope = { ownerMemberIds: null }

/** `{ in: [...] }` 조건을 만든다. 제한이 없으면 아무 조건도 안 붙인다 */
function ownedBy(scope: AttentionScope, field: string): Record<string, unknown> {
  if (scope.ownerMemberIds === null) return {}
  return { [field]: { in: [...scope.ownerMemberIds] } }
}

/**
 * 지금 내가 봐야 할 것을 모은다.
 *
 * **전부 실패해도 화면은 떠야 한다.** 이건 부가 정보라, 하나가 실패했다고
 * 헤더가 통째로 안 그려지면 그게 더 큰 사고다. 종류별로 나눠 담고 실패는 건너뛴다.
 */
export async function buildAttention(
  db: CrmDb,
  scope: AttentionScope,
  now: Date = new Date(),
): Promise<Attention> {
  const today = kstTodayKey(now)
  const items: AttentionItem[] = []
  const counts = { ...EMPTY }
  let truncated = false

  // ① 기한이 지났거나 오늘까지인 할 일
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tasks = await (db as any).crmTask.findMany({
      // 담당자로 좁힌다 — 이것이 없어서 계정마다 같은 목록이 나왔다
      where: { status: { in: ['TODO', 'DOING'] }, dueAt: { not: null }, ...ownedBy(scope, 'assigneeId') },
      select: { id: true, title: true, dueAt: true },
      orderBy: { dueAt: 'asc' },
      take: PER_KIND * 2 + 1,
    }) as { id: string; title: string; dueAt: Date }[]

    for (const t of tasks) {
      const due = kstDateKey(t.dueAt.toISOString())
      const kind: AttentionKind | null = due < today ? 'overdue' : due === today ? 'due_today' : null
      if (!kind) continue
      if (counts[kind] >= PER_KIND) { truncated = true; continue }

      counts[kind] += 1
      const late = daysBetween(t.dueAt, now)
      items.push({
        kind, id: t.id, title: t.title,
        reason: kind === 'overdue' ? `${late}일 지났어요` : '오늘까지예요',
        href: '/crm/tasks',
      })
    }
  } catch { /* 이 종류만 건너뛴다 — 나머지는 보여야 한다 */ }

  /**
   * ② AI 가 뽑아 놓고 아직 확인 안 한 제안.
   *
   * **여기만 범위를 안 좁힌다.** 제안 행에는 담당자 칸이 없다 —
   * 미팅에서 뽑은 값이라 아직 누구의 것도 아니고, 인박스는 **함께 보는 대기줄**이다.
   * 담당자로 좁히려면 제안이 가리키는 딜·회사를 되짚어야 하는데,
   * 그건 조회를 늘리면서도 「담당자가 아직 없는 새 회사 제안」을 아무에게도 안 보이게 만든다.
   * 그래서 좁히지 않고, 그 사실을 여기 적어 둔다 (조용히 다른 규칙을 쓰지 않는다).
   */
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pending = await (db as any).crmAiSuggestion.count({
      where: { status: 'PENDING', expiresAt: { gt: now } },
    }) as number

    if (pending > 0) {
      counts.suggestion = pending
      items.push({
        kind: 'suggestion', id: 'inbox', title: `확인 기다리는 제안 ${pending}건`,
        reason: '미팅에서 뽑은 값이에요. 확인해야 반영됩니다',
        href: '/crm/inbox',
      })
    }
  } catch { /* 건너뛴다 */ }

  // ③ 한 단계에 오래 멈춘 딜 — 아무 일도 안 일어난 것이 사건이라 스스로는 안 드러난다
  try {
    const cutoff = new Date(now.getTime() - STALLED_DAYS * 86_400_000)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const deals = await (db as any).crmDeal.findMany({
      where: { status: 'OPEN', updatedAt: { lt: cutoff }, ...ownedBy(scope, 'ownerId') },
      select: { id: true, name: true, updatedAt: true, stage: { select: { name: true } } },
      orderBy: { updatedAt: 'asc' },
      take: PER_KIND + 1,
    }) as { id: string; name: string; updatedAt: Date; stage: { name: string } | null }[]

    for (const d of deals.slice(0, PER_KIND)) {
      counts.stalled += 1
      items.push({
        kind: 'stalled', id: d.id, title: d.name,
        reason: `${d.stage?.name ?? '이 단계'}에 ${daysBetween(d.updatedAt, now)}일째예요`,
        href: `/crm/deals/${d.id}`,
      })
    }
    if (deals.length > PER_KIND) truncated = true
  } catch { /* 건너뛴다 */ }

  // 급한 순으로 — 화면은 위에서 아래로 읽힌다
  items.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))

  return {
    items,
    counts,
    total: counts.overdue + counts.due_today + counts.suggestion + counts.stalled,
    truncated,
  }
}

/** 뱃지에 쓸 한 줄 — 숫자만 보이면 무엇이 급한지 모른다 */
export function attentionSummary(a: Attention): string {
  if (a.total === 0) return '지금 볼 게 없어요'

  const parts: string[] = []
  if (a.counts.overdue > 0) parts.push(`기한 지난 할 일 ${a.counts.overdue}건`)
  if (a.counts.due_today > 0) parts.push(`오늘까지 ${a.counts.due_today}건`)
  if (a.counts.suggestion > 0) parts.push(`확인 기다리는 제안 ${a.counts.suggestion}건`)
  if (a.counts.stalled > 0) parts.push(`오래 멈춘 딜 ${a.counts.stalled}건`)
  return parts.join(' · ')
}
