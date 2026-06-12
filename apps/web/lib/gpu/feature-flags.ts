// GPU 가격관리 리팩토링 — feature flag (병존·무중단·즉시 롤백)
//
// 통합 표/통합 입력 신규 UX를 기존 탭과 병존시키기 위한 플래그.
// 기본 OFF — 환경변수로 켜고, 개발 중에는 localStorage로 개별 오버라이드.
//   - 빌드/배포 기본값: NEXT_PUBLIC_GPU_UNIFIED ('1'|'true' 면 ON)
//   - 클라이언트 오버라이드(개발/파일럿): localStorage['gpu:flag:unified'] = 'on'|'off'
// flag OFF → 기존 10탭 그대로(롤백 무비용).

export type GpuFlagKey = 'unified'

const ENV_MAP: Record<GpuFlagKey, string | undefined> = {
  unified: process.env.NEXT_PUBLIC_GPU_UNIFIED,
}

const STORAGE_PREFIX = 'gpu:flag:'

function envOn(value: string | undefined): boolean {
  return value === '1' || value === 'true'
}

/**
 * 플래그 ON 여부. 서버/클라이언트 공통 — 클라이언트에서는 localStorage 오버라이드가 환경변수보다 우선.
 */
export function isGpuFlagOn(key: GpuFlagKey): boolean {
  const base = envOn(ENV_MAP[key])
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
