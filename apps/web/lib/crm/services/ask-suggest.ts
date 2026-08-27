/**
 * 「확인이 필요한 것」 — **AI 가 못 채운 자리를 사람에게 되묻는다.**
 *
 * 사용자 지시(2026-08-27): *"AI가 CRM에 있는 모든 데이터와 고객사 정보를 고려해서
 * 구조화된 데이터를 채우고 **모르는건 이건 니가 채워야해** 라고 알려줘야 하고"*.
 *
 * 미팅이 끝나면 5축이 아는 것을 채운다(`extractFiveAxis`). 그런데 **못 채운 것을
 * 아무도 말해 주지 않으면** 사용자는 다 된 줄 안다 — 그리고 그 빈칸은 리포트가
 * 틀린 숫자를 낼 때가 되어서야 발견된다.
 *
 * **왜 제안(CrmSuggestion)으로 저장하지 않는가 — 이게 이 파일의 설계 결정이다.**
 * 질문은 사실이 아니라 **지금 상태의 그림자**다. 저장해 두면 사용자가 다른 화면에서
 * 그 값을 채운 뒤에도 질문이 인박스에 남는다 — "채웠는데 왜 계속 물어보지".
 * 읽을 때 계산하면 답한 질문은 **저절로 사라진다.** 표도 enum 도 늘리지 않는다.
 *
 * **AI 를 부르지 않는다.** 미팅 하나가 걸린 회사·딜은 한 건씩이라 빈칸이 많아야 여섯이다.
 * 규칙이 정확하고 공짜이며 실패하지 않는다 —
 * AI 는 목록이 수십 건이라 **우선순위가 필요할 때** 쓴다(`data-check.ts` 가 그 자리다).
 *
 * **여기서 아무것도 고치지 않는다.** 무엇이 비었는지 말하고 그 화면으로 보낼 뿐이다
 * (절대규칙 1 — 자동으로 채우면 그 값이 어디서 왔는지 아무도 모른다).
 */

import type { CrmDb } from '../db/client.ts'

export interface OpenQuestion {
  /** 안정된 키 — 화면이 목록을 그릴 때 쓰고, 가드가 중복을 잡는다 */
  key: string
  /** 사람에게 던지는 **질문**. 「금액 없음」이 아니라 「얼마짜리인가요?」 */
  ask: string
  /** 왜 물어보는가 — 이유 없는 물음은 잔소리로 읽히고 두 번째부터 무시된다 */
  why: string
  /** 어디서 답하나 */
  href: string
}

export interface AskInput {
  meetingId: string
  companyId: string | null
  dealId: string | null
}

/** 한 번에 던지는 질문 수 — 넘으면 사람이 목록 전체를 닫는다 */
export const MAX_QUESTIONS = 6

/**
 * 이 미팅을 두고 **아직 모르는 것**을 모은다.
 *
 * 고르는 기준은 `data-check.ts` 와 같다 — **영업이 실제로 손해를 보는 것만.**
 * "빈칸이니까" 넣은 항목은 하나도 없다.
 */
export async function listOpenQuestions(db: CrmDb, input: AskInput): Promise<OpenQuestion[]> {
  const out: OpenQuestion[] = []
  const meetingHref = `/crm/meetings/${input.meetingId}`

  // ── 귀속: 예정에 없던 미팅이면 이것부터다. 회사를 모르면 나머지 질문이 전부 무의미하다
  if (!input.companyId) {
    out.push({
      key: 'meeting.company',
      ask: '어느 회사와 만난 건가요?',
      why: '회사를 정해야 이 기록이 그 거래처 이력에 남아요.',
      href: meetingHref,
    })
    return out
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const company = await (db as any).crmCompany.findFirst({
    where: { id: input.companyId },
    select: { id: true, name: true, domain: true },
  }) as { id: string; name: string; domain: string | null } | null
  if (!company) return out

  if (!input.dealId) {
    out.push({
      key: 'meeting.deal',
      ask: `${company.name} 의 어떤 건인가요?`,
      why: '딜을 정해야 금액·단계가 파이프라인에 반영돼요.',
      href: meetingHref,
    })
  }

  if (!company.domain) {
    out.push({
      key: 'company.domain',
      ask: `${company.name} 의 홈페이지 주소를 아시나요?`,
      why: '도메인이 같은 회사를 하나로 봐요 — 없으면 같은 거래처가 둘로 늘어납니다.',
      href: `/crm/companies/${company.id}`,
    })
  }

  if (!input.dealId) return out.slice(0, MAX_QUESTIONS)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deal = await (db as any).crmDeal.findFirst({
    where: { id: input.dealId },
    select: {
      id: true, name: true, status: true,
      amountMinor: true, expectedCloseDate: true, ownerId: true,
      contacts: { select: { id: true }, take: 1 },
    },
  }) as {
    id: string; name: string; status: string
    amountMinor: bigint | null; expectedCloseDate: Date | null; ownerId: string | null
    contacts: { id: string }[]
  } | null
  if (!deal) return out.slice(0, MAX_QUESTIONS)

  // 끝난 딜의 빈칸은 고칠 이유가 없다 — 물으면 그때부터 목록 전체가 잔소리가 된다
  if (deal.status !== 'OPEN') return out.slice(0, MAX_QUESTIONS)

  const dealHref = `/crm/deals/${deal.id}`

  if (deal.amountMinor === null) {
    out.push({
      key: 'deal.amount',
      ask: '얼마짜리 건인가요?',
      why: '금액이 없으면 이 딜은 예상 매출에서 통째로 빠져요.',
      href: dealHref,
    })
  }

  if (!deal.expectedCloseDate) {
    out.push({
      key: 'deal.closeDate',
      ask: '언제쯤 결정될까요?',
      why: '성사 예정일이 없으면 이번 달·다음 달 숫자에 잡히지 않아요.',
      href: dealHref,
    })
  }

  if (!deal.ownerId) {
    out.push({
      key: 'deal.owner',
      ask: '이 건은 누가 맡나요?',
      why: '담당자가 없으면 아무도 자기 일로 여기지 않아요.',
      href: dealHref,
    })
  }

  if (deal.contacts.length === 0) {
    out.push({
      key: 'deal.contact',
      ask: '이 건은 누구에게 연락하면 되나요?',
      why: '연결된 사람이 없으면 다음에 누구를 찾아야 할지 알 수 없어요.',
      href: dealHref,
    })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const openTasks = await (db as any).crmTask.count({
    where: { dealId: deal.id, status: { in: ['TODO', 'DOING'] } },
  }) as number

  if (openTasks === 0) {
    out.push({
      key: 'deal.nextAction',
      ask: '다음에 무엇을 하기로 했나요?',
      why: '다음 할 일이 없는 딜은 조용히 멈춰 있게 돼요.',
      href: dealHref,
    })
  }

  return out.slice(0, MAX_QUESTIONS)
}
