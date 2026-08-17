// 단계 진입 조건 (dacrm 명세 2.3 / 스키마 CrmStage.entryCriteriaJson)
//
// **왜 필요한가**: 파이프라인은 "이 단계까지 왔으면 최소한 이건 정해졌다"는 약속이다.
// 그 약속이 없으면 보드는 카드를 옮기는 놀이가 되고, 리포트의 단계별 합계는
// 아무것도 뜻하지 않는다 — 금액 없는 딜이 '계약 협상'에 들어 있기 때문이다.
//
// **왜 막지 않고 알려 주는가**: 영업은 순서대로 흐르지 않는다.
// 금액이 확정되기 전에 협상이 시작되는 일은 흔하다. 그래서 조건은 **경고**가 기본이고,
// 정말 막아야 하는 것만 `block` 으로 올린다(수주는 금액 없이 성립할 수 없다).
//
// 이 파일은 판정만 한다. 어떻게 보여 주고 무엇을 막을지는 호출부가 정한다.

import { iGa } from '../../ui/josa.ts'

/** 조건 하나가 보는 것 — 딜의 어떤 사실이 채워졌는가 */
export type CriterionKey =
  | 'amount'        // 금액이 정해졌나
  | 'closeDate'     // 마감 예정일이 있나
  | 'owner'         // 담당자가 있나
  | 'contact'       // 딜에 사람이 붙어 있나
  | 'company'       // 회사가 붙어 있나
  | 'nextTask'      // 다음에 할 일이 잡혀 있나

export type CriterionLevel = 'warn' | 'block'

export interface Criterion {
  key: CriterionKey
  level: CriterionLevel
}

/** 사람이 읽는 이름 — 화면에 `amount` 라고 적으면 개발자 말이다 */
export const CRITERION_LABEL: Record<CriterionKey, string> = {
  amount: '금액',
  closeDate: '마감 예정일',
  owner: '담당자',
  contact: '고객 담당자',
  company: '회사',
  nextTask: '다음 할 일',
}

/** 못 채웠을 때 사람에게 할 말 — "amount 없음"이 아니라 무엇을 하라고 말한다 */
const MISSING_TEXT: Record<CriterionKey, string> = {
  amount: '금액이 아직 없어요',
  closeDate: '마감 예정일이 아직 없어요',
  owner: '우리 쪽 담당자가 없어요',
  contact: '고객 쪽 담당자가 연결되지 않았어요',
  company: '회사가 연결되지 않았어요',
  nextTask: '다음에 할 일이 잡혀 있지 않아요',
}

export const ALL_CRITERIA: CriterionKey[] = ['amount', 'closeDate', 'owner', 'contact', 'company', 'nextTask']

/**
 * **채울 화면이 없는 조건은 설정에 띄우지 않는다.**
 *
 * 실측 사고: 딜 담당자(`ownerId`)를 넣는 입력 칸이 제품에 **0개**인데 조건 목록에는 있었다.
 * 그걸 '못 옮기게'로 켜면 그 단계는 **영원히 잠긴다** — 사용자가 채울 방법이 없기 때문이다.
 * 조건은 "사람이 채울 수 있는 것"에만 걸 수 있다. 입력 칸이 생기면 여기서 빼면 된다.
 */
export const CRITERIA_WITHOUT_INPUT: CriterionKey[] = ['owner']

/** 설정 화면에 띄울 조건 — 채울 방법이 있는 것만 */
export const CONFIGURABLE_CRITERIA: CriterionKey[] = ALL_CRITERIA.filter(
  (k) => !CRITERIA_WITHOUT_INPUT.includes(k),
)

/**
 * 단계의 **뜻** — "이 단계에 왔다는 게 무슨 뜻인가"를 사람 말로 적은 한 줄.
 *
 * **검사하지 않는다. 보여만 준다.** 진짜 exit criteria 는 대개 기계가 판정할 수 없다
 * ("고객이 요구사항을 문서로 줬다"). 그걸 6개 필드의 유무로 흉내 내려다
 * 342개짜리 설정 격자가 생겼고, 결국 **아무도 켜지 않았다**(실측: 342개 중 켜진 것 0).
 * 그래서 판정은 최소한만 하고, 나머지는 딜을 옮길 때 이 문장을 보여 주는 것으로 대신한다.
 */
export const MAX_MEANING_LEN = 120

/** 한 단계의 설정 전체 — 뜻 + 조건. 조건만 있던 옛 형태도 그대로 읽는다. */
export interface StageRules {
  meaning: string
  criteria: Criterion[]
}

/** 딜에서 조건 판정에 필요한 것만 — 서비스가 이 모양으로 모아 준다 */
export interface DealFacts {
  amountMinor: bigint | string | null
  closeDate: Date | string | null
  ownerId: string | null
  companyId: string | null
  contactCount: number
  openTaskCount: number
}

function isFilled(key: CriterionKey, d: DealFacts): boolean {
  switch (key) {
    // 0원은 "금액을 0으로 정했다"가 아니라 대개 "아직 안 정했다"이다.
    // 무료 계약이 실제로 있다면 그때 이 판정을 바꾼다.
    case 'amount': return d.amountMinor !== null && String(d.amountMinor) !== '' && String(d.amountMinor) !== '0'
    case 'closeDate': return d.closeDate !== null && d.closeDate !== ''
    case 'owner': return !!d.ownerId
    case 'company': return !!d.companyId
    case 'contact': return d.contactCount > 0
    case 'nextTask': return d.openTaskCount > 0
    default: return true
  }
}

export interface CriteriaVerdict {
  ok: boolean
  /** 막아야 하는 미충족 — 이게 있으면 이동시키지 않는다 */
  blocking: { key: CriterionKey; message: string }[]
  /** 알려 주기만 하는 미충족 — 이동은 시키되 화면이 말한다 */
  warnings: { key: CriterionKey; message: string }[]
}

/**
 * 조건 정의를 읽는다.
 *
 * DB 의 Json 은 무엇이든 들어올 수 있다 — 손상된 값 때문에 딜 이동이 통째로 막히면 안 되므로
 * 모르는 항목은 조용히 버린다(그게 없는 것과 같다). 대신 저장할 때 검증한다.
 */
export function parseCriteria(json: unknown): Criterion[] {
  // 새 형태 `{ meaning, criteria }` 도 읽는다 — 옛 형태(배열)와 같은 컬럼을 쓴다.
  // 마이그레이션 없이 담기 위해 **모양만 넓혔다**(M-4 추가 전용).
  if (json && typeof json === 'object' && !Array.isArray(json)) {
    return parseCriteria((json as Record<string, unknown>).criteria)
  }
  if (!Array.isArray(json)) return []
  const out: Criterion[] = []
  const seen = new Set<string>()
  for (const raw of json) {
    if (!raw || typeof raw !== 'object') continue
    const o = raw as Record<string, unknown>
    const key = o.key
    if (typeof key !== 'string' || !ALL_CRITERIA.includes(key as CriterionKey)) continue
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ key: key as CriterionKey, level: o.level === 'block' ? 'block' : 'warn' })
  }
  return out
}

/** 저장 전 검증 — 여기서 거르면 손상된 정의가 애초에 들어오지 않는다 */
export function normalizeCriteria(input: unknown): Criterion[] {
  return parseCriteria(input)
}

/**
 * 단계의 뜻을 읽는다. 옛 형태(배열)에는 뜻이 없으므로 빈 문자열이다.
 * 뜻이 비어 있는 것은 정상이다 — **적으라고 강요하지 않는다.**
 */
export function parseMeaning(json: unknown): string {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return ''
  const m = (json as Record<string, unknown>).meaning
  return typeof m === 'string' ? m.trim().slice(0, MAX_MEANING_LEN) : ''
}

/** 저장 전 정리 — 길이를 자르고 앞뒤 공백을 없앤다. */
export function normalizeMeaning(input: unknown): string {
  return typeof input === 'string' ? input.trim().slice(0, MAX_MEANING_LEN) : ''
}

/**
 * DB 에 넣을 모양. **뜻이 없으면 옛 형태(배열) 그대로 쓴다** —
 * 안 쓰는 래퍼를 씌우면 옛 판으로 되돌아갔을 때 조건이 통째로 안 읽힌다(M-4 상위 호환).
 */
export function toStageRulesJson(rules: StageRules): unknown {
  return rules.meaning ? { meaning: rules.meaning, criteria: rules.criteria } : rules.criteria
}

/** 저장된 값 → 화면·판정이 쓰는 모양. 옛 배열과 새 객체를 모두 읽는다. */
export function parseStageRules(json: unknown): StageRules {
  return { meaning: parseMeaning(json), criteria: parseCriteria(json) }
}

export function evaluateCriteria(criteria: Criterion[], facts: DealFacts): CriteriaVerdict {
  const blocking: { key: CriterionKey; message: string }[] = []
  const warnings: { key: CriterionKey; message: string }[] = []

  for (const c of criteria) {
    if (isFilled(c.key, facts)) continue
    const entry = { key: c.key, message: MISSING_TEXT[c.key] }
    if (c.level === 'block') blocking.push(entry)
    else warnings.push(entry)
  }

  return { ok: blocking.length === 0, blocking, warnings }
}

/**
 * 막힌 이유를 한 문장으로 — 사용자가 무엇을 해야 하는지 알 수 있게.
 *
 * 조사는 지어내지 않고 `lib/ui/josa` 가 판정한다. 예전엔 `${what}이(가)` 로 병기해서
 * 실제 화면에 **"금액이(가) 필요합니다"** 가 그대로 나갔다 — 사람이 쓴 말로 안 읽힌다.
 */
export function blockingMessage(v: CriteriaVerdict): string | null {
  if (v.blocking.length === 0) return null
  const what = v.blocking.map((b) => CRITERION_LABEL[b.key]).join('·')
  return `이 단계로 옮기려면 ${what}${iGa(what)} 필요합니다.`
}
