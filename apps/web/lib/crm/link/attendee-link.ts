/**
 * 참석자 한 명을 CRM 인물과 이을지 정한다 (SSOT)
 *
 * **왜 이 파일이 생겼나**: 회의에 나온 이름을 CRM 인물로 만드는 일이
 * 지금까지 「전부 어렵다」로 묶여 아무것도 안 이어져 있었다 — 실측으로 회의 18건 중
 * 회사가 이어진 것은 1건이고, 그 1건마저 **틀린 회사**였다(김범석 과장 · 코나아이 → 영진기술).
 *
 * 그런데 갈라 보면 어려운 것은 일부다:
 *   · 「숙명여대 이기용 교수」 — CRM 에 그 이름이 그 회사로 하나뿐이다. 판단할 게 없다
 *   · 「한국산업단지공단 경북본부」 — 본사와 본부가 둘 다 있다. 사람이 골라야 한다
 *   · 「gcube」 — 우리 제품이다. 거래처로 세면 안 된다
 *
 * 셋을 섞어 두면 전부 어려워 보이고, 그래서 아무것도 안 된다.
 * 이 파일이 셋을 가른다.
 *
 * **원칙: 애매하면 잇지 않는다.** 틀린 회사에 붙은 기록은 지워도
 * 「그 회사와 그런 일이 있었다」는 기억을 남긴다 — 못 잇는 것보다 나쁘다.
 * `name-match.ts` 가 회사에 대해 정한 것과 같은 원칙이다.
 */

import { nameKey } from './name-match.ts'
import type { ParsedAttendee } from '../../meeting/attendee-parse.ts'

/**
 * 우리 회사·제품 이름.
 *
 * **왜 필요한가**: `gcube` 가 CRM 에 회사로 등록돼 있다(실측 · `gcube.ai`).
 * 그래서 회의 본문에 우리 제품 이름이 나올 때마다 거래처가 언급된 것으로 잡힌다 —
 * 실측 회의 4건이 그렇다. 우리를 거래처로 세면 맞는 후보가 가려진다.
 */
export const OWN_ORG_NAMES = ['gcube', '지큐브', '데이터얼라이언스', 'data alliance'] as const

export function isOwnOrg(name: string | null | undefined): boolean {
  const key = nameKey(name)
  if (!key) return false
  return OWN_ORG_NAMES.some((own) => nameKey(own) === key)
}

/** CRM 인물 후보 — 이름만으로는 못 가리므로 소속을 함께 받는다 */
export interface PersonCandidate {
  id: string
  name: string
  companyId: string | null
  companyName: string | null
  title: string | null
}

export interface CompanyCandidate {
  id: string
  name: string
}

export type LinkTier =
  /** 이어도 되는 것 — 판단할 게 없다 */
  | 'link'
  /** 여쭐 것 — 후보가 여럿이거나 어긋난다 */
  | 'review'
  /** 걸러낼 것 — 인물이 아니거나 우리 자신이다 */
  | 'drop'

export type LinkReason =
  | 'exact-one'          // 이름과 소속이 한 사람으로 좁혀졌다
  | 'name-only-one'      // 소속을 안 적었는데 그 이름이 CRM 에 한 명뿐이다
  | 'new-person'         // CRM 에 없는 사람 — 회사는 확실하다
  | 'homonym'            // 같은 이름이 여럿이다
  | 'company-mismatch'   // 그 이름은 있는데 소속이 다르다
  | 'company-ambiguous'  // 회사 후보가 여럿이다
  | 'company-unknown'    // 회사가 CRM 에 없다
  | 'not-a-person'       // 인원수 표기이거나 이름으로 볼 수 없다
  | 'own-org'            // 우리 회사·제품

export interface LinkDecision {
  parsed: ParsedAttendee
  tier: LinkTier
  reason: LinkReason
  /** 이을 인물. tier 가 'link' 이고 기존 인물일 때만 채워진다 */
  personId: string | null
  /** 붙일 회사. 새 인물을 만들 때 소속으로 쓴다 */
  companyId: string | null
  /** 사람이 골라야 할 때의 후보들 — 화면이 그대로 보여 준다 */
  people: PersonCandidate[]
  companies: CompanyCandidate[]
}

function base(parsed: ParsedAttendee): LinkDecision {
  return {
    parsed, tier: 'drop', reason: 'not-a-person',
    personId: null, companyId: null, people: [], companies: [],
  }
}

/** 이름이 같은 인물 후보를 고른다 */
function peopleByName(name: string, people: PersonCandidate[]): PersonCandidate[] {
  const key = nameKey(name)
  if (!key) return []
  return people.filter((p) => nameKey(p.name) === key)
}

/** 이름이 같은 회사 후보를 고른다 */
function companiesByName(name: string, companies: CompanyCandidate[]): CompanyCandidate[] {
  const key = nameKey(name)
  if (!key) return []
  return companies.filter((c) => nameKey(c.name) === key)
}

/**
 * 참석자 한 명을 어느 층으로 보낼지 정한다.
 *
 * 판정 순서가 규칙이다 — 걸러낼 것을 **먼저** 빼야 나머지 판정이 흐려지지 않는다.
 */
export function linkAttendee(
  parsed: ParsedAttendee,
  candidates: { people: PersonCandidate[]; companies: CompanyCandidate[] },
): LinkDecision {
  const out = base(parsed)

  // ① 걸러낼 것 — 사람이 아니거나 우리 자신
  if (parsed.kind !== 'person') return { ...out, tier: 'drop', reason: 'not-a-person' }
  if (isOwnOrg(parsed.company) || isOwnOrg(parsed.name)) {
    return { ...out, tier: 'drop', reason: 'own-org' }
  }

  const named = peopleByName(parsed.name, candidates.people)

  // ② 이름이 여럿 — 우리가 고르면 남의 회의가 엉뚱한 사람에게 붙는다
  if (named.length > 1) {
    // 소속까지 적혀 있으면 그것으로 좁혀 본다
    if (parsed.company) {
      const narrowed = named.filter((p) => nameKey(p.companyName) === nameKey(parsed.company))
      if (narrowed.length === 1) {
        return { ...out, tier: 'link', reason: 'exact-one', personId: narrowed[0].id, companyId: narrowed[0].companyId, people: narrowed }
      }
    }
    return { ...out, tier: 'review', reason: 'homonym', people: named }
  }

  // ③ 이름이 하나 — 소속이 맞는지 본다
  if (named.length === 1) {
    const hit = named[0]
    if (!parsed.company) {
      // 소속을 안 적었다. 그 이름이 CRM 에 한 명뿐이므로 그 사람으로 본다
      return { ...out, tier: 'link', reason: 'name-only-one', personId: hit.id, companyId: hit.companyId, people: named }
    }
    if (nameKey(hit.companyName) === nameKey(parsed.company)) {
      return { ...out, tier: 'link', reason: 'exact-one', personId: hit.id, companyId: hit.companyId, people: named }
    }
    /**
     * 이름은 같은데 소속이 다르다 — 실측 「한국수자원공사 김경수 대리」 vs CRM 「쉐어월드 김경수 대표」.
     * 자동으로 이으면 남의 회의가 붙고, 자동으로 새로 만들면 같은 사람이 두 벌이 된다. 사람이 본다.
     */
    return { ...out, tier: 'review', reason: 'company-mismatch', people: named, companies: companiesByName(parsed.company, candidates.companies) }
  }

  // ④ CRM 에 없는 사람 — 새로 만들 후보다. 소속을 정할 수 있는지가 갈림길이다
  if (!parsed.company) {
    return { ...out, tier: 'review', reason: 'company-unknown', people: [] }
  }
  const cos = companiesByName(parsed.company, candidates.companies)
  if (cos.length === 1) {
    return { ...out, tier: 'link', reason: 'new-person', personId: null, companyId: cos[0].id, companies: cos }
  }
  if (cos.length > 1) {
    return { ...out, tier: 'review', reason: 'company-ambiguous', companies: cos }
  }
  return { ...out, tier: 'review', reason: 'company-unknown', companies: [] }
}

export function linkAttendees(
  parsed: ParsedAttendee[],
  candidates: { people: PersonCandidate[]; companies: CompanyCandidate[] },
): LinkDecision[] {
  return parsed.map((p) => linkAttendee(p, candidates))
}

/** 화면이 세 층으로 나눠 보여 줄 때 쓴다 */
export function groupByTier(decisions: LinkDecision[]): Record<LinkTier, LinkDecision[]> {
  return {
    link: decisions.filter((d) => d.tier === 'link'),
    review: decisions.filter((d) => d.tier === 'review'),
    drop: decisions.filter((d) => d.tier === 'drop'),
  }
}

/** 화면에 그대로 쓰는 말 — 왜 여쭙는지 사람이 읽을 수 있어야 한다 */
export const REASON_LABEL: Record<LinkReason, string> = {
  'exact-one': '이름과 소속이 맞습니다',
  'name-only-one': '그 이름이 한 명뿐입니다',
  'new-person': '새 인물로 만듭니다',
  'homonym': '같은 이름이 여럿입니다',
  'company-mismatch': 'CRM 의 소속과 다릅니다',
  'company-ambiguous': '회사 후보가 여럿입니다',
  'company-unknown': '소속을 알 수 없습니다',
  'not-a-person': '사람 이름이 아닙니다',
  'own-org': '우리 조직입니다',
}
