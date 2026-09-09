// lib/ai-chat/nav/groups.ts — AI 스튜디오 사이드바의 유일한 구현(SSOT)
//
// ## 왜 생겼나 (실측 v0.7.715)
//
// AI 채팅은 화면 6개, 코드 2만 줄, 테이블 11개짜리 기능인데 **사이드바 한 줄**로 살고 있었다.
// 목록 심층분석으로 들어가는 문은 채팅 화면 안 링크 2곳이 전부라, 채팅을 열지 않으면
// 그 기능이 있는 줄도 몰랐다. 문서함은 그보다 한 단계 더 안쪽이었다.
//
// 그래서 영업 CRM·콘텐츠 인텔리전스와 같이 **서비스로 등록**하고 자기 사이드바를 준다.
// 이 파일은 그 메뉴의 한 벌이다 — 레이아웃과 화면이 **같은 표**를 읽어야 갈리지 않는다
// (`lib/crm/nav/groups.ts` 와 같은 이유).
//
// ## 여기 없는 것
//
// **아이콘은 여기 없다** — 표면마다 크기가 달라 화면이 정한다(`lib/nav/menu.ts` 와 같은 규칙).

export interface AiNavItem {
  href: string
  label: string
  /** 이 경로 아래에 있어도 이 자리가 켜져 있어야 한다 — 안 그러면 내가 어디 있는지 사라진다 */
  match?: string[]
}

export interface AiNavGroup {
  label: string
  items: AiNavItem[]
}

/**
 * 묶음 셋. 순서는 **하루에 여는 횟수**다.
 *
 * 「대화」가 먼저인 이유: 이 서비스를 여는 사람이 가장 자주 하는 일이 대화다.
 * 「분석」은 자료를 들고 왔을 때만 연다 — 매일은 아니지만 채팅 뒤에 숨겨 둘 것도 아니다.
 */
export const AI_NAV_GROUPS: readonly AiNavGroup[] = [
  {
    label: '대화',
    items: [
      // 대화 목록·공유 링크는 전부 이 화면의 갈래다
      { href: '/ai', label: '채팅', match: ['/ai/shared'] },
      { href: '/ai/projects', label: '프로젝트' },
    ],
  },
  {
    label: '분석',
    items: [
      // 문서함은 심층분석 화면의 탭이라 같은 자리가 켜진다
      { href: '/ai/analyze', label: '목록 심층분석' },
    ],
  },
] as const

/** 그 묶음 안의 어느 화면에 있어도 켜져 있어야 할 경로들 */
export function aiNavMatchPaths(item: AiNavItem): string[] {
  return [item.href, ...(item.match ?? [])]
}
