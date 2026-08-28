/**
 * 첨부 — 말의 SSOT (§0-2)
 *
 * 화면에 한글을 직접 적지 않는다. 여기서 가져다 쓴다.
 */

export type AttachmentTarget = 'DEAL' | 'COMPANY' | 'PERSON' | 'MEETING' | 'QUOTE' | 'DEAL_COST' | 'IN_KIND'
export type AttachmentKind = 'BUSINESS_CARD' | 'SUPPLY_QUOTE' | 'CONTRACT' | 'IN_KIND_EVIDENCE' | 'OTHER'

export const ATTACHMENT_KIND_LABEL: Record<AttachmentKind, string> = {
  BUSINESS_CARD: '명함',
  SUPPLY_QUOTE: '매입 견적서',
  CONTRACT: '계약서',
  IN_KIND_EVIDENCE: '현물 증빙',
  OTHER: '기타',
}

export const ATTACHMENT_KIND_ORDER: readonly AttachmentKind[] =
  ['BUSINESS_CARD', 'CONTRACT', 'SUPPLY_QUOTE', 'IN_KIND_EVIDENCE', 'OTHER']

/**
 * 종류마다 **민감도가 다르다.**
 * 매입 견적서는 우리 원가가 그대로 드러나므로 관리자만 본다 —
 * 명함과 같은 등급에 두면 원가가 영업 전원에게 열린다.
 */
export const ATTACHMENT_KIND_SENSITIVITY: Record<AttachmentKind, 'INTERNAL' | 'RESTRICTED'> = {
  BUSINESS_CARD: 'INTERNAL',
  CONTRACT: 'INTERNAL',
  SUPPLY_QUOTE: 'RESTRICTED',
  IN_KIND_EVIDENCE: 'RESTRICTED',
  OTHER: 'INTERNAL',
}

export const ATTACHMENT = {
  section: '첨부',
  add: '파일 올리기',
  empty: '첨부한 파일이 아직 없어요',
  emptyHint: '명함 사진·계약서·증빙을 여기에 두면 이 건과 함께 남습니다.',
  restricted: '대외비 — 관리자만 볼 수 있어요',
  tooBig: '파일은 20MB까지 올릴 수 있어요.',
  badType: '이미지(PNG·JPG·WebP)·PDF·엑셀·워드만 올릴 수 있어요.',
  failed: '파일을 올리지 못했습니다.',
  /** 내려받기는 **잠깐 열리는 주소**로 한다 — 링크가 새어도 곧 만료된다 */
  downloadHint: '내려받기 주소는 잠시 후 만료됩니다.',
} as const

/** 20MB — 명함·계약서에 충분하고, 서버 메모리를 통과하므로 상한이 필요하다 */
export const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024

export const ATTACHMENT_MIME_OK: readonly string[] = [
  'image/png', 'image/jpeg', 'image/webp', 'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]
