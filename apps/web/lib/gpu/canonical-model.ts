// 모델명 캐노니컬 SSOT — "모델은 유니크, 세부데이터(memory·gpu_count)로만 구분".
// 결정론 정규화 + 보수적 alias(확실한 동의어만). 다른 시리즈/세대/숫자는 절대 미병합(오병합 0).
// AI 의존 없음(완전 자동·무화면). 확정·추출·정리 경로가 동일하게 import해 사용(복붙 금지).

/** 비교용 정규화 키 — 소문자 + 공백/하이픈/언더바 제거. "RTX PRO 6000"="rtx pro 6000"="rtxpro6000" */
export function normModelKey(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/[\s\-_]+/g, '')
}

// 보수적 alias 사전 — 같은 물리 GPU의 다른 표기만(확실한 것만). 키는 normModelKey 기준.
// ⚠️ 다른 시리즈/세대/숫자(RTX 6000 Ada / RTX Pro 6000 / Quadro RTX 6000 / 4000 vs 5000)는 절대 넣지 않는다.
const ALIAS_TO_CANONICAL: Record<string, string> = {
  // Ampere RTX A6000 — "A6000"과 "RTX A6000"은 동일 GPU. ("RTX 6000 Ada"는 Ada라서 별개 → 미포함)
  a6000: 'RTX A6000',
  rtxa6000: 'RTX A6000',
}

const MAX_MODEL_LEN = 100
// 제어문자(C0/C1 + DEL) 제거 — 비정상 입력으로 카탈로그 오염 방지(DC-SEC M1). ASCII-only 소스로 안전 구성.
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001F\\u007F-\\u009F]', 'g')

export interface CanonicalResult {
  /** 저장/표시용 캐노니컬 모델명 */
  canonical: string
  /** 자동 채택해도 안전한지. false면 호출부는 원본 유지(오병합 방지) */
  confident: boolean
  /** 비교/매칭용 정규화 키 */
  key: string
}

/**
 * 원본 모델명 → 캐노니컬.
 * 1) alias 사전 직격 → 캐노니컬 확정(confident).
 * 2) 그 외 → 입력을 공백정리만 해 그대로 반환(케이스/공백 변형은 key가 흡수). confident.
 * 빈 입력만 confident:false.
 */
export function canonicalizeModel(raw: string | null | undefined): CanonicalResult {
  const cleaned = (raw ?? '')
    .replace(CONTROL_CHARS, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, MAX_MODEL_LEN)
  if (!cleaned) return { canonical: '', confident: false, key: '' }
  const key = normModelKey(cleaned)
  // Object.hasOwn — 프로토타입 폴루션 방어(DC-SEC L2)
  if (Object.hasOwn(ALIAS_TO_CANONICAL, key)) {
    const alias = ALIAS_TO_CANONICAL[key]
    return { canonical: alias, confident: true, key: normModelKey(alias) }
  }
  return { canonical: cleaned, confident: true, key }
}

/** 두 모델명이 같은 모델인지(캐노니컬 키 일치). 세부데이터 비교는 호출부에서 별도. */
export function sameModel(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = canonicalizeModel(a).key
  const kb = canonicalizeModel(b).key
  return ka.length > 0 && ka === kb
}
