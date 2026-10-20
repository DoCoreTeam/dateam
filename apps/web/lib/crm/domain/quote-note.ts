/**
 * 견적 특기사항 — 옛 글자와 새 서식 글을 한 칸에서 함께 읽는다 (P0145)
 *
 * **칸은 그대로 `notesMd` 다.** 편집기가 생기기 전에 적힌 특기사항은 줄바꿈으로 나눈 글자이고,
 * 편집기로 고친 것부터 HTML 이다. 칸을 새로 만들어 옮기면 이미 나간 견적서를 다시 써야 하므로
 * 읽는 쪽이 둘을 가른다 — 태그로 시작하면 HTML, 아니면 글자.
 *
 * 여기는 **화면도 부른다**(견적 수정 창이 옛 글자를 편집기에 넣을 때). 그래서 정리기(sanitize-html)를
 * 안 들인다 — 정리는 서버 전용 `quote-note-sanitize.ts` 가 저장 때와 문서 응답 때 한다.
 */

import { htmlToPlain } from '../../html-to-plain.ts'

/** 편집기가 쓴 HTML 인가. 옛 글자는 태그로 시작하지 않는다 */
export function isNoteHtml(note: string | null | undefined): boolean {
  return /^\s*<(p|ul|ol|h[1-6]|blockquote|table)[\s>]/i.test(note ?? '')
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 그릴 HTML. 옛 글자는 **줄마다 문단 하나**로 바꾼다 — 사람이 나눠 적은 줄이 종이에서도 그대로 선다.
 * HTML 은 손대지 않는다(정리는 서버가 한다). 비었으면 빈 문자열.
 */
export function noteToHtml(note: string | null | undefined): string {
  const raw = (note ?? '').trim()
  if (raw === '') return ''
  if (isNoteHtml(raw)) return raw
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('')
}

/** 글자만. 엑셀과 지문처럼 서식을 못 싣는 자리가 쓴다 */
export function noteToPlain(note: string | null | undefined): string {
  const raw = (note ?? '').trim()
  if (!isNoteHtml(raw)) return raw
  return htmlToPlain(raw)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
}
