// AI 응답에서 JSON을 건져내는 SSOT (순수 함수 — 의존성 없음, node --test 직접 실행 가능).
//
// 왜 생겼나(v0.7.571): 기존 파서는 마크다운 코드펜스만 벗기고 바로 JSON.parse를 했다.
// 모델이 JSON 앞뒤에 한 줄이라도 설명을 붙이면 통째로 실패했고, 사용자에겐
// "회의 요약에 실패했습니다. 다시 시도해 주세요."만 떴다(재시도해도 같은 이유로 또 실패).
// 모델은 지시를 어길 수 있다는 전제로, 응답 안에 유효한 JSON이 **있기만 하면** 살려낸다.
//
// 무손실 원칙: 건져낸 것이 유효한 JSON일 때만 성공으로 친다. 억지로 고쳐 쓰지 않는다
// (따옴표 자동 수선 같은 추측 복구는 하지 않는다 — 틀린 데이터를 맞는 척 넘기는 게 더 나쁘다).

export class JsonRecoverError extends Error {
  /** 실패 원인 진단에 쓸 응답 앞부분(로그용 — 길면 잘린다). */
  readonly sample: string
  constructor(sample: string) {
    super('AI 응답에서 JSON을 찾지 못했습니다')
    this.name = 'JsonRecoverError'
    this.sample = sample
  }
}

/** 마크다운 코드펜스(```json … ```)를 벗긴다. 펜스가 없으면 그대로 돌려준다. */
function stripFence(text: string): string {
  return text
    .replace(/^\s*```(?:json|javascript|js)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()
}

/**
 * `start` 위치의 여는 괄호에 대응하는 닫는 괄호의 index를 찾는다(문자열 리터럴·이스케이프 인식).
 * 대응이 없으면 -1.
 */
function findBalancedEnd(text: string, start: number): number {
  const open = text[start]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/**
 * 텍스트 어딘가에 섞여 있는 JSON 객체/배열을 건져 파싱한다.
 * 실패하면 JsonRecoverError를 던진다(호출처가 원인을 사용자에게 전할 수 있도록 sample을 담는다).
 */
export function recoverJson(text: string): unknown {
  const raw = (text ?? '').trim()
  if (!raw) throw new JsonRecoverError('')

  // 1) 흔한 경우 — 펜스만 벗기면 바로 유효한 JSON
  const stripped = stripFence(raw)
  try {
    return JSON.parse(stripped)
  } catch {
    /* 아래에서 건져낸다 */
  }

  // 2) 산문에 섞인 경우 — 여는 괄호마다 balanced 스캔. 먼저 성공하는 것을 쓴다.
  //    (모델이 사고과정을 쓴 뒤 마지막에 JSON을 붙이는 패턴을 포함해 전부 훑는다)
  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i]
    if (ch !== '{' && ch !== '[') continue
    const end = findBalancedEnd(stripped, i)
    if (end === -1) continue
    const candidate = stripped.slice(i, end + 1)
    try {
      return JSON.parse(candidate)
    } catch {
      /* 다음 후보 */
    }
  }

  throw new JsonRecoverError(raw.slice(0, 200))
}

/** 파싱 결과를 객체로 좁힌다(배열·원시값이면 빈 객체). */
export function asJsonRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
