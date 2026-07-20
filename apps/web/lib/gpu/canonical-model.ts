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
const VENDOR_BOARD = /\b(nvidia|hgx|dgx)\b/gi        // "NVIDIA HGX B200" → "B200" (HGX=보드패밀리, DGX=서버섀시라인, 벤더수식) — 카탈로그에 DGX/HGX 모델 없어 오제거 0
// 일본어/외국어 요금제 접미(플랜/시간제/월액/베타판)는 모델명이 아니라 상품명 수식 → 매칭 키에서 제거.
//  "H100プラン"→"H100", "A100 時間貸しプラン"→"A100". 트레일링 non-ASCII 정리(33행)가 대부분 처리하나, 중간 등장 방어.
const PLAN_SUFFIX = /プラン|時間貸し|時間貸|月額|β版|ベータ版|\bplan\b/gi
// GPU 클라우드 공급사/플랫폼명이 모델명 앞에 붙는 오염("Nebius H100 SXM 80GB") 방어 — leading만 제거.
//  이 토큰들은 NVIDIA 모델명에 절대 등장하지 않아 오제거 0. 입구 정규화(stripSupplierPrefix)가 1차, 이건 매칭 방어선.
const PROVIDER_PREFIX = /^\s*(nebius|lambda(?:\s+labs)?|runpod|coreweave|paperspace|vast(?:\.?\s*ai)?|datacrunch|fluidstack|hyperstack|crusoe|jarvislabs|scaleway|ovh(?:cloud)?|genesis\s+cloud|gcube|nscale)\s+/gi
// 메모리 용량 토큰(80GB·192 GB·1.5TB)은 모델 식별 키가 아닌 '변형 축'(resolveProductId의 memory 파라미터로 별도 구분).
//  모델명에 섞여 들어온 메모리는 매칭 키에서 제거 → "H100 SXM 80GB"가 카탈로그 "H100 SXM"과 매칭. (폼팩터는 보존)
const MEMORY_TOKEN = /\b\d+(?:\.\d+)?\s*(gb|tb)\b/gi
// 수량 접두("1x H100 SXM5 80GB"·"2× A100") — 장수는 gpu_count 축이지 모델명이 아니다.
//  실사고: verda.com 요금표가 "1x GB300 SXM6 288GB" 형태라 모델명에 "1x"가 그대로 남아 카탈로그 매칭 실패.
//  뒤에 영문자가 오는 경우만 제거해 "4090" 같은 숫자 모델명 오손상 0.
const QTY_PREFIX = /^\s*\d{1,2}\s*[x×]\s*(?=[a-z])/gi

/** 잡음 토큰 제거 후 읽기 좋은 모델명 — 폼팩터(SXM/PCIe/NVL)·세대는 보존, 공급사·벤더·메모리는 제거. */
function stripModelNoise(s: string): string {
  return s
    .replace(QTY_PREFIX, '')
    .replace(PROVIDER_PREFIX, '')
    .replace(CPU_HOST, '')
    .replace(VENDOR_BOARD, '')
    .replace(PLAN_SUFFIX, '')
    .replace(MEMORY_TOKEN, '')
    .replace(/\s+/g, ' ')
    .trim()
    // 토큰 제거 후 가장자리에 남는 문장부호(공백 포함) 정리 — "H200 141GB."→"H200 ."→"H200".
    //  normModelKey는 [\s\-_]만 제거해 trailing '.'·','·')'이 키를 오염시킴(매칭·dedup 실패). 폼팩터(SXM/PCIe/NVL)는 알파넘이라 보존.
    //  ASCII 클래스 사용(\p{}+u 플래그는 tsc target 미명시(ES3) 환경서 TS1501 — 모델명은 ASCII라 동일 결과).
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '')
}

/** 모델명 앞 공급사명 제거(intake 오염 차단). supplier가 leading 토큰일 때만 제거 — 결정론·안전(오제거 방지).
 *  업체명은 별도 필드로 보존되므로 모델명에서 떼는 게 SSOT. 예: ('Nebius H100 SXM 80GB','Nebius')→'H100 SXM 80GB'. */
export function stripSupplierPrefix(modelName: string | null | undefined, supplier: string | null | undefined): string {
  const m = (modelName ?? '').trim()
  const s = (supplier ?? '').trim()
  if (!m || !s) return m
  const esc = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const stripped = m.replace(new RegExp(`^\\s*${esc}\\s+`, 'i'), '').trim()
  return stripped || m // 공급사명만 있던 비정상 입력은 원본 유지
}

/** intake 정규화 SSOT — extracted.model_name에서 공급사명 prefix 제거(in-place). 모든 입구(batch·stream commit·recheck)가 호출.
 *  supplier > competitor_name 순으로 leading 일치 시 제거. 재발방지: 단일 경로만 고치면 다른 입구로 재유입되므로 공용화. */
export function normalizeExtractedModel(ex: Record<string, unknown> | null | undefined): void {
  if (!ex || typeof ex.model_name !== 'string') return
  const sup = (typeof ex.supplier === 'string' && ex.supplier)
    || (typeof ex.competitor_name === 'string' && ex.competitor_name) || ''
  const cleaned = stripSupplierPrefix(ex.model_name, sup)
  if (cleaned !== ex.model_name) ex.model_name = cleaned
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
