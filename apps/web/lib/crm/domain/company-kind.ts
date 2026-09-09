/**
 * 도메인으로 아는 기관 종류 — 규칙이 공짜로 답하는 자리
 *
 * **왜 규칙인가**: 회사 381곳 중 **도메인이 313곳(82%)** 있다. 그중 219곳은
 * 꼬리만 보면 종류가 정해진다 — `ac.kr` 은 학교이고 `go.kr` 은 정부다.
 * 이건 **우리가 정한 분류가 아니라 한국 도메인 이름 규칙이 정한 사실**이다.
 * 우리가 「B2B·B2G」 같은 영업 구분을 코드에 적는 것과는 다르다 — 그건 데이터에서 온다.
 *
 * **그런데 이것까지 웹 검색으로 물어보다 막혔다.** 회사 보강 37건이 전부
 * 할당량 초과로 실패했고(마지막 2026-08-24) 그 뒤 아무도 다시 시도하지 않았다.
 * 되묻기 서비스가 이미 적어 놓은 원칙이 여기 그대로 적용된다 —
 * **「규칙이 정확하고 공짜이며 실패하지 않는다. AI 는 규칙으로 안 되는 것에 쓴다」**
 *
 * **이 파일은 순수하다.** DB 도 AI 도 모른다. 화면·서비스·보강 잡이 같은 답을 본다.
 */

/**
 * 기관 종류.
 *
 * **영업 구분(B2B·B2G 같은 것)이 아니다.** 그건 우리가 정하는 것이라 데이터에서 와야 한다.
 * 여기 있는 것은 «도메인이 말해 주는 사실»뿐이고, 목록을 늘리려면
 * **그 꼬리가 실제로 그 뜻을 보장해야** 한다.
 */
export type CompanyKind = 'school' | 'government' | 'public' | 'research' | 'company' | 'nonprofit'

export const COMPANY_KIND_LABEL: Record<CompanyKind, string> = {
  school: '학교',
  government: '정부·지자체',
  public: '공공기관',
  research: '연구기관',
  company: '기업',
  nonprofit: '비영리',
}

/** 어느 꼬리가 무엇을 뜻하나 — 사람이 「왜 이렇게 판정됐지」를 되짚을 수 있게 */
export const COMPANY_KIND_EVIDENCE: Record<CompanyKind, string> = {
  school: '학교 전용 도메인',
  government: '정부·지자체 전용 도메인',
  public: '공공기관·협회 전용 도메인',
  research: '연구기관 전용 도메인',
  company: '기업 도메인',
  nonprofit: '비영리 도메인',
}

/**
 * 꼬리 → 종류.
 *
 * **긴 꼬리를 먼저 본다.** `ac.kr` 을 `kr` 보다 먼저 보지 않으면 학교가 전부 기업이 된다.
 * 그래서 목록을 길이 내림차순으로 정렬해 두고 앞에서부터 맞춘다.
 */
const SUFFIX_KIND: readonly (readonly [string, CompanyKind])[] = [
  // 한국 — 꼬리가 뜻을 보장한다
  ['.ac.kr', 'school'],
  ['.go.kr', 'government'],
  ['.or.kr', 'public'],
  ['.re.kr', 'research'],
  ['.ms.kr', 'school'],
  ['.hs.kr', 'school'],
  ['.es.kr', 'school'],
  ['.sc.kr', 'school'],
  ['.co.kr', 'company'],
  // 국제 — 등록 제한이 있는 것만. `.com` 은 누구나 받으므로 여기 없다
  ['.edu', 'school'],
  ['.gov', 'government'],
  ['.mil', 'government'],
  ['.int', 'public'],
  ['.ac.uk', 'school'],
  ['.edu.au', 'school'],
  ['.edu.cn', 'school'],
]

/**
 * 마지막 그물 — 위에서 안 걸린 것.
 *
 * `.com`·`.net` 은 **누구나 받을 수 있어** 종류를 보장하지 않는다.
 * 그래도 실무에서 회사가 압도적이라 «기업»으로 둔다.
 * 대신 `confident` 를 false 로 내려 **사람이 고칠 여지를 남긴다** —
 * 확신과 추정을 같은 값으로 저장하면 나중에 어느 쪽이 사실인지 알 수 없다.
 */
const WEAK_COMPANY: readonly string[] = ['.com', '.net', '.io', '.ai', '.biz', '.kr']
const WEAK_NONPROFIT: readonly string[] = ['.org']

export interface KindGuess {
  kind: CompanyKind
  /** 꼬리가 뜻을 보장하나. false 면 사람이 확인해야 한다 */
  confident: boolean
  /** 무엇을 보고 그렇게 판정했나 */
  evidence: string
}

/**
 * 도메인에서 종류를 읽는다.
 *
 * **모르면 null 이다.** 「기타」로 접어 넣지 않는다 — 모른다는 사실을 값으로 위장하면
 * 그 값으로 거르는 일이 영영 안 된다(회사 보강 스키마가 같은 이유로
 * 구간 밖 직원 수를 null 로 접는다).
 */
export function kindFromDomain(domain: string | null | undefined): KindGuess | null {
  if (!domain) return null
  const d = domain.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split('/')[0]
  if (!d.includes('.')) return null

  for (const [suffix, kind] of SUFFIX_KIND) {
    if (d.endsWith(suffix)) {
      return { kind, confident: true, evidence: `${suffix} — ${COMPANY_KIND_EVIDENCE[kind]}` }
    }
  }
  for (const suffix of WEAK_NONPROFIT) {
    if (d.endsWith(suffix)) {
      return { kind: 'nonprofit', confident: false, evidence: `${suffix} — 누구나 받을 수 있어 확인이 필요합니다` }
    }
  }
  for (const suffix of WEAK_COMPANY) {
    if (d.endsWith(suffix)) {
      return { kind: 'company', confident: false, evidence: `${suffix} — 누구나 받을 수 있어 확인이 필요합니다` }
    }
  }
  return null
}

/**
 * 이 회사들 중 규칙만으로 답이 나오는 곳이 몇인가.
 *
 * 보강을 시작하기 전에 **「AI 없이 여기까지 됩니다」**를 사람에게 먼저 보여주려고 있다.
 * 숫자를 안 보여주면 사용자는 전부 AI 가 도는 줄 알고, 한도가 막히면 전부 멈춘 줄 안다.
 */
export function countRuleAnswerable(
  companies: readonly { domain: string | null | undefined }[],
): { confident: number; weak: number; unknown: number } {
  let confident = 0
  let weak = 0
  let unknown = 0
  for (const c of companies) {
    const g = kindFromDomain(c.domain)
    if (!g) unknown += 1
    else if (g.confident) confident += 1
    else weak += 1
  }
  return { confident, weak, unknown }
}
