/**
 * 영업 CRM 설정 카드의 분류 — 화면과 시험이 함께 읽는다
 *
 * **왜 따로 있나**: 카드가 열두 장인데 화면이 순서대로 늘어놓기만 했다.
 * 무엇을 고치러 왔든 열두 장을 다 지나가야 했고, 카드가 하나 늘 때마다 그 길이 길어졌다.
 * 분류를 화면 안에 적으면 카드를 더하는 사람이 분류를 안 적어도 화면이 그려진다 —
 * 그러면 그 카드는 어느 탭에서도 안 보인다. 그래서 짝을 여기서 정하고 시험이 단정한다.
 *
 * 이웃한 `setting-group.ts` 와 같은 자리다 — 말과 순서는 화면이 정하지 않는다.
 */

export type CrmSettingsTabKey = 'pipeline' | 'quote' | 'ai' | 'data'

export const CRM_SETTINGS_TAB: Record<CrmSettingsTabKey, { label: string }> = {
  pipeline: { label: '영업 단계' },
  quote: { label: '견적' },
  ai: { label: 'AI·자동화' },
  data: { label: '연동·데이터' },
}

/** 탭이 서는 순서 — 딜을 만들고 견적을 내고 그다음이 자동화와 데이터다 */
export const CRM_SETTINGS_TAB_ORDER: readonly CrmSettingsTabKey[] = ['pipeline', 'quote', 'ai', 'data']

export interface CrmSettingsCardSpec {
  /** 카드 한 장의 이름. 부품 하나가 카드 둘을 그리면 여기서 둘로 갈린다 */
  id: string
  /** 그 카드를 그리는 화면 부품 이름 그대로 — 어느 부품이 빠졌는지 시험이 이 이름으로 말한다 */
  component: string
  tab: CrmSettingsTabKey
  /** 카드에 뜨는 제목 그대로 (검색어가 여기에 걸린다) */
  title: string
  /** 제목에 없지만 사람이 그 말로 찾는 것 */
  keywords?: string[]
}

/**
 * 카드 열네 장을 부품 열둘이 그린다 (`SettingsCard` 하나가 세 장을 그린다).
 * 하나가 늘면 여기 한 줄을 더한다 — 안 더하면 `settings-tab.test.ts` 가
 * 화면과 이 목록의 수가 다르다고 말한다.
 */
export const CRM_SETTINGS_CARDS: readonly CrmSettingsCardSpec[] = [
  { id: 'PipelineCard', component: 'PipelineCard', tab: 'pipeline', title: '파이프라인', keywords: ['영업 단계', '스테이지', '딜'] },
  { id: 'BusinessTypeCard', component: 'BusinessTypeCard', tab: 'pipeline', title: '사업 유형', keywords: ['업종', '딜'] },
  { id: 'SettingsCard.quote', component: 'SettingsCard', tab: 'quote', title: '견적서 공급자 정보', keywords: ['공급자', '사업자', '직인', '로고', '견적서 번호'] },
  { id: 'QuoteTermsCard', component: 'QuoteTermsCard', tab: 'quote', title: '거래 조건', keywords: ['견적', '납기', '결제', '유효기간'] },
  { id: 'SettingsCard.quoteImport', component: 'SettingsCard', tab: 'quote', title: '견적서 파일 읽기', keywords: ['파일로 가져오기', '구성', '상한', '원본 조각', '대조'] },
  { id: 'BudgetCard', component: 'BudgetCard', tab: 'ai', title: 'AI 예산', keywords: ['한도', '비용', '토큰'] },
  { id: 'SettingsCard.ai', component: 'SettingsCard', tab: 'ai', title: 'AI·연동 설정', keywords: ['AI 키', '모델', '연동'] },
  { id: 'AutoApplyCard', component: 'AutoApplyCard', tab: 'ai', title: 'AI 자동 반영', keywords: ['신뢰도', '자동', '제안'] },
  { id: 'AutomationCard', component: 'AutomationCard', tab: 'ai', title: '자동화', keywords: ['규칙', '알림'] },
  { id: 'IntegrationCard', component: 'IntegrationCard', tab: 'data', title: '메일·일정 연동', keywords: ['지메일', '캘린더', '구글'] },
  { id: 'DataCheckCard', component: 'DataCheckCard', tab: 'data', title: '데이터 점검', keywords: ['품질', '빈 값', '손볼 것'] },
  { id: 'DuplicatesCard', component: 'DuplicatesCard', tab: 'data', title: '중복 정리', keywords: ['합치기', '같은 회사', '같은 사람'] },
  { id: 'ImportCard', component: 'ImportCard', tab: 'data', title: '엑셀에서 들여오기', keywords: ['가져오기', 'csv', '업로드'] },
  { id: 'ExportCard', component: 'ExportCard', tab: 'data', title: '엑셀로 내려받기', keywords: ['내보내기', 'csv', '다운로드'] },
]
