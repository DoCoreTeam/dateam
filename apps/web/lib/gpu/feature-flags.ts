// GPU 가격관리 리팩토링 — feature flag (즉시 롤백 가능)
//
// 통합 표/통합 입력 신규 UX 플래그. 리팩토링 완료에 따라 'unified' 기본값 ON.
//   - 기본값(미설정 시): DEFAULT_ON 참조 — unified=true(통합뷰가 기본 화면)
//   - 환경변수 강제: NEXT_PUBLIC_GPU_UNIFIED ('1'|'true' → 강제 ON, '0'|'false' → 강제 OFF)
//   - 클라이언트 오버라이드(개발/파일럿): localStorage['gpu:flag:unified'] = 'on'|'off'
// 롤백: 환경변수에 '0' 지정하거나 localStorage 'off' → 기존 10탭으로 복귀(무비용).

export type GpuFlagKey = 'unified'

const ENV_MAP: Record<GpuFlagKey, string | undefined> = {
  unified: process.env.NEXT_PUBLIC_GPU_UNIFIED,
}

// 환경변수·오버라이드가 모두 없을 때의 기본값(SSOT). 리팩토링 완료 → 통합뷰가 기본.
const DEFAULT_ON: Record<GpuFlagKey, boolean> = {
  unified: true,
}

const STORAGE_PREFIX = 'gpu:flag:'

// 환경변수 기준 base 값: 명시 ON/OFF면 그 값, 미설정이면 DEFAULT_ON.
function resolveBase(key: GpuFlagKey): boolean {
  const raw = ENV_MAP[key]
  if (raw === '1' || raw === 'true') return true
  if (raw === '0' || raw === 'false') return false
  return DEFAULT_ON[key]
}

/**
 * localStorage 무관 base 값(서버·클라이언트 동일). useState 초기값으로 사용해
 * 첫 페인트부터 올바른 뷰를 그려 '구뷰→신뷰' 깜빡임을 없앤다(하이드레이션 안전).
 * localStorage 오버라이드는 마운트 후 isGpuFlagOn으로 반영.
 */
export function gpuFlagBase(key: GpuFlagKey): boolean {
  return resolveBase(key)
}

/**
 * 플래그 ON 여부. 서버/클라이언트 공통 — 클라이언트에서는 localStorage 오버라이드가 환경변수보다 우선.
 */
export function isGpuFlagOn(key: GpuFlagKey): boolean {
  const base = resolveBase(key)
  if (typeof window === 'undefined') return base
  try {
    const override = window.localStorage.getItem(`${STORAGE_PREFIX}${key}`)
    if (override === 'on') return true
    if (override === 'off') return false
  } catch {
    /* localStorage 접근 불가(SSR/프라이버시 모드) → base 사용 */
  }
  return base
}

/** 개발/파일럿용 클라이언트 오버라이드 설정. value=null 이면 오버라이드 해제(환경변수 기본값으로 복귀). */
export function setGpuFlagOverride(key: GpuFlagKey, value: 'on' | 'off' | null): void {
  if (typeof window === 'undefined') return
  try {
    if (value === null) window.localStorage.removeItem(`${STORAGE_PREFIX}${key}`)
    else window.localStorage.setItem(`${STORAGE_PREFIX}${key}`, value)
  } catch {
    /* noop */
  }
}
