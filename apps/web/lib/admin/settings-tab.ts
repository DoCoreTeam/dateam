/**
 * 관리자 시스템 설정 카드의 분류 — 화면과 시험이 함께 읽는다
 *
 * **왜 따로 있나**: 관리자 설정만 공용 그릇(SettingsCards)을 안 쓰고 자기 탭 묶음을
 * 직접 그렸다. 설정 화면 넷 중 셋은 검색 한 칸이 있는데 여기만 없었고, 카드 위에
 * 섹션 제목이 한 겹 더 있어 찾는 단위가 화면마다 달랐다(사용자 지적 2026-09-22).
 *
 * 그릇으로 옮기면 「어느 카드가 어느 탭에 서는가」를 누군가 적어야 한다.
 * 화면 안에 적으면 카드를 더하는 사람이 분류를 안 적어도 화면이 그려지고,
 * 그 카드는 어느 탭에서도 안 보인다. 그래서 짝을 여기서 정하고 시험이 단정한다.
 *
 * 영업 CRM 의 `lib/crm/domain/settings-tab.ts` 와 같은 자리다.
 */

import { AI_PROVIDERS, type AiProviderSpec } from '@/lib/ai/provider-catalog'

export type AdminSettingsTabKey = 'branding' | 'ai' | 'integrations' | 'system'

export const ADMIN_SETTINGS_TAB: Record<AdminSettingsTabKey, { label: string }> = {
  branding: { label: '브랜딩' },
  ai: { label: 'AI 모델' },
  integrations: { label: '외부 연동' },
  system: { label: '시스템' },
}

/** 탭이 서는 순서 — 보이는 것부터 안쪽으로 간다 */
export const ADMIN_SETTINGS_TAB_ORDER: readonly AdminSettingsTabKey[] = [
  'branding', 'ai', 'integrations', 'system',
]

export interface AdminSettingsCardSpec {
  /** 카드 한 장의 이름. 부품 하나가 카드 여럿을 그리면 여기서 갈린다 */
  id: string
  /** 그 카드를 그리는 화면 부품 이름 그대로 — 무엇이 빠졌는지 시험이 이 이름으로 말한다 */
  component: string
  tab: AdminSettingsTabKey
  /** 카드에 뜨는 제목 그대로 (검색어가 여기에 걸린다) */
  title: string
  /** 제목에 없지만 사람이 그 말로 찾는 것 */
  keywords?: string[]
}

const BRANDING_CARDS: readonly AdminSettingsCardSpec[] = [
  { id: 'BrandingSettings', component: 'BrandingSettings', tab: 'branding', title: '브랜딩', keywords: ['로고', '회사 이름', '사이드바', '로그인 화면', '태그라인'] },
  { id: 'ThemeSettings', component: 'ThemeSettings', tab: 'branding', title: '디자인 테마', keywords: ['색', '테마', '모서리', '그림자'] },
]

/**
 * AI 공급자 카드는 **손으로 안 적는다.**
 *
 * 화면이 `AI_PROVIDERS` 를 훑어 카드를 그린다. 목록을 여기 또 적으면 공급자를 하나 더할 때
 * 두 곳을 고쳐야 하고, 한 곳만 고치면 그 카드는 그려지는데 검색에 안 걸리거나
 * 그 반대가 된다 — 어느 쪽이든 조용하다.
 */
export function deriveProviderCards(specs: readonly AiProviderSpec[]): AdminSettingsCardSpec[] {
  return specs.map((spec) => ({
    id: `AiProviderCard.${spec.id}`,
    component: 'AiProviderCard',
    tab: 'ai' as const,
    // AiProviderCard 가 그리는 제목과 같은 식이어야 한다. 다르면 보이는 이름으로 못 찾는다
    title: `${spec.label} API 키`,
    keywords: ['AI', '모델', '키', spec.id],
  }))
}

/** 공급자 카드 뒤에 서는 AI 탭 카드들 */
const AI_CARDS: readonly AdminSettingsCardSpec[] = [
  { id: 'AiProviderOrder', component: 'AiProviderOrder', tab: 'ai', title: '기본 공급자와 폴백 순서', keywords: ['우선순위', '폴백', '기본값', '순서'] },
  { id: 'TokenAlertSettings', component: 'TokenAlertSettings', tab: 'ai', title: 'AI 토큰 알림 임계치', keywords: ['사용량', '한도', '알림', '토큰'] },
]

const INTEGRATION_CARDS: readonly AdminSettingsCardSpec[] = [
  { id: 'YoutubeSettings', component: 'YoutubeSettings', tab: 'integrations', title: 'YouTube Data API 키', keywords: ['유튜브', '수집', '영상'] },
  { id: 'GoogleDriveSettings', component: 'GoogleDriveSettings', tab: 'integrations', title: 'Google Drive 연동', keywords: ['구글', '드라이브', '자료 보관', '파일'] },
  { id: 'KoraeximSettings', component: 'KoraeximSettings', tab: 'integrations', title: '한국수출입은행 API 키', keywords: ['환율', '수출입은행'] },
  { id: 'G2bSettings', component: 'G2bSettings', tab: 'integrations', title: '나라장터 서비스 키', keywords: ['조달청', '공고', 'RFP', 'g2b'] },
  { id: 'VercelSettings', component: 'VercelSettings', tab: 'integrations', title: 'Vercel 로그', keywords: ['배포', '서버 로그', '토큰'] },
]

const SYSTEM_CARDS: readonly AdminSettingsCardSpec[] = [
  { id: 'MfaPolicySettings', component: 'MfaPolicySettings', tab: 'system', title: '관리자 2단계 인증', keywords: ['보안', 'MFA', '로그인', '2단계'] },
  { id: 'DbSettings', component: 'DbSettings', tab: 'system', title: 'DB 연결 (PostgreSQL)', keywords: ['데이터베이스', '마이그레이션', '연결 문자열'] },
]

/** 손으로 적는 카드 열하나. 여기 없는 카드를 화면이 그리면 `settings-tab.test.ts` 가 잡는다 */
export const ADMIN_SETTINGS_CARDS_BY_HAND: readonly AdminSettingsCardSpec[] = [
  ...BRANDING_CARDS, ...AI_CARDS, ...INTEGRATION_CARDS, ...SYSTEM_CARDS,
]

/** 화면이 그리는 순서 그대로 — 공급자 카드가 AI 탭 맨 앞에 선다 */
export const ADMIN_SETTINGS_CARDS: readonly AdminSettingsCardSpec[] = [
  ...BRANDING_CARDS,
  ...deriveProviderCards(AI_PROVIDERS),
  ...AI_CARDS,
  ...INTEGRATION_CARDS,
  ...SYSTEM_CARDS,
]
