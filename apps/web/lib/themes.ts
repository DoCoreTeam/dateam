// 디자인 테마 레지스트리 (단일 소스). 새 테마 = 이 배열 1줄 + globals.css [data-theme="id"] 블록 추가.
export const THEMES = [
  { id: 'nb', label: 'Neo-brutalism', desc: '하드 잉크 보더·오프셋 그림자·노랑/퍼플·테이프 라벨' },
  { id: 'classic', label: '기존 (인디고)', desc: '부드러운 카드·연회색 보더·둥근 모서리·인디고' },
  { id: 'mono', label: 'Monochrome', desc: '흑백·직각·hairline 보더·플랫·레드 액센트·다크 사이드바' },
] as const

export type ThemeId = (typeof THEMES)[number]['id']
export const THEME_IDS = THEMES.map((t) => t.id) as ThemeId[]
export const DEFAULT_THEME: ThemeId = 'nb'

export function isThemeId(v: unknown): v is ThemeId {
  return typeof v === 'string' && (THEME_IDS as string[]).includes(v)
}

/**
 * 개인 선택 테마 우선, 없으면 전역 디폴트로 폴백 (순수함수 — 테스트 대상).
 * 무효값(레지스트리에서 제거된 stale id 등)은 디폴트로 폴백.
 * 의존성 없는 레지스트리 모듈에 위치 → node:test 단독 임포트 가능.
 */
export const resolveTheme = (
  userPref: string | null | undefined,
  globalDefault: ThemeId,
): ThemeId => (isThemeId(userPref) ? userPref : globalDefault)
