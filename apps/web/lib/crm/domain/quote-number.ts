/**
 * 견적번호 형식 (SSOT) — 회사마다 다르게 쓴다
 *
 * **왜 설정으로 빼나**: 지금은 `Q-2026-0014` 가 코드에 박혀 있다. 그런데 회사마다
 * 쓰는 형식이 다르고(`DA-2026-0814-01` · `견적-26-001` · `Q2608001`),
 * 이건 **문서에 찍혀 나가는 회사의 얼굴**이라 배포를 기다릴 일이 아니다.
 * (사용자 지시: 「견적번호를 DA-연-월일-번호 형식으로 하고자 한다. 다만 이 번호의 형식을
 *  설정에서 셋팅 할 수 있어야 한다. 설정방식은 사용자가 자유롭게 할 수 있으면 좋을 것 같다」)
 *
 * **왜 «자유 입력 + 토큰»인가**: 드롭다운으로 몇 가지를 고르게 하면 반드시 없는 형식이 나온다.
 * 토큰을 섞어 쓰게 하되 **미리보기로 즉시 확인**시키면 자유도와 안전이 함께 선다.
 *
 * **채번 범위는 형식이 정한다.** `{MMDD}` 가 있으면 하루마다 1번부터, 없으면 그 해 통째로 —
 * 사용자가 따로 고를 것이 아니라 형식에서 **계산되는** 것이다. 그래야 둘이 어긋나지 않는다.
 */

/** 형식에 쓸 수 있는 토큰 — 이 목록이 곧 설정 화면의 안내다 */
export const QUOTE_NO_TOKENS = [
  { token: '{YYYY}', desc: '연도 네 자리', sample: '2026' },
  { token: '{YY}', desc: '연도 두 자리', sample: '26' },
  { token: '{MM}', desc: '월 두 자리', sample: '08' },
  { token: '{DD}', desc: '일 두 자리', sample: '28' },
  { token: '{MMDD}', desc: '월일 네 자리', sample: '0828' },
  { token: '{SEQ}', desc: '일련번호 (기본 네 자리)', sample: '0001' },
  { token: '{SEQ:2}', desc: '일련번호 자릿수 지정', sample: '01' },
] as const

/** 아무것도 설정 안 했을 때 — 사용자가 요청한 `DA-연-월일-번호` */
export const DEFAULT_QUOTE_NO_PATTERN = 'DA-{YYYY}-{MMDD}-{SEQ:2}'

/** 골라 쓰기 좋은 몇 가지. 자유 입력을 막지는 않는다 */
export const QUOTE_NO_PRESETS: readonly { label: string; pattern: string }[] = [
  { label: 'DA-2026-0828-01', pattern: 'DA-{YYYY}-{MMDD}-{SEQ:2}' },
  { label: 'Q-2026-0001', pattern: 'Q-{YYYY}-{SEQ}' },
  { label: '견적-26-001', pattern: '견적-{YY}-{SEQ:3}' },
  { label: 'Q26080001', pattern: 'Q{YY}{MM}{SEQ}' },
]

/**
 * 일련번호가 **어느 단위로 1부터 다시 세나**.
 *
 * 형식에서 계산한다 — 날짜가 잘게 들어갈수록 범위가 좁아진다.
 * 날짜 토큰이 하나도 없으면 「영원히 이어지는 번호」다.
 */
export type SeqScope = 'DAY' | 'MONTH' | 'YEAR' | 'FOREVER'

export function seqScopeOf(pattern: string): SeqScope {
  /*
    **빈 형식은 기본값으로 본다.** `renderQuoteNo` 가 그렇게 하므로 여기도 같아야 한다 —
    안 그러면 설정 화면이 빈 칸에서 「계속 이어서」라고 안내하는데
    실제로 저장되는 번호는 「날마다 1번부터」다(실브라우저에서 잡았다).
  */
  const p = pattern || DEFAULT_QUOTE_NO_PATTERN
  const hasDay = /\{DD\}|\{MMDD\}/.test(p)
  const hasMonth = /\{MM\}|\{MMDD\}/.test(p)
  const hasYear = /\{YYYY\}|\{YY\}/.test(p)
  if (hasDay) return 'DAY'
  if (hasMonth) return 'MONTH'
  if (hasYear) return 'YEAR'
  return 'FOREVER'
}

export const SEQ_SCOPE_LABEL: Record<SeqScope, string> = {
  DAY: '날마다 1번부터',
  MONTH: '달마다 1번부터',
  YEAR: '해마다 1번부터',
  FOREVER: '계속 이어서',
}

interface DateParts { year: number; month: number; day: number }

/** `YYYY-MM-DD` 를 조각으로. 이 파일은 시간을 모른다 — 호출부가 KST 오늘을 넘긴다 */
export function partsOf(dateKey: string): DateParts {
  const [y, m, d] = dateKey.split('-').map(Number)
  return { year: y, month: m, day: d }
}

const pad = (n: number, w: number) => String(n).padStart(w, '0')

/**
 * 형식 + 날짜 + 일련번호 → 견적번호.
 *
 * 모르는 토큰은 **그대로 둔다.** 지워 버리면 사용자가 오타를 냈을 때
 * 번호가 조용히 짧아지고, 그 사실을 문서가 나간 뒤에 안다.
 */
export function renderQuoteNo(pattern: string, dateKey: string, seq: number): string {
  const p = partsOf(dateKey)
  return (pattern || DEFAULT_QUOTE_NO_PATTERN)
    .replace(/\{YYYY\}/g, String(p.year))
    .replace(/\{YY\}/g, pad(p.year % 100, 2))
    .replace(/\{MMDD\}/g, `${pad(p.month, 2)}${pad(p.day, 2)}`)
    .replace(/\{MM\}/g, pad(p.month, 2))
    .replace(/\{DD\}/g, pad(p.day, 2))
    .replace(/\{SEQ:(\d)\}/g, (_, w: string) => pad(seq, Number(w)))
    .replace(/\{SEQ\}/g, pad(seq, 4))
}

/**
 * 같은 범위의 번호를 찾기 위한 **앞자리**.
 *
 * 일련번호 앞까지가 그 범위에서 공통이다 — 그 앞자리로 DB 를 훑어 가장 큰 번호를 찾는다.
 * `{SEQ}` 가 형식 맨 앞에 있으면 공통 앞자리가 없다(그때는 전부 훑는다).
 */
export function seqPrefix(pattern: string, dateKey: string): string {
  const p = pattern || DEFAULT_QUOTE_NO_PATTERN
  const at = p.search(/\{SEQ(:\d)?\}/)
  if (at < 0) return renderQuoteNo(p, dateKey, 0)
  // 일련번호가 맨 앞이면 공통 앞자리가 없다. **빈 조각을 renderQuoteNo 에 넘기지 않는다** —
  // 거기서는 빈 형식이 기본값으로 떨어지므로 앞자리가 `DA-…` 로 둔갑한다(테스트가 잡았다)
  if (at === 0) return ''
  return renderQuoteNo(p.slice(0, at), dateKey, 0)
}

/**
 * 이미 쓴 번호에서 일련번호를 되읽는다.
 *
 * 앞자리를 떼고 **남은 앞쪽 숫자**를 읽는다 — 뒤에 접미사가 붙어 있어도(`-Rev2`) 견딘다.
 */
export function seqOf(quoteNo: string | null | undefined, prefix: string): number {
  if (!quoteNo || !quoteNo.startsWith(prefix)) return 0
  const m = /^(\d+)/.exec(quoteNo.slice(prefix.length))
  return m ? Number(m[1]) : 0
}

/**
 * 형식이 쓸 만한가 — 설정 화면이 저장 전에 묻는다.
 *
 * **일련번호가 없으면 거절한다.** 그러면 모든 견적이 같은 번호를 갖게 되고,
 * 그건 번호가 아니다. 나머지는 자유다.
 */
export function validateQuoteNoPattern(pattern: string): string | null {
  const p = (pattern ?? '').trim()
  if (!p) return '형식을 입력해 주세요.'
  if (p.length > 60) return '형식이 너무 깁니다. 60자 안으로 써 주세요.'
  if (!/\{SEQ(:\d)?\}/.test(p)) {
    return '{SEQ} 가 있어야 합니다. 없으면 모든 견적이 같은 번호가 됩니다.'
  }
  const unknown = (p.match(/\{[^}]*\}/g) ?? [])
    .filter((t) => !/^\{(YYYY|YY|MM|DD|MMDD|SEQ(:\d)?)\}$/.test(t))
  if (unknown.length > 0) return `모르는 표시가 있습니다: ${unknown.join(' · ')}`
  return null
}

/** 설정 화면의 미리보기 — 오늘 날짜로 1번·2번을 보여 준다 */
export function previewQuoteNo(pattern: string, dateKey: string): string[] {
  return [1, 2].map((n) => renderQuoteNo(pattern, dateKey, n))
}
