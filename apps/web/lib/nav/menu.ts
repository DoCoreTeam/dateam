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
   * 없애는 결정은 데이터(거래처 12건 · 인물 1건 · 딜 1건)가 걸려 있어 따로 본다.
   *
   * ⚠️ 이름은 **표준어로 적는다**(§0-2) — 예전엔 「담당자」·「영업기회」였다.
   * 같은 것을 화면마다 다르게 부르면 사용자는 CRM 의 「인물」과 여기의 「담당자」를
   * 다른 개체로 읽는다. **같은 개념이면 같은 말을 쓰고**, 어느 쪽 화면인지는
   * 묶음 이름(`LEGACY_SALES_GROUP_LABEL`)이 밝힌다.
   */
  '/lead-intake': '리드 인테이크',
  '/accounts': '거래처',
  '/contacts': '인물',
  '/deals': '딜',

  // 일일업무·주간보고는 「업무」 안에 있지만 전체 메뉴는 바로 가는 길을 준다
  '/daily': '일일업무',
  '/weekly-report': '주간보고',
}

/** 이름을 못 찾으면 조용히 빈칸을 그리지 않는다 — 등재를 잊은 것이 드러나야 한다 */
export function navLabel(href: string): string {
  return NAV_LABEL[href] ?? href
}

/**
 * 누가 이 링크를 보는가 — **메뉴 권한의 유일한 자리**.
 *
 * 예전엔 사이드바가 `그룹 이름 === '가격정책'` 으로 판정했다. 즉 **메뉴 이름을 바꾸면
 * 권한이 바뀌는 상태**였다(§2-3-3 N-3 이 "묶음과 권한을 같은 장치로 처리하지 말라"고
 * 정한 바로 그 패턴). 그리고 전체 메뉴(QuickNav)는 **누가 보는지 아예 받지 않아서**
 * 두 메뉴가 같은 경로에 다른 권한을 갖고 있었다.
 *
 * 여기 없는 경로는 `'all'` 이다 — **막는 것은 명시할 때만** 일어난다.
 * ⚠️ 이 표는 **메뉴에 그릴지**만 정한다. 실제 접근 차단은 각 라우트가 한다
 *    (숨기는 것과 막는 것은 다르다 — 주소는 직접 칠 수 있다).
 */
export type NavAudience = 'all' | 'admin'

export const NAV_AUDIENCE: Record<string, NavAudience> = {
  '/ai-chat': 'admin',
}

export function canSeeNav(href: string, isAdmin: boolean): boolean {
  return NAV_AUDIENCE[href] !== 'admin' || isAdmin
}

/** 그룹 통째로 관리자 전용인 묶음 — 이름이 아니라 **키**로 정한다 */
export const ADMIN_ONLY_GROUPS = new Set<string>(['service'])

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
 * 구 영업 묶음의 이름 — **이관 중이라는 사실을 여기서 밝힌다.**
 *
 * 항목 이름을 표준어(「인물」·「딜」)로 올리면 CRM 의 같은 이름과 글자가 겹친다.
 * 그건 정상이다 — **같은 개념이니 같은 말을 쓰는 것**이고, 둘을 가르는 것은
 * 「어느 화면인가」이지 「무엇인가」가 아니다. 그래서 구분은 묶음 이름이 진다.
 *
 * 예전 이름은 「프로젝트관리」였는데, 그 묶음에 든 넷 중 프로젝트는 하나도 없었다.
 */
export const LEGACY_SALES_GROUP_LABEL = '구 영업 (CRM 으로 이관 중)'

/**
 * 하위 서비스에서 **나가는 문** (N-2).
 *
 * 예전엔 문이 두 자리에 있었고 문구가 셋이었다 — 「사내 업무로」(CI 사이드바) ·
 * 「홈으로 나가기」(계정 메뉴) · 「멤버 화면으로」(관리자). **셋 다 같은 곳으로 간다.**
 */
export const EXIT_TO_MAIN = { href: '/home', label: '업무로 나가기' } as const
