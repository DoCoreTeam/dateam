// GPU 견적 수량 파싱 + 1장당 단가 정규화
// 입력이 어떤 형태로 와도 gpu_count를 추출하고 per-GPU 단가로 환산한다.
// 원본(original_price/original_unit)은 호출측에서 그대로 보존한다.

/**
 * 텍스트에서 GPU 장수 추출.
 *  "8GPU" / "x8" / "×8" / "8장" / "box(8)" / "8-GPU" / "8 GPUs" → 8
 *  단서 없으면 fallback(기본 1) 반환.
 */
export function parseGpuCount(
  raw: string | null | undefined,
  fallback = 1,
): number {
  if (!raw) return fallback
  const s = String(raw).toLowerCase()

  // 결함 C 가드 — "8장 이상", "최소 8", "8개+" 등 최소주문수량(min_qty)을 구성 장수로 오인 금지.
  // 숫자 뒤에 이상/이상~/min/최소/+/~ 가 붙으면 그 숫자는 min_qty 신호 → 후보에서 제외.
  const isMinQtyContext = (idx: number, len: number): boolean => {
    const after = s.slice(idx + len, idx + len + 10)
    if (/^\s*(이상|개이상|장이상|\+|~|or\s*more|min)/.test(after)) return true
    const before = s.slice(Math.max(0, idx - 6), idx)
    if (/(최소\s*|min(\.|imum)?\s*|이상\s*)$/.test(before)) return true
    return false
  }

  // 우선순위 패턴들 (가장 명시적인 것부터)
  const patterns: RegExp[] = [
    /[x×]\s*(\d{1,2})\b/,            // x8, ×8
    /\b(\d{1,2})\s*[x×]\b/,          // 8x
    /\(\s*(\d{1,2})\s*(?:gpu|장|ea)?\s*\)/, // box(8), (8장)
    /\b(\d{1,2})\s*gpus?\b/,         // 8GPU, 8 GPUs
    /(\d{1,2})\s*장/,                // 8장 (한글 단위 — \b는 비-ASCII 뒤에서 미작동)
    /\bgpu\s*[:x×]?\s*(\d{1,2})\b/,  // GPU 8, GPU:8
  ]
  for (const re of patterns) {
    const m = s.match(re)
    if (m && m.index != null) {
      const n = parseInt(m[1], 10)
      if (n >= 1 && n <= 16 && !isMinQtyContext(m.index, m[0].length)) return n
    }
  }
  return fallback
}

/**
 * original_unit 문자열이 "박스(여러 장) 기준 가격"인지 판단.
 *  "USD/box", "/8GPU", "박스" 등 → true (총액 → ÷ count 필요)
 *  "USD/GPU·hr", "per GPU" 등 → false (이미 1장당)
 */
export function isBoxPriced(originalUnit: string | null | undefined): boolean {
  if (!originalUnit) return false
  const s = originalUnit.toLowerCase()
  // 명시적 per-GPU 표기면 박스 아님
  if (/per\s*gpu|\/\s*gpu|gpu\s*[·*]\s*hr|gpu당|장당/.test(s)) return false
  // box / 총액 / 세트 표기면 박스
  if (/box|세트|set|총|\/\s*\d+\s*gpu|\(\s*\d+/.test(s)) return true
  return false
}

/**
 * 1장당 단가 환산.
 *  - 박스가격이면 price ÷ gpuCount
 *  - per-GPU 가격이면 price 그대로
 * @returns 1장당 단가 (소수 4자리 반올림)
 */
export function toPerGpuPrice(
  price: number,
  gpuCount: number,
  originalUnit: string | null | undefined,
): number {
  if (!price || gpuCount < 1) return price
  const perGpu = isBoxPriced(originalUnit) ? price / gpuCount : price
  return Math.round(perGpu * 10000) / 10000
}
