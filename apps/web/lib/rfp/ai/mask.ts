/**
 * 개인정보 마스킹 (설계서 3.13.1)
 *
 * ## 왜 되돌릴 수 있어야 하나
 *
 * 지우기만 하면 리포트에 「담당자 연락처: [삭제됨]」 이라고 적힌다.
 * 사용자는 그 정보를 **화면에서는 봐야 하고**, 외부 모델에는 **보내지 않아야** 한다.
 * 그래서 보낼 때 자리표로 바꾸고, 받은 답에서 자리표를 원래 값으로 되돌린다.
 *
 * ## 자리표 모양을 이렇게 잡은 이유
 *
 * 모델이 자리표를 **바꿔 쓰지 않아야** 한다. 자연어처럼 생기면 번역하거나 요약하면서
 * 슬쩍 고친다. `⟦PII_3⟧` 처럼 흔치 않은 괄호를 쓰면 그대로 되돌아온다.
 */

export type PiiKind = 'rrn' | 'phone' | 'email' | 'account' | 'bizno' | 'card'

export interface PiiHit {
  kind: PiiKind
  /** 원문 값. 이 표는 **절대 외부로 나가지 않는다** */
  value: string
  token: string
}

export interface MaskResult {
  text: string
  hits: PiiHit[]
}

interface Rule {
  kind: PiiKind
  re: RegExp
}

/**
 * 위에서부터 먼저 맞는 것이 이긴다.
 *
 * 주민번호를 전화번호보다 먼저 두는 이유: `901231-1234567` 의 앞자리가
 * 전화번호 규칙에 걸릴 수 있다. 넓은 규칙이 먼저면 좁은 것을 삼킨다.
 */
const RULES: readonly Rule[] = [
  { kind: 'rrn', re: /\b\d{6}\s?-\s?[1-4]\d{6}\b/g },
  { kind: 'card', re: /\b\d{4}-\d{4}-\d{4}-\d{4}\b/g },
  { kind: 'bizno', re: /\b\d{3}-\d{2}-\d{5}\b/g },
  { kind: 'email', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { kind: 'phone', re: /\b0\d{1,2}\s?-\s?\d{3,4}\s?-\s?\d{4}\b/g },
  { kind: 'account', re: /\b\d{2,3}-\d{2,6}-\d{2,6}\b/g },
]

/** 자리표 — 모델이 고치지 않을 만큼 흔치 않은 모양 */
export function tokenFor(index: number): string {
  return `⟦PII_${index}⟧`
}

const TOKEN_RE = /⟦PII_(\d+)⟧/g

/**
 * 보낼 글에서 개인정보를 자리표로 바꾼다.
 *
 * 같은 값이 여러 번 나오면 **같은 자리표**를 쓴다 — 다른 자리표를 주면
 * 모델이 「두 사람」으로 읽는다.
 */
export function maskPii(text: string): MaskResult {
  const hits: PiiHit[] = []
  const byValue = new Map<string, string>()
  let masked = text

  for (const rule of RULES) {
    masked = masked.replace(new RegExp(rule.re.source, 'g'), (m) => {
      const seen = byValue.get(m)
      if (seen) return seen
      const token = tokenFor(hits.length + 1)
      byValue.set(m, token)
      hits.push({ kind: rule.kind, value: m, token })
      return token
    })
  }

  return { text: masked, hits }
}

/**
 * 받은 답에서 자리표를 원래 값으로 되돌린다.
 *
 * 모르는 자리표는 **그대로 둔다** — 지우면 모델이 지어낸 자리표가 조용히 사라져
 * 「원문에 없던 말」이 자연스러운 문장으로 남는다.
 */
export function unmaskPii(text: string, hits: readonly PiiHit[]): string {
  if (hits.length === 0) return text
  const byToken = new Map(hits.map((h) => [h.token, h.value]))
  return text.replace(TOKEN_RE, (m) => byToken.get(m) ?? m)
}

/** 왕복이 원문을 잃지 않는지 — 저장 전에 확인한다 */
export function roundTrips(text: string): boolean {
  const m = maskPii(text)
  return unmaskPii(m.text, m.hits) === text
}

/** 남은 개인정보가 있나 — 마스킹 뒤에 부른다. 있으면 보내지 않는다 */
export function hasUnmaskedPii(text: string): boolean {
  return RULES.some((r) => new RegExp(r.re.source).test(text))
}

/** 종류별 건수 — 감사 로그에 남긴다. 값 자체는 남기지 않는다 */
export function countByKind(hits: readonly PiiHit[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const h of hits) out[h.kind] = (out[h.kind] ?? 0) + 1
  return out
}
