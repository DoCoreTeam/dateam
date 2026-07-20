// 경쟁 클라우드 provider 화이트리스트 (SSOT) + 분류 결정성 헬퍼.
// 기존엔 경쟁사 목록이 DB 프롬프트 텍스트에만 있어 결정성·테스트가 불가했고(Nebius는 목록에도 없음),
// 이미지/PDF는 분류 자체를 스킵해 무조건 supplier로 흘렀다.
// 여기서 경쟁 클라우드를 코드 상수로 두고 입력 텍스트에서 결정적으로 탐지한다.

// 경쟁 클라우드 매칭 규칙 — name(표시용) + patterns(소문자 정규식 후보).
// 도메인 변형(.ai/.com)·표기 변형까지 흡수. 과교정 방지를 위해 단어 경계를 가능한 한 사용.
type ProviderRule = { name: string; patterns: RegExp[] }

const COMPETITOR_RULES: ProviderRule[] = [
  { name: 'Nebius', patterns: [/\bnebius\b/] },
  { name: 'RunPod', patterns: [/\brunpod\b/, /\brun\s?pod\b/] },
  { name: 'Lambda', patterns: [/\blambda\s*labs\b/, /\blambdalabs\b/, /\blambda\.ai\b/] },
  { name: 'CoreWeave', patterns: [/\bcoreweave\b/, /\bcore\s?weave\b/] },
  { name: 'Vast.ai', patterns: [/\bvast\.?ai\b/, /\bvast\s?ai\b/] },
  { name: 'AWS', patterns: [/\baws\b/, /\bamazon\s+web\s+services\b/, /\bec2\b/] },
  { name: 'GCP', patterns: [/\bgcp\b/, /\bgoogle\s+cloud\b/] },
  { name: 'Azure', patterns: [/\bazure\b/, /\bmicrosoft\s+azure\b/] },
  { name: 'NHN Cloud', patterns: [/\bnhn\s*cloud\b/, /nhn\s*클라우드/] },
  { name: 'NAVER Cloud', patterns: [/\bnaver\s*cloud\b/, /\bncloud\b/, /네이버\s*클라우드/] },
  { name: 'SaladCloud', patterns: [/\bsalad\s?cloud\b/, /\bsalad\.com\b/] },
  { name: 'CloudV', patterns: [/\bcloudv\b/] },
  { name: 'Runyour AI', patterns: [/\brunyour\s?ai\b/, /\brunyour\.ai\b/] },
]

/** 입력 텍스트에 화이트리스트 경쟁 클라우드가 명확히 등장하는가. */
export function isCompetitorProvider(text: string): boolean {
  return detectCompetitorProviders(text).length > 0
}

/** 입력 텍스트에서 매칭된 경쟁 클라우드 표시명 목록(중복 제거, 등장 순). */
export function detectCompetitorProviders(text: string): string[] {
  if (typeof text !== 'string' || text.length === 0) return []
  const lower = text.toLowerCase()
  const found: string[] = []
  for (const rule of COMPETITOR_RULES) {
    if (rule.patterns.some((re) => re.test(lower)) && !found.includes(rule.name)) {
      found.push(rule.name)
    }
  }
  return found
}

// 사용자 의도 override — 입력 텍스트의 한국어 키워드로 분류를 결정적으로 강제.
// "경쟁사" 류 → competitor 우선, "공급가/공급사/매입" 류 → supplier 우선.
const COMPETITOR_INTENT = /경쟁사|경쟁\s*클라우드|시장가|시세/
const SUPPLIER_INTENT = /공급가|공급사|매입가?|매입/

export type IntentClass = 'competitor' | 'supplier' | null

/**
 * 사용자 의도 분류. competitor 키워드가 있으면 'competitor', supplier 키워드가 있으면 'supplier',
 * 둘 다/없으면 null(=의도 불명 → AI/화이트리스트에 위임). competitor가 supplier보다 우선.
 */
export function classifyByIntent(text: string): IntentClass {
  if (typeof text !== 'string' || text.length === 0) return null
  if (COMPETITOR_INTENT.test(text)) return 'competitor'
  if (SUPPLIER_INTENT.test(text)) return 'supplier'
  return null
}

/**
 * 최종 분류 결정 헬퍼 — 결정 우선순위:
 *  1) 사용자 의도(명시 키워드)  2) AI 분류  3) provider 화이트리스트(supplier 폴백 보정)
 * 반환:
 *  - decision: 'competitor' | 'supplier'
 *  - supplierPresent: 혼합 입력(공급가도 함께) 여부 — AI 판정 유지
 *  - reason: 결정 근거(로깅/UX용)
 */
export function resolveClassification(input: {
  text: string
  aiType?: string | null
  aiSupplierPresent?: boolean
  /** 사용자가 인입 전 직접 선택한 종류. 있으면 추측(키워드/AI/화이트리스트)을 건너뛰고 이 값으로 확정한다. (헌법 제1조 선언 우선) */
  declared?: 'competitor' | 'supplier' | null
}): { decision: 'competitor' | 'supplier'; supplierPresent: boolean; reason: string } {
  // 0) 사용자 선언 최우선 — 추측 자체를 하지 않는다.
  if (input.declared === 'competitor') {
    return { decision: 'competitor', supplierPresent: !!input.aiSupplierPresent, reason: 'declared' }
  }
  if (input.declared === 'supplier') {
    return { decision: 'supplier', supplierPresent: false, reason: 'declared' }
  }
  const intent = classifyByIntent(input.text)
  const aiType = input.aiType === 'competitor' || input.aiType === 'supplier' ? input.aiType : null
  const hasCompetitorProvider = isCompetitorProvider(input.text)

  // 1) 사용자 의도 최우선(결정적)
  if (intent === 'competitor') {
    return { decision: 'competitor', supplierPresent: !!input.aiSupplierPresent, reason: 'intent' }
  }
  if (intent === 'supplier') {
    return { decision: 'supplier', supplierPresent: false, reason: 'intent' }
  }

  // 2) AI가 competitor라 하면 그대로
  if (aiType === 'competitor') {
    return { decision: 'competitor', supplierPresent: !!input.aiSupplierPresent, reason: 'ai' }
  }

  // 3) AI가 supplier(또는 미정)인데 화이트리스트 경쟁사가 명확하면 competitor로 승격(근거 있는 경우만)
  if (hasCompetitorProvider) {
    return { decision: 'competitor', supplierPresent: !!input.aiSupplierPresent, reason: 'whitelist' }
  }

  // 4) 폴백 supplier
  return { decision: 'supplier', supplierPresent: false, reason: aiType ? 'ai' : 'fallback' }
}

/**
 * URL 도메인 → 경쟁사 표시명 폴백. 화이트리스트(COMPETITOR_RULES)는 아는 회사만 잡으므로
 * 신규 사이트는 항상 경쟁사명이 공란이 된다(실사고: verda.com → 41건 전부 공란 저장 직전).
 * 도메인은 그 자체로 회사 식별자라 결정론 폴백으로 안전하다. verda.com → "Verda".
 * (정식 식별·병합은 저장부의 resolveCompetitorId SSOT가 도메인 기준으로 수행)
 */
export function providerFromUrl(url: string | null | undefined): string {
  if (!url) return ''
  try {
    const host = new URL(url).hostname.replace(/^www\./i, '')
    const label = host.split('.')[0] ?? ''
    if (!label || label.length < 2) return ''
    return label.charAt(0).toUpperCase() + label.slice(1)
  } catch { return '' }
}
