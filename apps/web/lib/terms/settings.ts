// 설정 화면의 말 (SSOT)
//
// 왜 여기인가: 설정 화면이 넷인데(콘텐츠 인텔리전스·관리자·영업 CRM·RFP)
// 검색 칸 라벨과 안내 문구를 화면마다 자기가 적으면 같은 칸이 네 가지 말이 된다.
// 「연결됨」이 화면마다 갈렸던 것과 같은 자리다(lib/terms/connection.ts).
//
// 그릇 부품(components/ui/settings/SettingsPanel)이 이 상수만 읽는다.

/** 설정 화면 그릇의 말 */
export const SETTINGS = {
  /** 검색 칸 라벨 */
  searchLabel: '설정 검색',
  /**
   * 검색 칸 안내.
   * 탭과 무관하다는 사실을 여기서 말한다 — 어느 탭에 있는지 모를 때가 검색을 쓰는 때다.
   */
  searchPlaceholder: '설정 이름이나 설명으로 찾기 (탭 상관없이 전체에서)',
  /** 분류 탭 묶음의 이름. 읽어 주는 기계가 이 말로 탭 묶음을 부른다 */
  tabsLabel: '설정 분류',
  /** 검색 결과가 없을 때 */
  noMatchTitle: '찾는 설정이 안 보여요',
  noMatchHint: '다른 낱말로 찾아보세요. 검색은 탭과 상관없이 전체 설정에서 찾습니다.',
  /** 고른 분류에 설정이 없을 때 */
  emptyGroupTitle: '이 분류에는 설정이 없어요',
  emptyGroupHint: '위 탭에서 다른 분류를 골라 보세요.',
} as const
