/**
 * 회의에서 뽑은 할 일을 **딜에도 세운다.**
 *
 * ## 무엇이 끊겨 있었나 (2026-09-17 실측)
 *
 * 회의노트의 [할 일·일정 뽑기]가 만든 할 일 **40건이 전부 `daily_logs` 로만** 갔다.
 * `crm_task` 에는 0건이다. 딜 상세의 할 일 패널은 `crm_task` 를 딜로 걸러 보므로
 * 그 40건은 **딜 화면에 영원히 안 뜬다.** 실패한 것이 아니라 **길이 없던 것**이라
 * 화면에서는 «할 일이 없는 딜»과 구분되지 않는다
 * (사용자 지적: *"할일들 뽑으면 딜에서도 관련 프로젝트와 관련된 할일이 보여야 하는데"*).
 *
 * ## 왜 개인 쪽을 옮기지 않고 **양쪽에 세우나**
 *
 * `daily_logs` 는 «내가 오늘 무엇을 하나»이고 `crm_task` 는 «이 딜을 누가 어디까지 밀었나»다.
 * 보는 사람도 묻는 질문도 다르다. 한쪽으로 몰면 다른 쪽에서 그 일이 없던 일이 된다 —
 * 사용자가 말한 것도 «딜에서**도** 보여야»다.
 *
 * ## 경계
 *
 *   · **CRM 멤버가 아니면 아무것도 안 만든다.** 개인 회의노트는 워크스페이스 밖의 물건이다.
 *   · **올리지 않은 회의도 안 만든다.** 팀에 안 보이기로 한 회의를 팀 할 일로 새게 할 수 없다.
 *   · **붙은 곳이 없으면 안 만든다.** 회사도 딜도 없는 할 일은 어느 상세에도 안 서고
 *     전체 목록만 어지럽힌다 — 만들어서 얻는 것이 없다.
 *   · **실패해도 회의노트 쪽 저장을 막지 않는다.** 부르는 쪽이 결과를 보고 알리기만 한다
 *     (기록이 사용자 저장을 막지 않는다 — 정책 「유실 0 은 fallback」).
 */

import { getCrmDb } from '../db/client.ts'
import { createTask } from './task.ts'

/** 왜 안 만들었나. `null` 이면 만들었거나 만들 것이 없던 것이다 */
export type RelaySkip = 'no-access' | 'not-published' | 'no-anchor'

export interface RelayResult {
  created: number
  skipped: RelaySkip | null
  /** 어디에 세웠나 — 부르는 쪽이 「딜에도 세웠어요」를 말할 수 있게 */
  dealId: string | null
  companyId: string | null
}

const NOTHING: RelayResult = { created: 0, skipped: null, dealId: null, companyId: null }

export async function relayNoteTasksToCrm(
  hostUserId: string,
  noteId: string,
  titles: string[],
): Promise<RelayResult> {
  const wanted = titles.map((t) => t.trim()).filter(Boolean)
  if (wanted.length === 0) return NOTHING

  const { resolveCrmAccessForUser } = await import('../auth/requireCrmMember.ts')
  const access = await resolveCrmAccessForUser(hostUserId)
  if (!access.ok) return { ...NOTHING, skipped: 'no-access' }

  const { workspaceId, memberId } = access.session
  const db = getCrmDb(workspaceId)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meeting = await (db as any).crmMeeting.findFirst({
    where: { noteId, deletedAt: null },
    select: { id: true, companyId: true, dealId: true },
  }) as { id: string; companyId: string | null; dealId: string | null } | null
  if (!meeting) return { ...NOTHING, skipped: 'not-published' }
  if (!meeting.dealId && !meeting.companyId) {
    return { created: 0, skipped: 'no-anchor', dealId: null, companyId: null }
  }

  /*
    **같은 회의에서 같은 제목은 한 번만.** 회의 중에 [뽑기]를 두 번 누르는 것은 흔하고,
    그때마다 딜에 같은 줄이 쌓이면 사용자는 그 패널을 안 믿게 된다.

    `deletedAt: undefined` 는 **휴지통에 있는 것도 세겠다**는 뜻이다. 워크스페이스 가드는
    조회에 `deletedAt` 키가 없으면 `deletedAt: null` 을 끼워 넣는다(`db/workspace-guard.ts`).
    그대로 두면 사용자가 딜에서 **지운 할 일이 다음 [뽑기] 때 되살아난다.** 키를 명시하면
    가드가 손대지 않고, Prisma 는 `undefined` 를 «조건 없음»으로 읽는다
    (실측 2026-09-17: 같은 질의가 기본 0건 · 명시 1건).
  */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const already = await (db as any).crmTask.findMany({
    where: { sourceMeetingId: meeting.id, deletedAt: undefined },
    select: { title: true },
  }) as { title: string }[]
  const seen = new Set(already.map((r) => r.title))

  let created = 0
  for (const title of wanted) {
    if (seen.has(title)) continue
    seen.add(title)
    try {
      await createTask(workspaceId, memberId, {
        title,
        companyId: meeting.companyId,
        dealId: meeting.dealId,
        sourceMeetingId: meeting.id,
      })
      created += 1
    } catch (e) {
      // 한 줄이 막혔다고 나머지를 버리지 않는다 — 열 줄 중 하나만 이상한 경우가 흔하다
      console.error('[relayNoteTasksToCrm] create', title, e)
    }
  }

  return { created, skipped: null, dealId: meeting.dealId, companyId: meeting.companyId }
}
