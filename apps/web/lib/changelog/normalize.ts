// 체인지로그 입력 정규화 SSOT — API 라우트들이 공유(복붙 금지).
import type { ChangeItem, ChangeType } from './types'

export const CHANGE_TYPES = new Set<ChangeType>(['feature', 'fix', 'improve'])

/** changes 배열 정규화 — text 트림·빈값 제거·type 화이트리스트·상한 50. */
export function sanitizeChanges(raw: unknown): ChangeItem[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((c) => {
      const o = c as Record<string, unknown>
      const text = typeof o?.text === 'string' ? o.text.trim() : ''
      const type = CHANGE_TYPES.has(o?.type as ChangeType) ? (o.type as ChangeType) : 'feature'
      return text ? { text, type } : null
    })
    .filter((x): x is ChangeItem => x !== null)
    .slice(0, 50)
}

export function normalizeType(v: unknown): ChangeType {
  return CHANGE_TYPES.has(v as ChangeType) ? (v as ChangeType) : 'feature'
}

/** 수동 입력 버전 허용 패턴 — 영숫자·점·하이픈만(예: 0.7.197, 0.7.197-hotfix). 인젝션·잡문자 차단. */
export function isVersionLike(v: string): boolean {
  return /^[\w.\-]{1,40}$/.test(v)
}

/** git 자동수집용 엄격 버전 — X.Y.Z */
export const STRICT_VERSION_RE = /^\d+\.\d+\.\d+$/

/** ISO 날짜(YYYY-MM-DD) 검증 */
export function isIsoDate(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v)
}

/** PostgREST .or() 필터 인젝션 방지 — 구조 메타문자(,()*\)만 공백 치환. 점은 버전 검색(0.7.197), 하이픈은 검색어로 보존. */
export function sanitizeSearch(q: string): string {
  return q.replace(/[,()*\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100)
}
