// GPU 모델명 → tier 자동 판정 사전
// Tier 1: 전용 고성능 데이터센터 (보장형)
// Tier 2: 점유형 / 워크스테이션급
// Tier 3: 간헐 공급 / 소비자(RTX 지포스)급
//
// 신규 모델 자동등록 시 tier 미지정이면 이 사전으로 추론한다.

const TIER1 = [
  'h100', 'h200', 'h800', 'b100', 'b200', 'b300', 'gb200', 'gb300',
  'a100', 'a800', 'mi300', 'mi325', 'gaudi',
]
const TIER2 = [
  'l40', 'l40s', 'l4', 'a40', 'a30', 'a10', 'a16', 'v100', 't4',
  'rtx pro 6000', 'rtx 6000 ada', 'rtx 5000 ada', 'rtx a6000', 'rtx a5000', 'rtx a5500',
]
// 그 외 RTX 지포스 소비자 카드(20·30·40·50 시리즈) → Tier 3 기본

/**
 * 모델명으로 tier 추론. AI가 제안한 tier가 있으면 그것을 우선하되,
 * 명백한 소비자 RTX가 tier1로 오는 경우만 교정.
 */
export function inferTier(modelName: string, suggested?: number | null): 1 | 2 | 3 {
  const s = modelName.toLowerCase().trim()

  // 사전 정확 매칭 우선
  if (TIER1.some((k) => s.includes(k))) return 1
  if (TIER2.some((k) => s.includes(k))) return 2

  // 소비자 RTX 지포스 (RTX 2060~5090 등, Ada/A 워크스테이션 제외) → T3
  if (/\brtx\s*[2345]0\d0/.test(s)) return 3
  if (/\b(gtx|geforce)\b/.test(s)) return 3

  // 사전에 없으면 AI 제안 → 없으면 안전하게 T2(중간)
  if (suggested === 1 || suggested === 2 || suggested === 3) return suggested
  return 2
}
