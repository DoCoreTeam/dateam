/**
 * 회사 도메인 추정 — 인물 이메일에서 (순수)
 *
 * **왜 규칙인가**(사용자 지적): *"고객구분은 이미 있는데? … 다만 데이터가 없는데
 * 이건 AI가 좀 채워줘야 하는거아냐? 왜 AI 기능이 이렇게 부실하지?"*
 *
 * 부실했던 이유는 AI 가 약해서가 아니라 **AI 를 안 불러도 되는 것까지 AI 에 맡겨서**다.
 * 회사 보강 37건이 전부 할당량 초과로 죽었는데(마지막 2026-08-24), 그중 상당수는
 * 이 회사에 붙은 사람의 이메일이 `@sookmyung.ac.kr` 이면 도메인이 그것이라는,
 * **모델이 필요 없는 사실**이었다. 도메인이 잡히면 기관 종류는 `company-kind.ts` 가
 * 공짜로 판정한다 — 리포트의 「기관 종류」 축이 그렇게 살아난다.
 *
 * 순수하다 — DB 를 모른다.
 */

/**
 * 회사 도메인이 **아닌** 것.
 *
 * 이건 «우리가 정하는 구분»이 아니라 «누구나 가입할 수 있는 메일 서비스»라는 사실이라
 * 코드에 있어도 P-1 위반이 아니다. 회사 구분(B2B·공공 같은 것)은 여기 없다.
 */
export const PUBLIC_MAIL_HOSTS: readonly string[] = [
  'gmail.com', 'googlemail.com', 'naver.com', 'daum.net', 'hanmail.net',
  'kakao.com', 'nate.com', 'hotmail.com', 'outlook.com', 'live.com',
  'yahoo.com', 'yahoo.co.jp', 'icloud.com', 'me.com', 'proton.me',
  'protonmail.com', 'qq.com', '163.com', '126.com', 'hanmir.com',
  'korea.com', 'empas.com', 'dreamwiz.com', 'paran.com', 'tutanota.com',
  'zoho.com', 'aol.com', 'gmx.com', 'yandex.com', 'mail.com',
]

const PUBLIC_SET = new Set(PUBLIC_MAIL_HOSTS)

export function isPublicMailHost(host: string): boolean {
  return PUBLIC_SET.has(host.trim().toLowerCase())
}

/** 이메일에서 호스트만 — 못 읽으면 null. 지어내지 않는다 */
export function hostOfEmail(email: string | null | undefined): string | null {
  const at = (email ?? '').trim().toLowerCase()
  const i = at.lastIndexOf('@')
  if (i <= 0 || i === at.length - 1) return null
  const host = at.slice(i + 1).replace(/[>,;\s]+$/, '')
  if (!host.includes('.') || host.startsWith('.') || host.endsWith('.')) return null
  return host
}

export interface DomainGuess {
  domain: string
  /** 이 도메인을 쓴 사람 수 */
  from: number
  /** 회사 도메인으로 그대로 써도 되나. 아니면 사람이 봐야 한다 */
  confident: boolean
}

/**
 * 사람들의 이메일에서 회사 도메인을 고른다.
 *
 * 규칙은 셋이다:
 *   ① 공개 메일 서비스는 뺀다 — `@gmail.com` 은 그 사람의 메일이지 회사의 것이 아니다
 *   ② 남은 것 중 **가장 많이 쓴 호스트**가 후보다
 *   ③ 후보가 **혼자 과반**이어야 확신한다. 반반이면 사람이 봐야 한다
 *      (자회사·협력사 메일이 섞이면 엉뚱한 도메인이 박힌다)
 */
export function guessCompanyDomain(emails: readonly (string | null | undefined)[]): DomainGuess | null {
  const counts = new Map<string, number>()
  let usable = 0
  for (const e of emails) {
    const h = hostOfEmail(e)
    if (!h || isPublicMailHost(h)) continue
    usable += 1
    counts.set(h, (counts.get(h) ?? 0) + 1)
  }
  if (usable === 0) return null

  let best = ''
  let bestN = 0
  let tie = false
  for (const [h, n] of Array.from(counts)) {
    if (n > bestN) { best = h; bestN = n; tie = false }
    else if (n === bestN) tie = true
  }
  if (!best) return null
  return { domain: best, from: bestN, confident: !tie && bestN * 2 > usable }
}

/** 채울 수 있는 회사를 센다 — 실행 전에 「몇 곳이 되는지」를 먼저 보여주려고 있다 */
export function countFillable(
  companies: readonly { domain: string | null | undefined; emails: readonly (string | null | undefined)[] }[],
): { fillable: number; unsure: number; noSignal: number } {
  let fillable = 0, unsure = 0, noSignal = 0
  for (const c of companies) {
    if (c.domain) continue
    const g = guessCompanyDomain(c.emails)
    if (!g) noSignal += 1
    else if (g.confident) fillable += 1
    else unsure += 1
  }
  return { fillable, unsure, noSignal }
}
