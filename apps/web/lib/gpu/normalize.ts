/**
 * GPU 메모리 표기 정규화
 * "80 GB", "80gb", "80 GiB" → "80GB"
 * GPU 업계 관행상 GiB와 GB를 동일하게 취급 (80GB 카드 = 실제론 80GiB)
 */
export function normalizeMemory(raw: string | null | undefined): string | null {
  if (!raw) return null
  const normalized = raw
    .trim()
    .replace(/\s+/g, '')
    .toUpperCase()
    .replace(/\bGIB\b/g, 'GB')
  return normalized || null
}
