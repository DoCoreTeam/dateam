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
 */

import type { CrmDb } from '../db/client.ts'
import type { MeetingContext } from '../ai/prompts/meeting-extract.v1.ts'

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

  return {
    meetingDate: undefined as string | undefined,
    ourNames: members.map((m) => m.displayName).filter(Boolean),
    company,
    deal: deal ? {
      name: deal.name, stageName,
      amountMinor: deal.amountMinor ? String(deal.amountMinor) : null,
      currency: deal.currency,
    } : null,
    stageNames,
  }
}
