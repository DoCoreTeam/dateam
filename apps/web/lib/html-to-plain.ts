// HTML → plain text 변환 (SSOT). 리치텍스트(Tiptap HTML)를 AI 입력·plain 인용으로 넘길 때 사용.
// 사고 방지: 주간보고 HTML(<br>,<p>)이 AI source_quote로 흘러 태그가 글자로 노출되던 문제 해소.
const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'",
}

export function htmlToPlain(input: string | null | undefined): string {
  if (!input) return ''
  return input
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1\s*>/gi, '') // script/style 블록 통째 제거(텍스트 누출 방지)
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')        // <br> → 줄바꿈
    .replace(/<\/(p|div|li|h[1-6])\s*>/gi, '\n') // 블록 종료 → 줄바꿈
    .replace(/<li[^>]*>/gi, '- ')                // 리스트 항목 → 불릿
    .replace(/<[^>]+>/g, '')                     // 나머지 태그 제거
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&[a-z]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
