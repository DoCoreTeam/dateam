// AI 섹션 출력(HTML/plain) → 불릿별 plain text 배열 SSOT.
// 왜: item.content는 plain 텍스트 필드다(표시=textarea, 저장 시 serialize가 <li>로 재래핑).
//     AI 스타일가이드가 <ul><li> HTML을 지시하므로 여기서 반드시 htmlToPlain(SSOT)으로 수문한다(§5-1).
//     별도 모듈로 둔 이유: generate-draft.ts는 gemini(@/lib 별칭) 체인을 끌어와 node:test에서 로드 불가라,
//     이 순수 변환만 분리해 단위 테스트 가능하게 한다.
import { htmlToPlain } from '../html-to-plain.ts'

/** 섹션 HTML(<ul><li>…</li></ul>) 또는 plain 텍스트를 불릿별 plain 라인 배열로 분해. */
export function sectionToLines(section: string): string[] {
  const lis = section.match(/<li[^>]*>[\s\S]*?<\/li>/gi)
  if (lis && lis.length > 0) {
    return lis.map((li) => htmlToPlain(li).replace(/^-\s*/, '').trim()).filter(Boolean)
  }
  // <li> 없음 — 전체를 plain 변환 후 줄 단위 분리(휴리스틱 폴백)
  return htmlToPlain(section)
    .split('\n')
    .map((l) => l.replace(/^-\s*/, '').trim())
    .filter(Boolean)
}
