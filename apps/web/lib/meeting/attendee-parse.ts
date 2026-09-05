/**
 * 참석자 한 줄을 회사·이름·직급으로 쪼갠다 (SSOT)
 *
 * **왜 이 파일이 생겼나**: 회의노트의 참석자 칸은 글자 배열 하나다(`meeting_notes.attendees`).
 * 거기 적힌 것이 실측으로 이렇게 생겼다 —
 *   「컬쳐랜드 김시홍팀장」 · 「제일엔지니어링 곽수영 상무」 · 「진경선 교수」 · 「수원시 주무관 2명」
 * 회사와 이름과 직급이 **한 덩어리**고, 공백이 빠진 것도 있고, 아예 이름이 아닌 것도 섞여 있다.
 * 이걸 인물로 만들려면 먼저 쪼개야 하는데, 쪼개는 규칙이 화면 안에 있으면 검증할 방법이 없다.
 *
 * 그래서 순수 함수로 뺀다 — 완료 조건 E-6 이 요구하는 대로, 실브라우저 밖에서도 검증되게.
 *
 * **애매하면 이름이라고 우기지 않는다.** 「수원시 주무관 2명」을 인물로 만들면
 * CRM 에 그 이름의 사람이 생긴다. 못 쪼갠 것은 못 쪼갰다고 말하고 사람에게 넘긴다.
 */

/** 이름 끝에 붙는 호칭 — `lib/meeting/match-attendees.ts` 와 같은 규칙이어야 한다 */
const HONORIFIC_RE = /(님|씨)$/

/**
 * 직급·직함.
 *
 * 긴 것부터 본다 — 「본부장」을 「부장」으로 자르면 회사 이름에 「본」이 남는다.
 * 목록에 없는 직급은 직급이 아니라 이름의 일부로 남는다(모르면 안 건드린다).
 */
const TITLES = [
  '대표이사', '부사장', '본부장', '부문장', '사업부장', '연구원', '센터장',
  '수석', '책임', '선임', '주임', '주무관', '사무관', '서기관',
  '대표', '사장', '전무', '상무', '이사', '부장', '차장', '과장', '대리', '사원',
  '팀장', '실장', '소장', '원장', '교수', '박사', '강사', '매니저', '컨설턴트',
  'CEO', 'CTO', 'CFO', 'COO', 'PM', 'PL',
] as const

/** 「2명」 「3명」 처럼 사람 수를 적은 것 — 이름이 아니다 */
const HEADCOUNT_RE = /\d+\s*명$/

/** 한국어 사람 이름으로 볼 수 있는 모양 — 한글 2~4자 */
const KOREAN_NAME_RE = /^[가-힣]{2,4}$/
/** 영문 이름 — 「John」 「John Doe」 */
const LATIN_NAME_RE = /^[A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*)?$/

export type AttendeeKind =
  /** 이름을 뽑았다 */
  | 'person'
  /** 「주무관 2명」 처럼 인원수만 적힌 것 */
  | 'count'
  /** 사람 이름으로 보기 어렵다 — 사람이 판단해야 한다 */
  | 'unknown'

export interface ParsedAttendee {
  /** 원문 그대로. 무엇을 쪼갠 것인지 화면이 되짚을 수 있어야 한다 */
  raw: string
  kind: AttendeeKind
  /** 앞에 붙은 소속. 없으면 null */
  company: string | null
  /** 뽑아낸 사람 이름. kind 가 'person' 이 아니면 원문이 그대로 들어온다 */
  name: string
  /** 직급·직함. 없으면 null */
  title: string | null
}

/** 끝에 붙은 직급을 뗀다. 공백이 없어도 뗀다(「김시홍팀장」 실측) */
function splitTitle(s: string): { head: string; title: string | null } {
  for (const t of TITLES) {
    if (s.length <= t.length) continue
    if (!s.toUpperCase().endsWith(t.toUpperCase())) continue

    const head = s.slice(0, s.length - t.length).trim()
    if (!head) continue // 직급만 적힌 것 — 이름이 없으므로 떼지 않는다
    return { head, title: s.slice(s.length - t.length) }
  }
  return { head: s, title: null }
}

/**
 * 이름 모양인가.
 *
 * 직급 그 자체는 걸러낸다 — 「팀장」 「대표」는 한글 2자라 이름 모양과 겹치지만
 * 사람 이름이 아니다. 직급만 적힌 칸을 인물로 만들면 CRM 에 「팀장」이라는 사람이 생긴다.
 */
function looksLikeName(s: string): boolean {
  if (TITLES.some((t) => t.toUpperCase() === s.toUpperCase())) return false
  return KOREAN_NAME_RE.test(s) || LATIN_NAME_RE.test(s)
}

/**
 * 참석자 한 줄을 쪼갠다.
 *
 * 순서가 규칙이다 — ① 인원수 표기부터 걸러내고 ② 직급을 떼고 ③ 남은 것에서
 * **뒤쪽**을 이름으로 본다. 한국어는 「소속 이름 직급」 순서라 뒤에서부터 확실하다.
 */
export function parseAttendee(raw: string): ParsedAttendee {
  const trimmed = raw.trim().replace(/\s+/g, ' ')
  const base: ParsedAttendee = { raw, kind: 'unknown', company: null, name: trimmed, title: null }

  if (!trimmed) return base

  // ① 「주무관 2명」 — 사람 수를 적은 것이라 이름이 없다
  if (HEADCOUNT_RE.test(trimmed)) return { ...base, kind: 'count' }

  // ② 직급 떼기
  const { head, title } = splitTitle(trimmed)

  // ③ 남은 것에서 이름 고르기 — 공백이 있으면 마지막 토막이 이름이다
  const stripped = head.replace(HONORIFIC_RE, '').trim()
  const parts = stripped.split(' ').filter(Boolean)
  const last = parts[parts.length - 1] ?? ''

  if (looksLikeName(last)) {
    const company = parts.slice(0, -1).join(' ')
    return { raw, kind: 'person', company: company || null, name: last, title }
  }

  // 이름으로 못 보겠다 — 직급은 뗀 채로 돌려준다(화면이 고칠 재료는 준다)
  return { ...base, kind: 'unknown', name: stripped || trimmed, title }
}

/** 여러 줄을 한 번에. 빈 줄은 버린다 */
export function parseAttendees(raws: string[]): ParsedAttendee[] {
  return raws.map((r) => parseAttendee(r)).filter((p) => p.raw.trim().length > 0)
}
