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
import { surfaceByKey, surfaceOf } from '../access/surfaces.ts'

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
  '/pricing/gpu': 'GPU 관리',
  '/pricing/catalog': '판매가격표',
  '/api-keys': 'API Keys',

  // 서비스로 들어가는 링크 — 간판과 같은 말을 쓴다
  '/crm': SERVICE_LABEL.crm,
  '/ci': SERVICE_LABEL.ci,
  '/ai': SERVICE_LABEL.ai,
  '/rfp': SERVICE_LABEL.rfp,
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

  /**
   * 메뉴 배치에는 없지만 **표면으로는 있는** 자리들.
   *
   * 배치에 없다고 이름이 없어도 되는 것이 아니다 — 접근권한 화면(`/admin/access`)은
   * 등재부 전부를 그리므로, 이름이 없으면 그 줄이 「/dept-tasks」처럼 **주소를 이름 자리에**
   * 그린다(실측 2026-09-21: 표면 25개 중 6개가 그랬다). 관리자는 그 줄이 무슨 화면인지
   * 주소를 읽어 짐작해야 하고, 짐작으로 문을 여닫게 된다.
   *
   * 이름은 그 화면이 이미 자기 제목으로 쓰는 말을 그대로 가져온다 — 여기서 새로 지으면
   * 같은 화면이 두 이름을 갖는다(N-4 가 막는 바로 그것).
   */
  '/admin': SERVICE_LABEL.admin,
  '/dept-tasks': '부서 업무',
  '/kpi': 'KPI 관리',
  '/operations': '본부 운영',
  '/routine': '루틴 체크',
  '/security': '보안',
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
  '/ai': 'admin',
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
  { href: '/ai', label: SERVICE_LABEL.ai },
  { href: '/rfp', label: SERVICE_LABEL.rfp },
] as const

export type ServiceHref = (typeof SERVICE_NAV)[number]['href']

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

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * 메뉴 배치 — **무엇이 어느 묶음에 서는가**
 *
 * 주소와 이름은 여기서 안 적는다. 배치는 **표면 키**만 가리키고,
 * 주소는 등재부(`lib/access/surfaces.ts`)가, 이름은 위의 `NAV_LABEL` 이 준다.
 *
 * 왜 이렇게 바꿨나 (실측 2026-09-21): 사이드바(`app/(member)/layout.tsx`)와
 * 전체 메뉴(`components/ui/QuickNav.tsx`)가 **각자 href 목록을 손으로 들고 있었다.**
 * 한 벌이던 것은 이름뿐이라, 화면을 새로 만들면 두 목록을 사람이 기억해서 고쳐야 했고
 * 그 목록에 없는 표면은 **있는 줄도 모르는 화면**이 됐다.
 * 이제 두 화면은 여기서 나온 목록을 그리기만 한다 — 그림(아이콘)만 화면이 정한다.
 */

/** 배치 한 줄. `surface` 는 등재부의 키다 */
export interface MenuEntry {
  surface: string
  /** 추가로 active 처리할 경로 (업무=/daily·/dept-tasks 에서도 강조) */
  match?: readonly string[]
  /** 새 창으로 여는 링크 */
  external?: boolean
}

/** 화면이 그대로 그릴 수 있는 꼴 */
export interface MenuLink {
  href: string
  label: string
  match?: string[]
  external?: boolean
}

export interface MenuSection<T> {
  /** 권한 판정이 보는 키. 이름이 바뀌어도 키는 안 바뀐다 */
  key?: string
  label: string
  items: readonly T[]
}

/** 배치 한 줄 → 링크. 등재 안 된 표면을 가리키면 **조용히 넘어가지 않는다** */
export function menuLink(entry: MenuEntry): MenuLink {
  const surface = surfaceByKey(entry.surface)
  if (!surface) throw new Error(`메뉴 배치가 등재 안 된 표면을 가리킨다: ${entry.surface}`)
  return {
    href: surface.href,
    label: navLabel(surface.href),
    ...(entry.match ? { match: [...entry.match] } : {}),
    ...(entry.external ? { external: true } : {}),
  }
}

/** 주소가 어느 표면인지 — 배치가 등재부와 어긋나면 바로 드러난다 */
function surfaceKeyOf(href: string): string {
  const surface = surfaceOf(href)
  if (!surface) throw new Error(`메뉴 배치의 주소가 등재부에 없다: ${href}`)
  return surface.key
}

/** 사이드바 맨 위 — 묶음 없이 서는 항목들 */
const SIDEBAR_TOP: readonly MenuEntry[] = [
  { surface: 'home' },
  { surface: 'work', match: ['/daily', '/dept-tasks', '/weekly-report', '/work'] },
  { surface: 'calendar' },
  { surface: 'meeting-notes' },
  { surface: 'org' },
]

/** 사이드바 묶음 — 「서비스」는 `SERVICE_NAV` 가 목록이고 여기서는 자리만 잡는다 */
const SIDEBAR_GROUPS: readonly MenuSection<MenuEntry>[] = [
  {
    key: 'service',
    label: SERVICE_GROUP_LABEL,
    items: SERVICE_NAV.map((s) => ({ surface: surfaceKeyOf(s.href), match: [s.href] })),
  },
  {
    key: 'pricing',
    label: '가격정책',
    items: [{ surface: 'pricing.gpu' }, { surface: 'pricing.catalog' }],
  },
]

/** 전체 메뉴 — 사이드바에서 내린 자리까지 전부 보이는 곳이라 묶음이 더 많다 */
const QUICKNAV_SECTIONS: readonly MenuSection<MenuEntry>[] = [
  {
    label: '기본',
    items: [{ surface: 'home' }, { surface: 'daily' }, { surface: 'calendar' }, { surface: 'weekly-report' }],
  },
  {
    /**
     * 사이드바의 「서비스」 묶음은 관리자에게만 보인다(`ADMIN_ONLY_GROUPS`).
     * CRM 멤버인 비관리자가 들어갈 길이 여기 말고 없어서 전체 메뉴에는 남긴다.
     */
    label: '영업',
    items: [{ surface: 'crm' }],
  },
  {
    // 이름이 CRM 과 겹치는 것은 정상이다 — 구분은 묶음이 진다(위 NAV_LABEL 주석)
    label: LEGACY_SALES_GROUP_LABEL,
    items: [{ surface: 'accounts' }, { surface: 'contacts' }, { surface: 'deals' }, { surface: 'lead-intake' }],
  },
  {
    label: '가격정책',
    items: [{ surface: 'pricing.gpu' }, { surface: 'pricing.catalog' }],
  },
  {
    // 사내 업무와 별개로 도는 독립 표면들
    label: '별도 서비스',
    items: [
      { surface: 'ci' }, { surface: 'ai' }, { surface: 'rfp' },
      { surface: 'api-keys' }, { surface: 'develop', external: true },
    ],
  },
]

function resolveSection(section: MenuSection<MenuEntry>): MenuSection<MenuLink> {
  return { ...section, items: section.items.map(menuLink) }
}

/** 화면이 읽는 것 — 여기부터는 주소와 이름이 박혀 있다 */
export const SIDEBAR_TOP_LINKS: readonly MenuLink[] = SIDEBAR_TOP.map(menuLink)
export const SIDEBAR_GROUP_LINKS: readonly MenuSection<MenuLink>[] = SIDEBAR_GROUPS.map(resolveSection)
export const QUICKNAV_LINKS: readonly MenuSection<MenuLink>[] = QUICKNAV_SECTIONS.map(resolveSection)

/** 두 메뉴에 한 번이라도 서는 표면의 주소 — 아이콘 가드가 이걸 센다 */
export function allMenuHrefs(sections: readonly MenuSection<MenuLink>[], top: readonly MenuLink[] = []): string[] {
  return [...new Set([...top, ...sections.flatMap((s) => s.items)].map((l) => l.href))]
}
