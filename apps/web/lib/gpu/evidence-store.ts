// 원본데이터 보관 SSOT — 통합입력 업로드 원본을 Google Drive(AX사업본부/GPU견적)에 보관.
// Drive 미연결이면 graceful degrade(null 반환 + reason). 추출 흐름은 절대 막지 않음.
// lib/google-drive.ts(SSOT) 재사용 — 직접 googleapis 호출 복붙 금지.

import { ensureFolder, uploadFile, getDriveConnectionStatus } from '@/lib/google-drive'

const ROOT_FOLDER = 'AX사업본부'
const GPU_FOLDER = 'GPU견적'
const MAX_FILENAME_LEN = 200

// 업로드 파일명 정제 — control char·경로구분·RTL override·과다길이 제거(파일명 위장/인젝션 방어).
function sanitizeFilename(name: string | null | undefined): string {
  const cleaned = (name ?? '')
    .replace(/[\r\n\t]/g, '')
    .replace(/[^A-Za-z0-9가-힣._\-() ]/g, '_')
    .replace(/\.{2,}/g, '.')
    .trim()
    .slice(0, MAX_FILENAME_LEN)
  return cleaned || `gpu-quote-${Date.now()}`
}

export interface EvidenceStoreResult {
  fileId: string | null
  reason: 'stored' | 'drive_not_connected' | 'upload_failed' | 'empty'
  error?: string
}

/**
 * 업로드 원본을 Drive에 보관하고 file id 반환.
 * 실패·미연결이어도 throw하지 않음(부분 degrade) — 호출부는 null이면 보관 생략하고 추출 계속.
 */
export async function storeGpuEvidence(input: {
  buffer: Buffer
  filename: string
  mimeType: string
}): Promise<EvidenceStoreResult> {
  if (!input.buffer || input.buffer.length === 0) {
    return { fileId: null, reason: 'empty' }
  }
  try {
    const status = await getDriveConnectionStatus()
    if (!status.connected) return { fileId: null, reason: 'drive_not_connected' }

    const rootId = await ensureFolder(ROOT_FOLDER)
    const gpuFolderId = await ensureFolder(GPU_FOLDER, rootId)
    const safeName = sanitizeFilename(input.filename)
    const fileId = await uploadFile(input.buffer, safeName, input.mimeType || 'application/octet-stream', gpuFolderId)
    return { fileId, reason: 'stored' }
  } catch (e) {
    // 원본 에러는 서버 로그로만(인증/scope/quota 메시지 노출 방지). 호출부엔 reason만.
    console.error('[gpu/evidence-store] Drive 업로드 실패:', e)
    return { fileId: null, reason: 'upload_failed' }
  }
}
