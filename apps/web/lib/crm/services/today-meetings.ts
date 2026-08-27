/**
 * 오늘 잡혀 있는 미팅 — 첫 화면의 포착 후보 (SSOT)
 *
 * **왜 필요한가**: 화면 이름이 「오늘」인데 **오늘의 미팅이 없었다.**
 * `attention.ts` 가 보는 것은 넷뿐이고(기한 지남·오늘까지·확인 기다림·오래 멈춤)
 * `crm_meeting.startedAt` 을 읽는 코드가 그 경로에 하나도 없었다.
 * 아침에 CRM 을 열어도 "오늘 14시 ○○전자 미팅"이 안 나왔다.
 *
 * **왜 새로 만들지 않고 이어가나**: 이미 잡혀 있는 미팅이 있는데 「녹음 시작」을 누르면
 * 같은 회의가 두 벌이 된다. 그러면 인박스에 같은 제안이 두 벌 뜨고,
 * 딜에 붙는 기록도 둘이 된다. 그래서 후보로 **보여 주고 고르게** 한다 —
 * 자동으로 합치지는 않는다(틀리면 남의 회의에 묶인다).
 */

import type { CrmDb } from '../db/client.ts'
import { kstRangeToUtc, kstTodayKey } from '../../datetime/kst.ts'

export interface TodayMeeting {
  id: string
  title: string
  /** ISO. 화면이 KST 로 옮겨 그린다(표시는 언제나 KST — datetime SSOT) */
  startedAt: string
  companyName: string | null
  /**
   * 아직 아무것도 안 적힌 미팅인가.
   *
   * 요약도 원본 노트도 없으면 "일정은 잡혔는데 기록이 없다"는 뜻이다 —
   * 화면이 「기록 없음」이라고 말할 근거가 된다(`MEETING_STATUS_META.EMPTY` 와 같은 뜻).
   */
  empty: boolean
}

/** 첫 화면에 몇 건까지 — 넘으면 목록이 상자를 잡아먹는다 */
const MAX = 5

/**
 * 오늘(KST) 잡혀 있는 미팅.
 *
 * 경계는 `kstRangeToUtc` 가 만든다 — 손으로 `T00:00:00` 을 붙이면 UTC 로 적재돼
 * 9시간이 밀린다(datetime 정합성 정책의 그 사고).
 */
export async function listTodayMeetings(db: CrmDb, now: Date = new Date()): Promise<TodayMeeting[]> {
  const day = kstTodayKey(now)
  // `toIso` 는 23:59:59.999 **포함**이라 `lte` 다 — `lt` 로 쓰면 그 1ms 안의 미팅을 놓친다
  const { fromIso, toIso } = kstRangeToUtc(day, day)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await (db as any).crmMeeting.findMany({
    where: { startedAt: { gte: new Date(fromIso), lte: new Date(toIso) } },
    orderBy: { startedAt: 'asc' },   // 이른 시각이 위 — 하루를 시간 순으로 읽는다
    take: MAX,
    select: { id: true, title: true, startedAt: true, summaryMd: true, noteId: true, companyId: true },
  }) as { id: string; title: string; startedAt: Date; summaryMd: string | null; noteId: string | null; companyId: string | null }[]

  if (rows.length === 0) return []

  // 회사 이름은 한 번에 가져온다 — 건당 조회하면 최대 5회 왕복이고
  // 그중 하나만 실패해도 그 줄만 이름이 빈 채 남는다(목록 화면이 겪었던 N+1 그대로)
  const companyIds = Array.from(
    new Set(rows.map((r) => r.companyId).filter((x): x is string => Boolean(x))),
  )
  const names = new Map<string, string>()
  if (companyIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cs = await (db as any).crmCompany.findMany({
      where: { id: { in: companyIds } }, select: { id: true, name: true },
    }).catch(() => []) as { id: string; name: string }[]
    for (const c of cs) names.set(c.id, c.name)
  }

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    startedAt: r.startedAt.toISOString(),
    companyName: r.companyId ? names.get(r.companyId) ?? null : null,
    empty: !r.summaryMd?.trim() && !r.noteId,
  }))
}
