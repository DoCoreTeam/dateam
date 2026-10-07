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
  /**
   * 오늘 이 월물에 쌓인 거래량 합(계약). **못 읽었으면 null** —
   * 0 으로 적으면 「한 계약도 안 붙었다」는 사실이 되고, 그것은 못 읽은 것과 다른 말이다
   */
  todayVolume: number | null
  /**
   * 월물 표가 근월물로 표시한 코드. 이 월물과 같으면 아무 말도 안 붙는다.
   * 못 읽었으면 null — 모르는 것으로 경고를 만들지 않는다
   */
  exchangeFrontCode: string | null
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
  const what = !name && !month
    ? contract.code
    : `${[name, month].filter(Boolean).join(' ')} (${contract.code})`
  return [what, ...contractNotes(contract)].join(' · ')
}

/**
 * 머리글 뒤에 붙는 말 — **이 월물이 얼마나 거래되는가**
 *
 * ## 왜 거래량을 머리글에 적나 (실측 2026-10-07)
 *
 * 화면이 11월물을 그리는 동안 거래는 10월물에 있었다. 그날 거래량이
 * **10월물 112,701 대 11월물 5,036** 으로 22배 차이였고 현재가도 3.52점 달랐다.
 * 화면은 그 사실을 한 글자도 안 적었고, 사용자는 자기 증권사 화면과 값이 달라서야
 * 「데이터가 잘못되었네」라고 물었다. 월물 이름만으로는 그것이 거래되는 월물인지 알 수 없다.
 *
 * 교체 규칙은 고쳤지만 만기마다 다시 올 수 있는 일이다 — 규칙은 틀릴 수 있고,
 * **틀린 것이 눈에 보이는 자리**가 있어야 다음에는 묻기 전에 안다.
 */
function contractNotes(contract: ContractHead): string[] {
  const notes: string[] = []
  // 못 읽은 것을 0 으로 적지 않는다. 숫자가 없는 자리는 비운다
  if (typeof contract.todayVolume === 'number') {
    notes.push(`오늘 ${contract.todayVolume.toLocaleString('ko-KR')}계약`)
  }
  /*
    **「근월물」이라고 안 쓴다.** 사용자 개입 2026-09-30 이 그 말을 머리글에서 뺐고,
    가드가 그 사실을 지킨다. 읽는 사람이 알아야 하는 것은 용어가 아니라
    **지금 보는 것이 증권사가 기준으로 삼는 월물과 다르다**는 사실 하나다
  */
  const front = contract.exchangeFrontCode
  if (typeof front === 'string' && front !== '' && front !== contract.code) {
    notes.push(`증권사 기준 월물은 ${front}`)
  }
  return notes
}

/** 만기월 한 줄. 날짜가 깨졌으면 없는 것으로 친다 */
function monthText(expiryMonth: string | null): string | null {
  if (!expiryMonth) return null
  const m = /^(\d{4})-(\d{2})/.exec(expiryMonth)
  if (!m) return null
  return `${m[1]}년 ${Number(m[2])}월물`
}
