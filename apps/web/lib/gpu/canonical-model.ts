// 모델명 캐노니컬 SSOT — "모델은 유니크, 세부데이터(memory·gpu_count)로만 구분".
// 결정론 정규화 + 보수적 alias(확실한 동의어만). 다른 시리즈/세대/숫자는 절대 미병합(오병합 0).
// AI 의존 없음(완전 자동·무화면). 확정·추출·정리 경로가 동일하게 import해 사용(복붙 금지).

/** 비교용 정규화 키 — 소문자 + 공백/하이픈/언더바 제거. "RTX PRO 6000"="rtx pro 6000"="rtxpro6000" */
export function normModelKey(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/[\s\-_]+/g, '')
}

// 소스명 잡음 토큰 제거 — 벤더/보드패밀리/호스트CPU 수식. 카탈로그 단축명엔 이 토큰들이 없어 오병합 0(실측 검증).
//  ⚠️ 폼팩터(SXM·PCIe·NVL)는 카탈로그가 구분하는 별개 모델이라 절대 제거하지 않는다(H100 SXM≠H100 PCIe).
const CPU_HOST = /\s+with\s+(amd|intel)\s+cpu\b/gi   // "L40S with AMD CPU" → "L40S"
const VENDOR_BOARD = /\b(nvidia|hgx)\b/gi            // "NVIDIA HGX B200" → "B200" (HGX=보드패밀리, 벤더수식)

/** 잡음 토큰 제거 후 읽기 좋은 모델명 — 폼팩터(SXM/PCIe/NVL)·세대·메모리는 보존. */
function stripModelNoise(s: string): string {
  return s.replace(CPU_HOST, '').replace(VENDOR_BOARD, '').replace(/\s+/g, ' ').trim()
}

/** 핵심 모델 매칭 키 — 잡음 제거 후 정규화. "NVIDIA HGX B200"="B200"="b200". 폼팩터는 유지. */
export function coreModelKey(s: string | null | undefined): string {
  return normModelKey(stripModelNoise(s ?? ''))
}

// 보수적 alias 사전 — 같은 물리 GPU의 다른 표기만(확실한 것만). 키는 normModelKey 기준.
// ⚠️ 다른 시리즈/세대/숫자(RTX 6000 Ada / RTX Pro 6000 / Quadro RTX 6000 / 4000 vs 5000)는 절대 넣지 않는다.
const ALIAS_TO_CANONICAL: Record<string, string> = {
  // Ampere RTX A6000 — "A6000"과 "RTX A6000"은 동일 GPU. ("RTX 6000 Ada"는 Ada라서 별개 → 미포함)
  a6000: 'RTX A6000',
  rtxa6000: 'RTX A6000',
  // Volta V100 — "V100"과 "Tesla V100"은 동일 GPU(데이터 보유 쪽 'V100'으로 통일).
  teslav100: 'V100',
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
 * 1) 잡음(벤더/HGX/with CPU) 제거 → 읽기 좋은 단축명 + coreModelKey. ("NVIDIA HGX B200"→"B200")
 * 2) alias 사전 직격(core 키 기준) → 캐노니컬 확정.
 * 3) 그 외 → 잡음제거명 그대로. 빈 입력만 confident:false.
 * key가 coreModelKey라 verbose 소스명("NVIDIA HGX B200")이 기존 단축 카탈로그명("B200")과 매칭됨 → 변형명 중복 차단.
 */
export function canonicalizeModel(raw: string | null | undefined): CanonicalResult {
  const cleaned = (raw ?? '')
    .replace(CONTROL_CHARS, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, MAX_MODEL_LEN)
  if (!cleaned) return { canonical: '', confident: false, key: '' }
  const stripped = stripModelNoise(cleaned)
  const name = stripped || cleaned   // 잡음만 있던 비정상 입력은 원본 유지
  const key = normModelKey(name)
  // Object.hasOwn — 프로토타입 폴루션 방어(DC-SEC L2)
  if (Object.hasOwn(ALIAS_TO_CANONICAL, key)) {
    const alias = ALIAS_TO_CANONICAL[key]
    return { canonical: alias, confident: true, key: normModelKey(alias) }
  }
  return { canonical: name, confident: true, key }
}

/** 두 모델명이 같은 모델인지(캐노니컬 키 일치). 세부데이터 비교는 호출부에서 별도. */
export function sameModel(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = canonicalizeModel(a).key
  const kb = canonicalizeModel(b).key
  return ka.length > 0 && ka === kb
}
