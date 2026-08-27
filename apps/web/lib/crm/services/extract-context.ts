/**
 * 5축 추출에 넘길 "이미 아는 것" (SSOT)
 *
 * **왜 따로 뽑았나**: 이 조회가 미팅 서비스 안에만 있었다. 활동 노트에서도 같은 5축을
 * 읽게 되면서 두 벌이 될 참이었다 — 재사용·단일구현 정책이 금지하는 형태다.
 * 한쪽만 고치면 "미팅에서는 우리 직원을 걸러 주는데 노트에서는 고객으로 등록된다" 같은
 * 차이가 생기고, 그건 버그로 보이지 않고 **원래 그런 제품**으로 읽힌다.
 *
 * 여기서 모으는 것은 넷이다. 넷 다 "안 주면 AI 가 지어낸다"는 이유로 들어가 있다.
 *   · 회사·딜의 지금 값 — 안 주면 이미 아는 값을 또 제안해 인박스가 쓰레기로 찬다
 *   · 이 파이프라인의 단계 이름 — 안 주면 없는 단계를 지어내 반영이 실패한다
 *   · 우리 쪽 사람 이름 — 안 주면 우리 영업 담당이 고객사 연락처로 등록된다
 *
 * 여기에 셋을 더했다(v0.7.607). 사용자 지시: *"AI가 CRM에 있는 **모든 데이터와 고객사 정보를
 * 고려해서** 구조화된 데이터를 채우고"*. 셋 다 같은 이유로 들어간다 —
 * **안 주면 이미 있는 것을 또 만든다.**
 *   · 이 회사에 등록된 사람 — 안 주면 "김 부장"이 회의마다 새 인물로 쌓인다
 *   · 이 딜의 열린 할 일 — 안 주면 "견적서 보내기"가 매 회의마다 새로 쌓인다
 *   · 지난 회의 3건 — 안 주면 그때 나온 말이 오늘 결정처럼 다시 올라온다
 *
 * **상한을 둔다.** 맥락은 많을수록 좋은 게 아니다 — 프롬프트가 길어지면 비용이 늘고,
 * 정작 오늘 전사가 묻힌다. 사람이 회의 직전에 훑어볼 만큼만 넣는다.
 */

import type { CrmDb } from '../db/client.ts'
import type { MeetingContext } from '../ai/prompts/meeting-extract.v1.ts'
import { kstDateKey } from '../../datetime/kst.ts'

/** 프롬프트에 넣는 상한 — 넘기면 오늘 전사가 맥락에 묻힌다 */
export const MAX_KNOWN_PEOPLE = 30
export const MAX_OPEN_TASKS = 10
export const MAX_RECENT_MEETINGS = 3
export const MAX_SUMMARY_CHARS = 200

/** 자를 때는 잘랐다고 표시한다 — 조용히 자르면 AI 가 끊긴 문장을 사실로 읽는다 */
function clip(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, ' ')
  return t.length <= max ? t : `${t.slice(0, max)}…`
}

export async function loadExtractContext(
  db: CrmDb,
  companyId: string | null,
  dealId: string | null,
): Promise<MeetingContext> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const company = companyId ? await (db as any).crmCompany.findFirst({
    where: { id: companyId }, select: { name: true, domain: true, industry: true, region: true },
  }) : null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deal = dealId ? await (db as any).crmDeal.findFirst({
    where: { id: dealId }, select: { name: true, stageId: true, amountMinor: true, currency: true, pipelineId: true },
  }) : null

  let stageName: string | null = null
  let stageNames: string[] = []
  if (deal) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stages = await (db as any).crmStage.findMany({
      where: { pipelineId: deal.pipelineId }, orderBy: { position: 'asc' },
      select: { id: true, name: true },
    }) as { id: string; name: string }[]
    stageNames = stages.map((s) => s.name)
    stageName = stages.find((s) => s.id === deal.stageId)?.name ?? null
  }

  // 우리 쪽 사람 이름 — AI 가 이들을 고객사 인물로 제안하지 않게 한다
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const members = await (db as any).crmMember.findMany({
    select: { displayName: true }, take: 200,
  }) as { displayName: string }[]

  // 이 회사에 이미 있는 사람 — 같은 사람을 또 만들지 않게
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const people = companyId ? await (db as any).crmPerson.findMany({
    where: { companyId },
    select: { name: true, title: true },
    orderBy: { updatedAt: 'desc' },
    take: MAX_KNOWN_PEOPLE,
  }) as { name: string; title: string | null }[] : []

  // 이 딜에 이미 잡혀 있는 할 일 — 같은 일을 또 제안하지 않게
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tasks = dealId ? await (db as any).crmTask.findMany({
    where: { dealId, status: { in: ['TODO', 'DOING'] } },
    select: { title: true },
    orderBy: { dueAt: 'asc' },
    take: MAX_OPEN_TASKS,
  }) as { title: string }[] : []

  // 지난 회의 — 그때 정리된 것을 오늘 결정처럼 다시 올리지 않게.
  // 딜이 있으면 그 딜의 회의, 없으면 그 회사의 회의를 본다.
  const meetingWhere = dealId ? { dealId } : companyId ? { companyId } : null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const past = meetingWhere ? await (db as any).crmMeeting.findMany({
    where: meetingWhere,
    select: { title: true, startedAt: true, summaryMd: true },
    orderBy: { startedAt: 'desc' },
    take: MAX_RECENT_MEETINGS,
  }) as { title: string; startedAt: Date; summaryMd: string | null }[] : []

  return {
    meetingDate: undefined as string | undefined,
    ourNames: members.map((m) => m.displayName).filter(Boolean),
    knownPeople: people.map((p) => ({ name: p.name, title: p.title })),
    openTasks: tasks.map((t) => t.title).filter(Boolean),
    recentMeetings: past.map((m) => ({
      date: kstDateKey(m.startedAt.toISOString()),
      title: m.title,
      // 요약을 통째로 넣으면 오늘 전사가 묻힌다 — 무슨 회의였는지 알 만큼만
      summary: m.summaryMd ? clip(m.summaryMd, MAX_SUMMARY_CHARS) : null,
    })),
    company,
    deal: deal ? {
      name: deal.name, stageName,
      amountMinor: deal.amountMinor ? String(deal.amountMinor) : null,
      currency: deal.currency,
    } : null,
    stageNames,
  }
}
