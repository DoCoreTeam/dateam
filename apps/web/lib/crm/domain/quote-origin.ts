/**
 * 이 견적서를 **누가 냈나**, 그리고 우리는 그걸로 무엇을 하나
 *
 * ## 판정하지 않는다. 알려만 준다
 *
 * 올린 파일이 우리가 낸 견적서인지, 공급사에서 받은 것인지는 문서에서 읽을 수 있다.
 * 「공급자」 칸의 상호를 우리 상호와 견주면 된다.
 *
 * 그런데 **그 값으로 무엇을 할지는 문서에 없다.** 받은 견적서를 올리는 이유는
 * 원가로 남기려는 것일 수도 있고, 그냥 항목 몇 줄을 베껴 오려는 것일 수도 있다.
 * 그건 사람의 의도이고, 문서를 아무리 잘 읽어도 알 수 없다
 * (사용자 지시 2026-09-19: 「원가가 원가가 아닐 수도 있고, 그냥 다른 견적서에서
 * 내용들을 가지고 오려고 넣은 걸 수도 있고」).
 *
 * 그래서 이 파일은 **라벨만 만든다.** 라벨은 화면에 한 줄로 뜨고, 거기서 끝이다.
 * 기본 도착지는 라벨이 무엇이든 늘 같다 — `defaultDestination` 이 그 약속이고,
 * 가드가 그 약속을 센다.
 *
 * ## 이름 대조를 여기 한 곳에 둔다
 *
 * 「(주)데이터얼라이언스」와 「주식회사 데이터얼라이언스」와 「데이터얼라이언스」는
 * 같은 회사다. 화면마다 각자 비교하면 어떤 화면은 같다 하고 어떤 화면은 다르다 한다.
 */

/** 이 문서를 낸 쪽이 우리인가 */
export type QuoteOrigin =
  /** 공급자 칸이 우리 상호다 */
  | 'ours'
  /** 공급자 칸이 우리가 아니다 — 받은 문서로 보인다 */
  | 'received'
  /** 견줄 것이 없다. 문서에 공급자가 없거나, 우리 상호 설정이 비어 있다 */
  | 'unknown'

/**
 * 읽은 건을 어디로 보내나.
 *
 * **네 길뿐이고, 고르는 것은 사람이다.** 라벨이나 금액이 이 값을 대신 정하지 않는다.
 */
export type QuoteDestination =
  /** 새 견적을 만든다 */
  | 'new_quote'
  /** 이미 있는 견적에 항목만 붙인다 — 다른 견적서에서 몇 줄 가져오는 가장 흔한 쓰임 */
  | 'append'
  /** 딜 원가로 넣는다 (관리자만) */
  | 'cost'
  /** 이 건은 안 쓴다 */
  | 'skip'

/**
 * 기본 도착지.
 *
 * **라벨을 인자로 받지 않는다.** 받으면 언젠가 「받은 문서면 원가로」 같은 분기가
 * 이 자리에 들어오고, 그 순간 사람이 고르기 전에 시스템이 정하는 것이 된다.
 */
export const DEFAULT_DESTINATION: QuoteDestination = 'new_quote'

/** 어떤 라벨이든 기본은 새 견적이다 */
export function defaultDestination(): QuoteDestination {
  return DEFAULT_DESTINATION
}

/**
 * 법인 표기와 띄어쓰기와 대소문자를 걷어낸 이름.
 *
 * 「(주)」·「주식회사」·「Co., Ltd.」는 같은 회사를 다르게 적은 것뿐이라 지운다.
 * 지우고 나서 남는 것이 두 글자보다 짧으면 이름으로 치지 않는다 — 「(주)」만 적힌
 * 칸을 이름으로 보면 아무 회사나 우리 회사가 된다.
 */
export function normalizeCompanyName(name: string | null | undefined): string {
  if (typeof name !== 'string') return ''
  let s = name.normalize('NFKC').toLowerCase()
  // 법인 표기 — 앞에 붙든 뒤에 붙든 같은 말이다
  s = s.replace(/주식회사|유한회사|유한책임회사|합자회사|\(주\)|\(유\)|㈜|㈜/g, ' ')
  s = s.replace(/\b(co|ltd|inc|corp|corporation|company|llc|plc|gmbh|s\.?a\.?)\b\.?/g, ' ')
  // 구두점과 공백은 표기 차이일 뿐이다
  s = s.replace(/[\s.,·・\-_'"()[\]{}/\\]+/g, '')
  return s
}

/** 두 이름이 같은 회사를 가리키나 */
export function isSameCompany(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normalizeCompanyName(a)
  const y = normalizeCompanyName(b)
  // 두 글자 미만은 이름이 아니다. 「(주)」만 남은 값끼리 같다고 하면 전부 우리 회사가 된다
  if (x.length < 2 || y.length < 2) return false
  if (x === y) return true
  /*
    한쪽이 다른 쪽을 품는 경우도 같은 회사로 본다 —
    「데이터얼라이언스」와 「데이터얼라이언스에이엑스사업본부」가 실제로 같이 쓰인다.
    짧은 쪽이 네 글자는 돼야 한다. 두 글자 조각은 남의 상호에도 흔히 들어 있다.
  */
  const short = x.length <= y.length ? x : y
  const long = x.length <= y.length ? y : x
  return short.length >= 4 && long.includes(short)
}

export interface QuoteOriginInput {
  /** 문서의 「공급자」 칸에 적힌 상호 */
  documentSupplierName: string | null | undefined
  /** 설정 quote.supplier.name — 우리 상호 */
  ourSupplierName: string | null | undefined
}

/**
 * 라벨을 만든다.
 *
 * **모르면 모른다고 한다.** 우리 상호 설정이 비어 있을 때 「받은 문서」라고 말하면,
 * 설정을 안 채운 워크스페이스에서는 우리가 낸 견적서가 전부 남의 것이 된다.
 */
export function judgeQuoteOrigin(input: QuoteOriginInput): QuoteOrigin {
  const ours = normalizeCompanyName(input.ourSupplierName)
  const doc = normalizeCompanyName(input.documentSupplierName)
  if (ours.length < 2 || doc.length < 2) return 'unknown'
  return isSameCompany(input.documentSupplierName, input.ourSupplierName) ? 'ours' : 'received'
}
