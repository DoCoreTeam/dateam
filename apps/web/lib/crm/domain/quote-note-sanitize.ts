/**
 * 특기사항 HTML 정리기 — **서버에서만 부른다** (P0145, 보안 S4)
 *
 * 특기사항은 고객에게 나가는 문서에 그대로 그려진다. 저장할 때 한 번, 문서를 내줄 때 한 번 지난다 —
 * 저장 때만 거르면 DB 를 손으로 고친 값이 그대로 화면에 꽂힌다.
 *
 * 허용 목록은 문서에 필요한 만큼만이다. 링크·그림·style 은 안 받는다 — 견적서에 누를 것은 없고,
 * 색과 글꼴은 문서 서식이 정한다.
 */

import sanitizeHtml from 'sanitize-html'
import { CrmError } from './errors.ts'
import { isNoteHtml } from './quote-note.ts'
import { normalizeMultiline } from './normalize.ts'

/** 특기사항 HTML 길이 상한. 넘으면 저장을 거절한다 (비정상 입력 막이) */
export const MAX_NOTE_HTML = 20_000

const SANITIZE_OPTS: sanitizeHtml.IOptions = {
  /*
    제목은 막대에 없지만 「# 」 같은 입력 규칙으로 생긴다. 지우면 글자만 남고 굵기가 사라져
    사람이 넣은 구분이 저장 뒤 없어진다 — 받아 두고 문서 서식이 같은 크기로 그린다.
  */
  allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'blockquote', 'hr'],
  allowedAttributes: {},
  allowedSchemes: [],
  disallowedTagsMode: 'discard',
}

/** 허용 목록으로 정리한다. 글자가 하나도 안 남으면 빈 문자열 */
export function sanitizeNoteHtml(html: string): string {
  /*
    편집기는 끝에 빈 문단을 하나 달고 끝난다(커서 자리). 그대로 두면 특기사항 아래에 빈 줄이
    인쇄된다 — 끝에 붙은 빈 문단만 뗀다, 가운데 빈 줄은 사람이 일부러 둔 간격이다.
  */
  const clean = sanitizeHtml(html ?? '', SANITIZE_OPTS).trim().replace(/(<p>\s*(<br\s*\/?>)?\s*<\/p>\s*)+$/, '')
  return clean.replace(/<[^>]+>/g, '').trim() === '' ? '' : clean
}

/** 저장할 값. HTML 은 정리하고, 옛 글자는 지금까지처럼 줄을 살려 다듬는다 */
export function normalizeNoteInput(input: string | null | undefined): string | null {
  if (!isNoteHtml(input)) return normalizeMultiline(input)
  const raw = input ?? ''
  if (raw.length > MAX_NOTE_HTML) {
    throw new CrmError('VALIDATION_FAILED', '특기사항이 너무 깁니다.', { field: 'notesMd' })
  }
  return sanitizeNoteHtml(raw) || null
}
