// GPU 모델명 → tier 자동 판정 (택소노미: 데이터센터=T1 / 워크스테이션=T2 / 소비자=T3)
// Tier 1: 데이터센터·클라우드 GPU (H100·A100·B200·GH200·L40·L4·T4·V100·A10·A40 등) — 기본값
// Tier 2: 워크스테이션 (RTX A시리즈·RTX Ada·Quadro·RTX PRO)
// Tier 3: 소비자 지포스 (RTX 2060~5090, GTX)
// 규칙: 데이터센터/클라우드에서 파는 것은 일단 Tier1. 통합입력에서 명시적으로 tier를 지정하면 그것을 우선(override).
// DB의 infer_tier() 함수(059)와 동일 규칙 — drift 주의.

/**
 * 모델명으로 tier 추론. override(사용자가 통합입력에서 명시한 tier)가 있으면 최우선.
 */
export function inferTier(modelName: string, override?: number | null): 1 | 2 | 3 {
  // 통합입력에서 명시적으로 지정한 tier override 최우선
  if (override === 1 || override === 2 || override === 3) return override

  const s = modelName.toLowerCase().trim()

  // 1) 워크스테이션 RTX/Quadro (Ada·A시리즈·PRO·Quadro) → T2 (소비자보다 먼저)
  if (/rtx pro|rtx a[0-9]|rtx [0-9]+ ada|quadro/.test(s) || /\b(a6000|a5000|a5500|a4000|a4500|a2000)\b/.test(s)) return 2
  // 2) 소비자 지포스 (RTX 2060~5090 비-Ada, GTX) → T3
  if (/rtx\s*[2345]0[0-9]0/.test(s) || /\b(gtx|geforce)\b/.test(s)) return 3
  // 3) 데이터센터/클라우드 + 미지 → T1 (기본)
  return 1
}
