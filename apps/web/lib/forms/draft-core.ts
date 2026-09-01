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

/**
 * 이 값을 임시저장소에 **써도 되는가.**
 *
 * **왜 필요한가**(실측 v0.7.677): 저장 효과는 값이 바뀔 때만 도는 게 아니라
 * **마운트 때도 한 번 돈다.** 그래서 예전에는 화면을 *열기만 해도* 디바운스(0.6초) 뒤
 * 「서버에서 읽어 온 값」이 저장돼, **복원 배너가 떠 있는 채로 그 초안이 덮였다.**
 * 사용자에게 주어진 시간은 0.6초였고, 그 뒤엔 되돌릴 곳이 없다
 * (회의노트 한 건에서 실제로 그렇게 사라졌다).
 *
 * 규칙은 하나다 — **현재 값이 원본과 같으면 쓸 것이 없다.** 아직 아무것도 안 고쳤다는 뜻이므로
 * 저장할 이유가 없고, 그 자리에 남의(=지난 세션의) 초안이 있을 수 있다.
 */
export function shouldPersistDraft(value: unknown, initial: unknown): boolean {
  return draftDiffers(value, initial)
}
