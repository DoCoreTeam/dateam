// lib/ci/assets/storage.ts — 자료 보관 위치 결정 SSOT (서버 전용)
//
// 원칙: **원본은 우리 서버에 쌓지 않는다.**
// 우리가 갖는 건 분석 결과와 "어디에 있는지"뿐이다.
//  - 파일 → 이미 연동된 구글드라이브(lib/google-drive.ts 재사용)
//  - 링크 → 아무것도 보관하지 않고 주소와 메타만 남긴다
// 드라이브가 끊겨 있으면 조용히 우리 저장소로 흘리지 않는다 — 막고 이유를 말한다.

import { ensureFolder, uploadFile, getDriveConnectionStatus } from '@/lib/google-drive'

/** 드라이브 안에서 이 제품이 쓰는 폴더. 회사 폴더 아래로 모은다. */
export const DRIVE_ROOT_FOLDER = 'AX사업본부'
export const DRIVE_CI_FOLDER = '콘텐츠 인텔리전스'

/** 워크스페이스별로 폴더를 나눠 남의 자료와 섞이지 않게 한다. */
export async function ensureWorkspaceFolder(workspaceName: string): Promise<string> {
  const rootId = await ensureFolder(DRIVE_ROOT_FOLDER)
  const ciId = await ensureFolder(DRIVE_CI_FOLDER, rootId)
  const safeName = workspaceName.replace(/[/\\]/g, '_').slice(0, 80) || '기본'
  return ensureFolder(safeName, ciId)
}

export type StorageTarget =
  | { ok: true; provider: 'drive'; folderId: string }
  | { ok: false; reason: string }

/**
 * 파일을 어디에 둘지 판정한다.
 * 드라이브 미연동이면 업로드 자체를 막는다 — 우리 서버에 쌓기 시작하면 되돌리기 어렵다.
 */
export async function resolveStorageTarget(workspaceName: string): Promise<StorageTarget> {
  const status = await getDriveConnectionStatus()
  if (!status.connected) {
    return {
      ok: false,
      reason: '구글드라이브가 연결되어 있지 않습니다. 관리자 설정에서 연결한 뒤 올려 주세요',
    }
  }
  try {
    const folderId = await ensureWorkspaceFolder(workspaceName)
    return { ok: true, provider: 'drive', folderId }
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : '드라이브 폴더를 준비하지 못했습니다',
    }
  }
}

/** 드라이브에 올리고 파일 ID를 돌려준다. */
export async function putFile(input: {
  buffer: Buffer
  fileName: string
  mime: string
  folderId: string
}): Promise<string> {
  return uploadFile(input.buffer, input.fileName, input.mime, input.folderId)
}
