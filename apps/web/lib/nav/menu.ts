/**
 * 메뉴 — 어디로 들어가는가 (정책 §2-3-3 「길의 축」)
 *
 * ## 왜 표를 따로 두나
 *
 * 사이드바(`app/(member)/layout.tsx`)와 전체 메뉴(`components/ui/QuickNav.tsx`)가
 * **각자 목록을 들고 있었다.** 그래서 같은 경로가 두 이름이 됐다 —
 * `/lead-intake` 가 사이드바에선 「프로젝트관리」, 전체 메뉴에선 「리드 인테이크」였다
 * (그 화면은 실제로 리드 인테이크다. 프로젝트관리와 아무 관계가 없다).
 *
 * 두 벌이면 반드시 갈린다. 한 벌이면 갈릴 수 없다.
 *
 * ## 여기 없는 것
 *
 * **경로 판정은 여기서 안 한다** — `lib/nav/surface.ts` 의 `serviceOf` 하나뿐이다.
 * **아이콘도 여기 없다** — 아이콘은 표면마다 크기가 달라(16 vs 14) 화면이 정한다.
 * 여기 있는 것은 **이름과 주소**뿐이다.
 */

import { SERVICE_LABEL } from '../terms/index.ts'

/**
 * 경로 → 화면 이름. **사이드바와 전체 메뉴가 이걸 읽는다.**
 *
 * 서비스 간판(`SERVICE_LABEL`)과 다르다: 저건 «지금 어느 서비스인가»를 로고 자리에 거는 말이고,
 * 이건 «어디로 가는 링크인가»를 메뉴에 적는 말이다. 서비스로 들어가는 링크만 둘이 같다.
 */
export const NAV_LABEL: Record<string, string> = {
  '/home': '홈',
  '/work': '업무',
  '/calendar': '캘린더',
  '/meeting-notes': '회의노트',
  '/org': '조직도',
  '/ai-chat': 'AI 채팅',
  '/pricing/gpu': 'GPU 관리',
  '/pricing/catalog': '판매가격표',
  '/api-keys': 'API Keys',

  // 서비스로 들어가는 링크 — 간판과 같은 말을 쓴다
  '/crm': SERVICE_LABEL.crm,
  '/ci': SERVICE_LABEL.ci,
  '/develop': SERVICE_LABEL.develop,

  /**
   * 구 영업 묶음 — `ProjectTabs` 가 넷을 한 화면에서 오가게 묶는다.
   * CRM(회사·인물·딜)과 개념이 겹쳐서 **사이드바에서는 내렸고 전체 메뉴에만 남긴다.**
   * 없애는 결정은 데이터(거래처 12 · 담당자 1 · 영업기회 1)가 걸려 있어 따로 본다.
   */
  '/lead-intake': '리드 인테이크',
  '/accounts': '거래처',
  '/contacts': '담당자',
  '/deals': '영업기회',

  // 일일업무·주간보고는 「업무」 안에 있지만 전체 메뉴는 바로 가는 길을 준다
  '/daily': '일일업무',
  '/weekly-report': '주간보고',
}

/** 이름을 못 찾으면 조용히 빈칸을 그리지 않는다 — 등재를 잊은 것이 드러나야 한다 */
export function navLabel(href: string): string {
  return NAV_LABEL[href] ?? href
}

/**
 * 「서비스」 그룹에 들어갈 하위 서비스 (N-1).
 *
 * 사이드바가 통째로 그 서비스 것으로 바뀌는 곳만 여기 온다.
 * 관리자·개발자센터는 **권한/외부**라 계정 메뉴와 전체 메뉴가 맡는다.
 */
export const SERVICE_NAV = [
  { href: '/crm', label: SERVICE_LABEL.crm },
  { href: '/ci', label: SERVICE_LABEL.ci },
] as const

/** 「서비스」 그룹의 이름 — 화면이 직접 적지 않는다 */
export const SERVICE_GROUP_LABEL = '서비스'

/**
 * 하위 서비스에서 **나가는 문** (N-2).
 *
 * 예전엔 문이 두 자리에 있었고 문구가 셋이었다 — 「사내 업무로」(CI 사이드바) ·
 * 「홈으로 나가기」(계정 메뉴) · 「멤버 화면으로」(관리자). **셋 다 같은 곳으로 간다.**
 */
export const EXIT_TO_MAIN = { href: '/home', label: '업무로 나가기' } as const
