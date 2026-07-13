// 첨부 규칙 + 프로바이더별 멀티모달 매핑 SSOT (세션 2)
// 설계: session-2-multimodal-completeness.md §3-2·§4-2 / SSOT 04 §4.
// provider.ts(세션 1 소유)는 TYPE-ONLY import — 타입 스트리핑 런타임에서 파일 부재여도 실행됨.
import type { ChatTurn, AttachmentInput } from './provider'

export type AttachmentKind = 'image' | 'pdf' | 'document' | 'other'
// ↑ DB check·AiChatAttachment.kind와 동일 4종 union(04 §3) — 'other'는 예약값(업로드 API 미발급)

export const DOCUMENT_TEXT_MIMES = ['text/plain', 'text/csv', 'text/markdown', 'application/json'] as const
export const DOCUMENT_OFFICE_MIMES = [
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // pptx
] as const

export const ATTACHMENT_RULES: Record<
  Exclude<AttachmentKind, 'other'>,
  { mimes: readonly string[]; maxBytes: number }
> = {
  image: { mimes: ['image/png', 'image/jpeg', 'image/webp'], maxBytes: 5 * 1024 * 1024 },
  pdf: { mimes: ['application/pdf'], maxBytes: 20 * 1024 * 1024 },
  document: { mimes: [...DOCUMENT_TEXT_MIMES, ...DOCUMENT_OFFICE_MIMES], maxBytes: 10 * 1024 * 1024 },
}

export const MAX_DOCUMENT_TEXT_CHARS = 100_000 // 디코드/추출 텍스트 공통 절단 상한(초과 시 절단 + 말미 '[이하 절단]')
export const MAX_ATTACHMENTS_PER_MESSAGE = 5
export const MAX_REQUEST_ATTACHMENT_BYTES = 20 * 1024 * 1024 // 스트림 요청당 base64 원본 총량
export const SIGNED_URL_TTL_SEC = 3600

const TEXT_DOCUMENT_MAX_BYTES = 1 * 1024 * 1024 // 텍스트 계열 document는 1MB(프롬프트 인라인 텍스트)

// mime → 확장자 고정 맵 (경로 결정용 — 원본 파일명은 경로에 절대 미사용)
const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'text/markdown': 'md',
  'application/json': 'json',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
}

function includesMime(list: readonly string[], mime: string): boolean {
  return list.includes(mime)
}

export function kindOfMime(mime: string): Exclude<AttachmentKind, 'other'> | null {
  const kinds: Array<Exclude<AttachmentKind, 'other'>> = ['image', 'pdf', 'document']
  for (const kind of kinds) {
    if (includesMime(ATTACHMENT_RULES[kind].mimes, mime)) return kind
  }
  return null
}

// 텍스트 계열 document는 1MB, office는 10MB, 그 외 kind 상한. 미지원 mime → 0.
export function maxBytesForMime(mime: string): number {
  if (includesMime(DOCUMENT_TEXT_MIMES, mime)) return TEXT_DOCUMENT_MAX_BYTES
  if (includesMime(DOCUMENT_OFFICE_MIMES, mime)) return ATTACHMENT_RULES.document.maxBytes
  const kind = kindOfMime(mime)
  return kind ? ATTACHMENT_RULES[kind].maxBytes : 0
}

// 'image/png'→'png', 'text/markdown'→'md', '…wordprocessingml.document'→'docx' … 고정 맵. 미지원 → 'bin'
export function extFromMime(mime: string): string {
  return EXT_BY_MIME[mime] ?? 'bin'
}

function isDecodableUtf8NoNul(buf: Uint8Array): boolean {
  if (buf.includes(0)) return false
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf)
    return true
  } catch {
    return false
  }
}

// 매직바이트 스니핑(mime 위장 차단). office 3종은 ZIP 'PK\x03\x04'. 텍스트 계열은 UTF-8 디코드+NUL 없음.
export function sniffMagicBytes(buf: Uint8Array, mime: string): boolean {
  const b = buf
  switch (mime) {
    case 'image/png': // 89 50 4E 47 0D 0A 1A 0A (정식 8바이트 시그니처)
      return (
        b.length >= 8 &&
        b[0] === 0x89 &&
        b[1] === 0x50 &&
        b[2] === 0x4e &&
        b[3] === 0x47 &&
        b[4] === 0x0d &&
        b[5] === 0x0a &&
        b[6] === 0x1a &&
        b[7] === 0x0a
      )
    case 'image/jpeg': // FF D8 FF
      return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
    case 'image/webp': // 52 49 46 46 … 57 45 42 50 (offset 8)
      return (
        b.length >= 12 &&
        b[0] === 0x52 &&
        b[1] === 0x49 &&
        b[2] === 0x46 &&
        b[3] === 0x46 &&
        b[8] === 0x57 &&
        b[9] === 0x45 &&
        b[10] === 0x42 &&
        b[11] === 0x50
      )
    case 'application/pdf': // %PDF- = 25 50 44 46 2D
      return (
        b.length >= 5 &&
        b[0] === 0x25 &&
        b[1] === 0x50 &&
        b[2] === 0x44 &&
        b[3] === 0x46 &&
        b[4] === 0x2d
      )
    default:
      if (includesMime(DOCUMENT_OFFICE_MIMES, mime)) {
        // ZIP 시그니처 50 4B 03 04
        return b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04
      }
      if (includesMime(DOCUMENT_TEXT_MIMES, mime)) {
        return isDecodableUtf8NoNul(b)
      }
      return false
  }
}

// 제어문자 제거 · 경로구분자(/ \) 제거 · 200자 절단 — DB 저장 전 방어(표시 전용).
export function sanitizeFilenameForDisplay(name: string): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, '') // 제어문자
    .replace(/[/\\]/g, '') // 경로구분자
  return cleaned.slice(0, 200)
}

// extractDocumentText(officeparser, 서버 전용)는 클라이언트 번들 오염 방지를 위해
// ./document-extract.ts 로 분리했다. (attachments.ts는 클라이언트 컴포넌트가 import)

// document의 dataBase64는 항상 텍스트의 base64 — 디코드해 원문 복원.
function decodeDocumentText(dataBase64: string): string {
  return Buffer.from(dataBase64, 'base64').toString('utf8')
}

// ── 프로바이더별 매핑 (순수함수 — SDK 타입 비의존, plain object 반환) ──

type ClaudeBlock =
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } }
  | { type: 'document'; source: { type: 'text'; media_type: 'text/plain'; data: string }; title?: string }
  | { type: 'text'; text: string }

// image → image/base64, pdf → document/base64, document → document/source.type='text'(디코드 원문, title=filename), 마지막에 text
export function toClaudeContent(turn: ChatTurn): ClaudeBlock[] {
  const blocks: ClaudeBlock[] = []
  for (const att of turn.attachments ?? []) {
    if (att.kind === 'image') {
      blocks.push({ type: 'image', source: { type: 'base64', media_type: att.mime, data: att.dataBase64 } })
    } else if (att.kind === 'pdf') {
      blocks.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: att.dataBase64 },
      })
    } else {
      blocks.push({
        type: 'document',
        source: { type: 'text', media_type: 'text/plain', data: decodeDocumentText(att.dataBase64) },
        title: att.filename,
      })
    }
  }
  // 첨부 전용 발화(빈 content)면 text 블록 생략 — Anthropic API는 빈 text 블록을 400으로 거부(§5-1 첨부전용 허용)
  if (turn.content.length > 0) blocks.push({ type: 'text', text: turn.content })
  return blocks
}

type GeminiPart = { inline_data: { mime_type: string; data: string } } | { text: string }

// image·pdf·document 전부 inline_data(base64) + 마지막 text part (Gemini는 text/* inline 지원)
export function toGeminiParts(turn: ChatTurn): GeminiPart[] {
  const parts: GeminiPart[] = []
  for (const att of turn.attachments ?? []) {
    parts.push({ inline_data: { mime_type: att.mime, data: att.dataBase64 } })
  }
  // 빈 content면 text part 생략(첨부 inline_data가 최소 1개 보장 — 빈 part 방지)
  if (turn.content.length > 0) parts.push({ text: turn.content })
  return parts
}

type OpenAiPart =
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'file'; file: { filename: string; file_data: string } }
  | { type: 'text'; text: string }

// image → image_url(data URL), pdf → file 블록(file_data도 data URL),
// document → 원문 디코드 후 "[첨부 문서: {filename}]\n{원문}" 프리픽스로 text 블록에 병합.
export function toOpenAiContent(turn: ChatTurn): OpenAiPart[] {
  const parts: OpenAiPart[] = []
  const docTexts: string[] = []
  for (const att of turn.attachments ?? []) {
    if (att.kind === 'image') {
      parts.push({ type: 'image_url', image_url: { url: `data:${att.mime};base64,${att.dataBase64}` } })
    } else if (att.kind === 'pdf') {
      parts.push({
        type: 'file',
        file: { filename: att.filename, file_data: `data:${att.mime};base64,${att.dataBase64}` },
      })
    } else {
      docTexts.push(`[첨부 문서: ${att.filename}]\n${decodeDocumentText(att.dataBase64)}`)
    }
  }
  const merged = [...docTexts, turn.content].filter((s) => s.length > 0).join('\n\n')
  // 병합 결과가 비면(캡션·문서 없이 이미지/pdf만) text 블록 생략 — 빈 text 블록 400 방지
  if (merged.length > 0) parts.push({ type: 'text', text: merged })
  return parts
}

// vision 미지원 폴백 (모든 프로바이더 공용) — 첨부를 파일명 플레이스홀더 텍스트로 대체.
export function attachmentFallbackText(atts: AttachmentInput[]): string {
  const names = atts.map((a) => a.filename).join(', ')
  return `[첨부 ${atts.length}개는 현재 모델에서 지원되지 않아 제외됨: ${names}]`
}
