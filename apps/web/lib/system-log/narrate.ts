// lib/system-log/narrate.ts — 사건 하나를 **관리자가 읽는 두 줄**로 (순수 함수 SSOT)
//
// ## 이 파일을 지배하는 판단 하나
//
// **시스템 로그 화면이 AI 에 의존하면, AI 가 죽었을 때 그 사실을 볼 수 없다.**
//
// 이 화면이 필요해진 이유가 정확히 "AI 한도가 없으면 그런 걸 체크"다.
// 그 화면의 문장을 AI 가 만들면 한도가 소진된 바로 그 순간 화면이 통째로 빈다 —
// 관측 도구가 관측 대상과 함께 죽는다. 그래서 **사실 문장에는 AI 를 쓰지 않는다.**
//
// ## 조립 규칙 여섯
//
// ① 기능 이름은 **사용자가 부르는 말**로(`enrich-web` ✗ → 회사 정보 AI 보강 ○)
// ② 첫 줄은 "무엇이 안 됐나", 둘째 줄은 "왜" — 관리자는 첫 줄만 읽고 넘길 수 있어야 한다
// ③ 원문은 감추지 않고 **접는다** — 요약이 틀렸을 때 다음 사람이 확인할 유일한 단서다
// ④ **숫자를 지어내지 않는다** — 영향 인원을 모르면 "모름"이라고 쓴다
// ⑤ 같은 지문 500건은 500줄이 아니라 **1줄 + "500번"**
// ⑥ 영향받은 사람을 말한다 — 관리자가 "이거 심각한가"를 판단하는 유일한 근거다

import { featureLabel, sourceLabel, reasonLabel } from './labels.ts'
import type { SystemReason } from './reason.ts'

export interface NarrateInput {
  source: string
  reason: SystemReason
  feature?: string | null
  route?: string | null
  /** 원문에서 뽑은 짧은 단서(표 이름·모델 이름 등). 없으면 안 쓴다 */
  hint?: string | null
}

/** 첫 줄 — **무엇이 안 됐나.** 원인은 여기 안 쓴다(둘째 줄이 맡는다) */
export function headlineOf(input: NarrateInput): string {
  const what = input.feature ? featureLabel(input.feature) : sourceLabel(input.source)
  return `${what}이(가) 실패했습니다`
}

/**
 * 둘째 줄 — **왜.** 그리고 관리자가 다음에 무엇을 보면 되는지까지 한 문장에 담는다.
 *
 * 사유마다 문장을 따로 쓴다. "오류가 발생했습니다" 같은 말은 아무것도 알려 주지 않는다 —
 * 그 말을 읽고 할 수 있는 일이 없으면 로그를 남긴 뜻이 없다.
 */
export function detailOf(input: NarrateInput): string {
  const hint = (input.hint ?? '').trim()
  const tail = hint ? ` (${hint})` : ''
  switch (input.reason) {
    case 'quota':
      return `AI 사용 한도를 다 썼습니다${tail}. 한도가 풀리기를 기다리거나, 시스템 설정에서 다른 모델로 바꾸면 됩니다.`
    case 'auth':
      return `AI 키나 접근 권한에 문제가 있습니다${tail}. 시스템 설정 → 통합에서 키를 다시 넣어 주세요.`
    case 'config':
      return `필요한 설정이 없습니다${tail}. 배포 환경변수나 시스템 설정에서 값을 채워 주세요.`
    case 'db':
      return `데이터베이스에 닿지 못했거나 필요한 표가 없습니다${tail}. 마이그레이션이 적용됐는지 확인해 주세요.`
    case 'timeout':
      return `정해진 시간 안에 응답이 오지 않았습니다${tail}. 한 번에 처리하는 양을 줄이면 나아질 수 있습니다.`
    case 'network':
      return `외부 서비스에 연결하지 못했습니다${tail}. 잠시 뒤 저절로 풀리는 경우가 많습니다.`
    case 'server':
      return `외부 서비스가 오류를 돌려줬습니다${tail}. 우리 쪽에서 고칠 수 있는 문제가 아닐 수 있습니다.`
    case 'bad_json':
      return `AI 응답이 우리가 기대한 형식이 아니었습니다${tail}. 같은 일이 반복되면 모델을 바꿔 보세요.`
    default:
      return `원인을 자동으로 알아내지 못했습니다${tail}. 아래 원문을 펼쳐 확인해 주세요.`
  }
}

/**
 * 얼마나·언제·누가 — **묶인 한 줄의 꼬리표.**
 *
 * 숫자를 지어내지 않는다: 영향 인원을 모르면 그 부분을 아예 안 쓴다.
 * "0명"이라고 쓰면 "아무도 안 겪었다"는 **틀린 사실**이 되기 때문이다.
 */
export function occurrenceLine(input: {
  count: number
  firstAt: string
  lastAt: string
  actorCount?: number | null
  actorSample?: string | null
  route?: string | null
  formatTime: (iso: string) => string
}): string {
  const parts: string[] = []

  if (input.actorSample) {
    const others = (input.actorCount ?? 1) - 1
    parts.push(others > 0 ? `${input.actorSample} 외 ${others}명` : input.actorSample)
  }

  // 한 번이면 "언제", 여러 번이면 "언제부터 몇 번" — 사람이 세는 방식과 같게
  parts.push(input.count > 1
    ? `${input.formatTime(input.firstAt)}부터 ${input.count.toLocaleString()}번`
    : input.formatTime(input.lastAt))

  if (input.route) parts.push(input.route)
  return parts.join(' · ')
}

/** 원문은 지우지 않고 자른다 — 길다고 버리면 다음 사람이 확인할 단서가 사라진다 */
export const RAW_MAX = 2000
export function truncateRaw(raw: string): string {
  if (raw.length <= RAW_MAX) return raw
  return `${raw.slice(0, RAW_MAX)}\n… (${(raw.length - RAW_MAX).toLocaleString()}자 더 있음)`
}

/**
 * 키·토큰을 지운다 — **로그가 유출 경로가 되면 안 된다.**
 *
 * 실측 근거: 어댑터가 던지는 오류 본문에 `?key=…` 가 그대로 들어 있었다.
 * 그걸 그대로 저장하면 어드민 화면과 DB 백업에 키가 남는다.
 */
const SECRET_PATTERNS: [RegExp, string][] = [
  [/([?&]key=)[A-Za-z0-9_\-]{8,}/gi, '$1***'],
  [/\b(AIza[A-Za-z0-9_\-]{10,})\b/g, '***'],
  [/\b(sk-[A-Za-z0-9_\-]{10,})\b/g, '***'],
  [/\b(Bearer\s+)[A-Za-z0-9._\-]{10,}/gi, '$1***'],
  [/(postgres(?:ql)?:\/\/[^:]+:)[^@]+(@)/gi, '$1***$2'],
  [/("?(?:api[_-]?key|token|secret|password)"?\s*[:=]\s*"?)[^",\s}]{6,}/gi, '$1***'],
]

export function maskSecrets(text: string): string {
  let out = text
  for (const [re, rep] of SECRET_PATTERNS) out = out.replace(re, rep)
  return out
}

/** 사유 한 마디 — 배지에 쓴다 */
export { reasonLabel }
