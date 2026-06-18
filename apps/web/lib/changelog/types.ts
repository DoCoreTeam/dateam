// 체인지로그 공용 타입 (SSOT). API·어드민·공개 모달·빌드 스크립트가 공유.

export type ChangeType = 'feature' | 'fix' | 'improve'

export interface ChangeItem {
  text: string
  type: ChangeType
}

/** DB app_releases 행 (공개/어드민 공통 표시 모델) */
export interface Release {
  id?: string
  version: string
  released_at: string | null   // 'YYYY-MM-DD'
  title: string | null
  changes: ChangeItem[]
  type: ChangeType
  is_published?: boolean
  sort_order?: number | null
}

/** git log 한 줄 (빌드 스크립트가 채움) */
export interface RawCommit {
  date: string      // 'YYYY-MM-DD'
  subject: string   // 'vX.Y.Z: 내용 claude'
}
