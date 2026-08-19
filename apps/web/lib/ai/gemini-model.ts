// Gemini 모델 SSOT — 모델명 하드코딩 금지, 이 파일만 고친다.
//
// 왜 생겼나(v0.7.571): 22개 라우트·서버액션이 `|| 'gemini-2.0-flash'`를 각자 하드코딩하고 있었는데
// 그 모델이 Google에서 삭제돼(HTTP 404) 폴백이 폴백 역할을 못 했다. 게다가 운영 META에는
// `gemma-4-26b-a4b-it`가 설정돼 있었고, Gemma 계열은 `responseMimeType: 'application/json'`을
// **에러 없이 조용히 무시**하고 산문을 돌려준다(실측: HTTP 200 + "*   Input text: ..." 사고과정 텍스트).
// 그래서 res.ok 검사를 통과한 뒤 JSON.parse에서 터졌고, 회의노트 AI가 100% 실패했다.
//
// 모델 가용성은 실시간으로 흔들린다(실측 2026-08-19: gemini-2.5-flash → 404,
// gemini-flash-latest → 503, gemini-3.6-flash → 200 JSON ✅). 그래서 "하나를 잘 고르는 것"으로는
// 안 되고 **체인 + 재시도**가 필요하다 — 실제 호출은 lib/ai/gemini-call.ts가 한다.

/** 설정이 없거나 못 쓸 때 쓰는 기본 모델. 실호출로 JSON 모드 동작을 확인한 모델만 올린다. */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash'

/**
 * 폴백 체인 — 앞에서부터 시도한다. 하나가 404/503이어도 다음이 받는다.
 * 별칭(`gemini-flash-latest`)은 "항상 존재한다"는 장점 때문에 맨 뒤 안전망으로만 둔다
 * (별칭은 성능·비용이 예고 없이 바뀔 수 있어 1차로 쓰지 않는다).
 */
export const GEMINI_MODEL_FALLBACKS: readonly string[] = [
  DEFAULT_GEMINI_MODEL,
  'gemini-3.7-flash',
  'gemini-flash-latest',
]

/**
 * 구조화 출력(JSON 강제)을 지원하지 않는 모델 계열.
 * Gemma는 `responseMimeType`을 무시하므로 JSON을 요구하는 기능에 쓰면 100% 실패한다.
 * 임베딩·TTS·이미지 전용 모델도 generateContent JSON 용도가 아니다.
 */
const NO_JSON_MODE_PATTERNS: readonly RegExp[] = [
  /^gemma/i,
  /embedding/i,
  /-tts(\b|-)/i,
  /-image(\b|-)/i,
  /aqa/i,
]

/** 이 모델에 `responseMimeType: 'application/json'`을 요구해도 되는가. */
export function supportsJsonMode(model: string | null | undefined): boolean {
  const m = (model ?? '').trim()
  if (!m) return false
  return !NO_JSON_MODE_PATTERNS.some((re) => re.test(m))
}

/**
 * 시도할 모델 목록을 순서대로 만든다.
 *
 * - `requireJson`이면 JSON 모드를 못 쓰는 설정 모델(예: Gemma)은 **체인에서 빼고** 대체 모델로 간다.
 *   설정을 지우라고 사용자에게 미루지 않는다 — 화면이 먼저 살아야 한다.
 * - 중복은 제거하고, 설정 모델이 쓸 수 있으면 항상 1순위다(어드민 선택 존중).
 */
export function resolveGeminiModelChain(
  configured: string | null | undefined,
  opts: { requireJson?: boolean } = {}
): string[] {
  const requireJson = opts.requireJson ?? true
  const picked = (configured ?? '').trim()
  const chain: string[] = []

  if (picked && (!requireJson || supportsJsonMode(picked))) chain.push(picked)
  for (const m of GEMINI_MODEL_FALLBACKS) {
    if (!requireJson || supportsJsonMode(m)) chain.push(m)
  }
  // Array.from — 이 저장소의 tsconfig target에서는 Set 스프레드가 downlevelIteration을 요구한다.
  return Array.from(new Set(chain))
}

/**
 * 설정 모델이 요청한 용도에 못 쓰는 경우 사람이 읽을 수 있는 이유를 준다(없으면 null).
 * 화면·로그가 "왜 다른 모델로 돌았는지"를 말할 수 있게 하기 위한 것 — 조용히 바꾸지 않는다.
 */
export function describeModelIssue(configured: string | null | undefined): string | null {
  const m = (configured ?? '').trim()
  if (!m) return null
  if (!supportsJsonMode(m)) {
    return `설정된 모델 '${m}'은 JSON 형식 응답을 지원하지 않아 '${DEFAULT_GEMINI_MODEL}'로 대체했습니다. 관리자 설정에서 모델을 변경해 주세요.`
  }
  return null
}
