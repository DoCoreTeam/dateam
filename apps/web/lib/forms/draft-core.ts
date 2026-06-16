// 임시저장(draft) 순수 로직 — 키 생성·만료·직렬화·민감필드 제외. (브라우저 의존 없음, 단위테스트 대상)
// 훅(useDraft)이 이 코어를 써서 localStorage에 저장. SSOT.

export const DRAFT_PREFIX = 'draft:v1'
export const DEFAULT_TTL_MS = 14 * 24 * 60 * 60 * 1000  // 14일

/** 키: draft:v1:{userId}:{formId}:{recordId}. 공용PC 유출 방지 위해 userId 네임스페이스 필수. */
export function draftKey(userId: string, formId: string, recordId: string): string {
  return `${DRAFT_PREFIX}:${userId || 'anon'}:${formId}:${recordId || 'new'}`
}

export interface DraftEnvelope<T> { savedAt: number; value: T }

/** 민감 필드 제외 후 직렬화. value가 객체면 exclude 키 제거, 문자열이면 그대로. */
export function serializeDraft<T>(value: T, savedAt: number, exclude: string[] = []): string {
  let v: unknown = value
  if (value && typeof value === 'object' && !Array.isArray(value) && exclude.length > 0) {
    const clone: Record<string, unknown> = { ...(value as Record<string, unknown>) }
    for (const k of exclude) delete clone[k]
    v = clone
  }
  return JSON.stringify({ savedAt, value: v } as DraftEnvelope<unknown>)
}

/** 파싱 + TTL 검사. 만료/손상 시 null. */
export function parseDraft<T>(raw: string | null, ttlMs: number, now: number): DraftEnvelope<T> | null {
  if (!raw) return null
  try {
    const env = JSON.parse(raw) as DraftEnvelope<T>
    if (typeof env?.savedAt !== 'number') return null
    if (now - env.savedAt > ttlMs) return null
    return env
  } catch { return null }
}

/** 두 값이 의미적으로 동일한지(복원 배너 노출 판단용 — draft가 현재값과 같으면 배너 불필요). */
export function draftDiffers(draftValue: unknown, current: unknown, exclude: string[] = []): boolean {
  const strip = (v: unknown) => {
    if (v && typeof v === 'object' && !Array.isArray(v) && exclude.length > 0) {
      const c: Record<string, unknown> = { ...(v as Record<string, unknown>) }
      for (const k of exclude) delete c[k]
      return JSON.stringify(c)
    }
    return JSON.stringify(v)
  }
  return strip(draftValue) !== strip(current)
}
