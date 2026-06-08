// 디자인 테마 레지스트리 (단일 소스). 새 테마 = 이 배열 1줄 + globals.css [data-theme="id"] 블록 추가.
export const THEMES = [
  { id: 'nb', label: 'Neo-brutalism', desc: '하드 잉크 보더·오프셋 그림자·노랑/퍼플·테이프 라벨' },
  { id: 'classic', label: '기존 (인디고)', desc: '부드러운 카드·연회색 보더·둥근 모서리·인디고' },
] as const

export type ThemeId = (typeof THEMES)[number]['id']
export const THEME_IDS = THEMES.map((t) => t.id) as ThemeId[]
export const DEFAULT_THEME: ThemeId = 'nb'

export function isThemeId(v: unknown): v is ThemeId {
  return typeof v === 'string' && (THEME_IDS as string[]).includes(v)
}
