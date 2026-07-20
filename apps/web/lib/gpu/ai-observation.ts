// AI 구조화 관측 추출 — Gemini에게 "인식"만 시키고 "산술"은 절대 시키지 않는다.
//   역할 재배치(2026-07-20 확정): AI=인식(통화기호·주기표기·모델 별칭의 무한 경우의 수 처리),
//   코드=산술+검증(observation-contract.ts). 프롬프트는 나눗셈·환산을 금지하고 원문 그대로 보고를 요구한다.
//   카탈로그 컨텍스트를 주입해 "확신 없으면 null+match_basis:'none'"을 허용 — 억지로 고르게 하지 않는 게 핵심
//   (과거 "HGX B300 → H100 둔갑" 사고는 AI가 틀려서가 아니라 억지로 고르게 강요해서 났다).

import { validateAiObservation, type AiObservation, type ObservationRejectReason } from './observation-contract.ts'

// extract-helpers.ts는 @/lib/supabase/server 등 런타임 전용(@/ alias) 모듈을 연쇄 import하므로
// (Next.js 번들러 밖의) 순수 node:test 실행기에서는 그 체인을 해석할 수 없다(경로 alias 미등록).
// 이 파일을 단위테스트 가능하게 유지하기 위해 callGeminiOnce는 지연 로드 + 주입 가능하게 둔다.
// 운영 경로(geminiCaller 미주입)는 항상 extract-helpers.callGeminiOnce를 그대로 재사용한다 — 로직 복제 없음.
export type GeminiCaller = (apiKey: string, model: string, text: string, jsonMode?: boolean) => Promise<string>

async function defaultGeminiCaller(apiKey: string, model: string, text: string, jsonMode: boolean): Promise<string> {
  const { callGeminiOnce } = await import('./extract-helpers.ts')
  return callGeminiOnce(apiKey, model, text, jsonMode)
}

export interface ObservationRejection {
  reason: ObservationRejectReason
  detail: string
}

export interface ExtractAiObservationsResult {
  valid: AiObservation[]
  rejected: ObservationRejection[]
}

/**
 * 구조화 관측 추출 프롬프트 생성.
 * specContext = extract-helpers.loadSpecContext() 결과(모델+VRAM+아키텍처 카탈로그 텍스트) 그대로 주입.
 */
export function buildObservationPrompt(sourceText: string, specContext: string): string {
  return `당신은 GPU 클라우드 경쟁사 요금표에서 "구조화 관측(observation)"만 뽑는 인식 전문가입니다.
절대 산술을 하지 마세요 — 나누지 말고, 환산하지 말고, 원문에 적힌 금액과 단위를 그대로 보고하세요.
예: "1,000円/100GB" 같은 표기를 보면 amount=1000, per_qty=100으로 분리해서 보고하세요(1000÷100을 계산해서 10을 보고하지 마세요).
"月額"(월정액) 표기는 반드시 unit="month"로 보고하세요 — 주기를 빠뜨리지 마세요.
provenance에는 **모델명이 보이는 원문 조각을 반드시 포함**하세요(금액만 넣지 마세요). 모델 판정의 근거이며, 근거 없는 모델명은 검증에서 거부됩니다.
통화 기호는 전각(￥￦＄)·반각(¥₩$) 구분 없이 인식하세요.
수량 접두("1x", "2×", "8장", "8枚")는 gpu_count로 분리하고 amount에서 제거하세요.

${specContext}
위 [보유 모델 카탈로그] 중 해당하는 모델이 있으면 catalog_match에 그 model_name을 그대로 넣고 match_basis를 "exact"(모델명 정확 일치) 또는 "spec"(VRAM·아키텍처 대조로 매핑, 예: AWS p4d 같은 업체 자체 인스턴스명)으로 표기하세요.
**확실하지 않으면 반드시 catalog_match=null, match_basis="none"으로 보고하세요. 비슷하다는 이유로 다른 모델을 고르지 마세요.** 억지 매칭보다 미상 보류가 낫습니다.

각 관측은 다음 JSON 스키마를 따르세요:
{
  "competitor_name": string,   // 회사명(원문 근거)
  "model": string,             // 순수 모델명(폼팩터·메모리·수량 제외, 예 "A100","GB200")
  "form_factor": "SXM"|"PCIe"|"NVL"|null,  // 세대숫자(SXM4/5/6) 제거한 계열
  "memory_gb": number|null,
  "gpu_count": number,         // 이 금액이 포함하는 GPU 장수(미상이면 1)
  "amount": number,            // 원본 금액(환산·나눗셈 금지)
  "currency": string,          // ISO4217 ('JPY','USD','KRW' 등)
  "unit": "minute"|"hour"|"day"|"week"|"month"|"year"|"per_gb"|"per_account",
  "per_qty": number,           // 단위 분모. "1,000円/100GB"면 100. 기본 1.
  "component_kind": "flat"|"base_fee"|"usage"|"storage",
  "catalog_match": string|null,
  "match_basis": "exact"|"spec"|"none",
  "provenance": string         // 원문 근거 문자열(필수, 어느 행/문장에서 왔는지)
}

[원문]
${sourceText}

JSON만 출력하세요(설명·코드펜스 없이): {"observations":[...]}`
}

interface RawGeminiObservationPayload {
  observations?: unknown[]
}

/**
 * Gemini로 구조화 관측 추출 → 검증 → {valid, rejected} 반환.
 * 파싱 실패·API 실패는 throw하지 않고 빈 결과 + 거부 사유로 반환(호출부가 폴백 가능하도록).
 */
export async function extractAiObservations(params: {
  apiKey: string
  model: string
  sourceText: string
  specContext: string
  /** 테스트 주입용. 미주입 시 extract-helpers.callGeminiOnce(운영 경로) 사용. */
  geminiCaller?: GeminiCaller
  /** 실제 카탈로그 model_name 집합. 주면 catalog_match가 이 집합에 없을 때 none으로 강등(환각 매칭 차단). */
  catalogNames?: string[]
}): Promise<ExtractAiObservationsResult> {
  const { apiKey, model, sourceText, specContext, geminiCaller, catalogNames } = params
  const prompt = buildObservationPrompt(sourceText, specContext)
  const call = geminiCaller ?? defaultGeminiCaller

  let raw: string
  try {
    raw = await call(apiKey, model, prompt, true)
  } catch (e: unknown) {
    const detail = e instanceof Error ? e.message : String(e)
    return { valid: [], rejected: [{ reason: 'invalid_type', detail: `gemini call failed: ${detail}` }] }
  }

  let parsed: RawGeminiObservationPayload
  try {
    parsed = JSON.parse(raw) as RawGeminiObservationPayload
  } catch {
    return { valid: [], rejected: [{ reason: 'invalid_type', detail: 'gemini response is not valid JSON' }] }
  }

  const items = Array.isArray(parsed.observations) ? parsed.observations : []
  const valid: AiObservation[] = []
  const rejected: ObservationRejection[] = []
  // 카탈로그 실재 검증 — AI가 카탈로그에 없는 이름을 catalog_match로 적는 환각을 차단.
  //   (실측: 카탈로그에 GB200이 없는데 catalog_match="GB200"(exact)로 보고)
  //   거부가 아니라 **미등록으로 강등**한다 — 관측 자체는 살리고 매칭만 보류(신규 모델 후보로 사람이 판단).
  const catalogSet = new Set((catalogNames ?? []).map((n) => n.toLowerCase().replace(/[\s\-_]+/g, '')))
  for (const item of items) {
    const result = validateAiObservation(item)
    if (!result.ok) { rejected.push({ reason: result.reason, detail: result.detail }); continue }
    let obs = result.value
    // 접두 혼동 강등 — model과 catalog_match의 접두가 다르면 별개 제품(GB200≠B200, GB300≠B300).
    //   실측: AI가 model="GB200"으로 정확히 인식하고도 catalog_match="B200"을 골랐다(카탈로그에 GB200 부재).
    //   거부가 아니라 **미등록 강등** — 관측(가격)은 살리고 매칭만 보류해 신규 모델 후보로 사람이 판단.
    if (obs.catalog_match !== null) {
      const mk = obs.model.toLowerCase().replace(/[\s\-_]+/g, '')
      const ck = obs.catalog_match.toLowerCase().replace(/[\s\-_]+/g, '')
      if (mk !== ck && (mk.endsWith(ck) || ck.endsWith(mk))) {
        rejected.push({ reason: 'prefix_confusion', detail: `"${obs.model}" → 카탈로그 "${obs.catalog_match}" 접두 불일치 — 별개 제품 가능. 미등록(신규 후보)으로 강등` })
        obs = { ...obs, catalog_match: null, match_basis: 'none' }
      }
    }
    if (catalogSet.size > 0 && obs.catalog_match !== null) {
      const key = obs.catalog_match.toLowerCase().replace(/[\s\-_]+/g, '')
      if (!catalogSet.has(key)) {
        rejected.push({ reason: 'catalog_match_mismatch', detail: `카탈로그에 없는 매칭 "${obs.catalog_match}" — 미등록(신규 후보)으로 강등` })
        obs = { ...obs, catalog_match: null, match_basis: 'none' }
      }
    }
    valid.push(obs)
  }
  return { valid, rejected }
}
