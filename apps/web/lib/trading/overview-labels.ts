/**
 * 현황 머리글이 쓰는 말 — **월물 기호는 이름이 아니다**
 *
 * 사용자 개입 2026-09-30: 「A05610 근월물을 모으는 중입니다. 알림은 검증 단계를 지난 뒤에
 * 켭니다 — 이런 내용은 또 왜 있는지 모르겠네」.
 *
 * 그 줄에는 사실이 둘 섞여 있었고 둘 다 읽는 사람 것이 아니었다.
 * 「근월물」은 선물 용어이고, 「알림은 검증 단계를 지난 뒤에」는 알림 칸이 이미 하는 말이다.
 * 머리글은 **무엇을 보고 있는 화면인지** 하나만 말하면 된다.
 */

/** 종목 뿌리 기호를 사람이 부르는 이름으로. 모르는 기호는 기호 그대로 둔다 */
const ROOT_NAME: Record<string, string> = {
  KOSPI200: '코스피200 선물',
  MINI_KOSPI200: '미니 코스피200 선물',
}

/** 종목을 못 정했을 때. 「아직 없다」와 「고장」은 다른 사실이라 말도 달라야 한다 */
export const NO_CONTRACT_TEXT = '아직 볼 종목이 안 정해졌습니다. 종목 정보가 들어오면 여기에 뜹니다'

export interface ContractHead {
  /** 월물 기호 (예: A05610) */
  code: string
  /** 종목 뿌리 (예: MINI_KOSPI200). 모르면 null */
  root: string | null
  /** 만기월 첫날 (예: 2026-10-01). 모르면 null */
  expiryMonth: string | null
}

/**
 * 머리글 한 줄 — 무슨 종목의 몇 월물인가.
 *
 * 기호를 버리지 않고 괄호에 남긴다. 기호로 찾아보는 사람도 있고,
 * 무엇보다 **화면이 부르는 이름과 시스템이 쓰는 값이 같은 줄에 있어야** 둘이 안 갈린다.
 */
export function contractHeadline(contract: ContractHead | null): string {
  if (!contract) return NO_CONTRACT_TEXT
  const name = contract.root ? ROOT_NAME[contract.root] ?? contract.root : null
  const month = monthText(contract.expiryMonth)
  // 이름도 만기월도 모르면 기호만 말한다. 모르는 것을 지어내지 않는다
  if (!name && !month) return contract.code
  return `${[name, month].filter(Boolean).join(' ')} (${contract.code})`
}

/** 만기월 한 줄. 날짜가 깨졌으면 없는 것으로 친다 */
function monthText(expiryMonth: string | null): string | null {
  if (!expiryMonth) return null
  const m = /^(\d{4})-(\d{2})/.exec(expiryMonth)
  if (!m) return null
  return `${m[1]}년 ${Number(m[2])}월물`
}
