/**
 * 표면 등재부 — **어떤 화면이 있는가**의 유일한 목록
 *
 * ## 왜 생겼나
 *
 * 지금 «누가 무엇을 보는가»가 세 곳에 흩어져 있다.
 *   · `lib/nav/menu.ts` 의 `NAV_AUDIENCE` — 항목 하나를 메뉴에서 숨길지
 *   · 같은 파일의 `ADMIN_ONLY_GROUPS` — 묶음 하나를 통째로 숨길지
 *   · 각 라우트의 `requireAdmin()` 류 — 실제로 막을지
 *
 * 셋이 서로를 모른다. 그래서 **메뉴에는 보이는데 들어가면 막히는 문**이 생겼다
 * (실측 2026-09-21: `/accounts`·`/contacts`·`/deals`·`/lead-intake` 넷이
 * 전체 메뉴에는 그려지는데 라우트는 관리자만 들여보냈다).
 *
 * 여기는 그 셋이 읽을 **한 벌**이다. 이 판(I02)에서는 목록과 기본값만 세우고,
 * 메뉴 생성은 I04, 실제 차단은 I08 이 이 목록으로 옮겨 온다.
 *
 * ## 여기 없는 것
 *
 * **이름이 없다.** 경로 → 이름은 `lib/nav/menu.ts` 의 `NAV_LABEL` 이 이미 SSOT 다.
 * 두 벌을 두면 갈린다 — 그 사고를 막으려고 만든 표를 또 복사할 이유가 없다.
 */

/** 로그인한 사람 전부인가, 관리자만인가 */
export type Audience = 'all' | 'admin'

/**
 * 사이드바 묶음 키. `ADMIN_ONLY_GROUPS` 가 키로 판정하므로 **키가 맞아야** 한다.
 * 묶음에 안 들어가는 표면은 `basic`.
 */
export type SurfaceGroupKey = 'basic' | 'service' | 'legacy-sales' | 'pricing' | 'standalone'

export interface Surface {
  /** 저장·부여에 쓰는 안정 키. 경로가 바뀌어도 이 값은 안 바뀐다 */
  key: string
  /** 들어가는 주소. 하위 경로는 전부 이 표면에 속한다 */
  href: string
  group: SurfaceGroupKey
  /** 부여가 하나도 없을 때의 답 */
  defaultAudience: Audience
  /**
   * 기본값이 메뉴 표보다 **엄한** 이유.
   *
   * 메뉴 표(`NAV_AUDIENCE`·`ADMIN_ONLY_GROUPS`)가 「전부」라고 말하는데 여기서
   * 「관리자」로 적는 자리는, 지금 라우트가 이미 막고 있는 자리다. 그 근거를 여기 적는다 —
   * 적지 않으면 `decide.test.ts` 가 실패한다. **메뉴 표보다 무른 기본값은 어떤 이유로도 못 적는다.**
   */
  gatedToday?: string
}

export const SURFACES: readonly Surface[] = [
  // 업무 워크스페이스 — 로그인한 사람의 기본 화면
  { key: 'home', href: '/home', group: 'basic', defaultAudience: 'all' },
  { key: 'work', href: '/work', group: 'basic', defaultAudience: 'all' },
  { key: 'daily', href: '/daily', group: 'basic', defaultAudience: 'all' },
  { key: 'dept-tasks', href: '/dept-tasks', group: 'basic', defaultAudience: 'all' },
  { key: 'weekly-report', href: '/weekly-report', group: 'basic', defaultAudience: 'all' },
  { key: 'calendar', href: '/calendar', group: 'basic', defaultAudience: 'all' },
  { key: 'meeting-notes', href: '/meeting-notes', group: 'basic', defaultAudience: 'all' },
  { key: 'org', href: '/org', group: 'basic', defaultAudience: 'all' },
  { key: 'routine', href: '/routine', group: 'basic', defaultAudience: 'all' },
  { key: 'kpi', href: '/kpi', group: 'basic', defaultAudience: 'all' },
  { key: 'api-keys', href: '/api-keys', group: 'basic', defaultAudience: 'all' },
  /**
   * 본부 소속만 들어간다(`isMemberOfDivisionByName`). 역할이 아니라 **소속**으로 가르므로
   * 여기서는 「전부」로 두고 소속 판정은 그 화면이 계속 맡는다 — 축이 다르다.
   */
  { key: 'operations', href: '/operations', group: 'basic', defaultAudience: 'all' },

  // 가격정책
  { key: 'pricing.gpu', href: '/pricing/gpu', group: 'pricing', defaultAudience: 'all' },
  { key: 'pricing.catalog', href: '/pricing/catalog', group: 'pricing', defaultAudience: 'all' },

  /**
   * 서비스 — 사이드바에서 `ADMIN_ONLY_GROUPS` 가 묶음째 관리자에게만 그린다.
   * 각 서비스 안의 멤버십(CRM 멤버·CI 워크스페이스)은 그 서비스 셸이 계속 본다 — 축이 다르다.
   */
  { key: 'crm', href: '/crm', group: 'service', defaultAudience: 'admin' },
  { key: 'ci', href: '/ci', group: 'service', defaultAudience: 'admin' },
  { key: 'ai', href: '/ai', group: 'service', defaultAudience: 'admin' },
  { key: 'rfp', href: '/rfp', group: 'service', defaultAudience: 'admin' },

  // 구 영업 — 메뉴는 열어 두고 라우트는 막던 자리(죽은 문). 기본값은 라우트 쪽 사실을 적는다
  {
    key: 'accounts', href: '/accounts', group: 'legacy-sales', defaultAudience: 'admin',
    gatedToday: 'app/(member)/accounts/layout.tsx 가 관리자만 들여보낸다',
  },
  {
    key: 'contacts', href: '/contacts', group: 'legacy-sales', defaultAudience: 'admin',
    gatedToday: 'app/(member)/contacts/layout.tsx 가 관리자만 들여보낸다',
  },
  {
    key: 'deals', href: '/deals', group: 'legacy-sales', defaultAudience: 'admin',
    gatedToday: 'app/(member)/deals/layout.tsx 가 관리자만 들여보낸다',
  },
  {
    key: 'lead-intake', href: '/lead-intake', group: 'legacy-sales', defaultAudience: 'admin',
    gatedToday: 'app/(member)/lead-intake/layout.tsx 가 관리자만 들여보낸다',
  },

  // 별도 표면
  {
    key: 'admin', href: '/admin', group: 'standalone', defaultAudience: 'admin',
    gatedToday: 'app/admin/layout.tsx 가 role !== admin 을 되돌린다',
  },
  { key: 'develop', href: '/develop', group: 'standalone', defaultAudience: 'all' },
  { key: 'security', href: '/security', group: 'standalone', defaultAudience: 'all' },
]

/**
 * **표면이 아닌 경로** — 등재를 잊은 것과 구분한다.
 *
 * `lib/policy/access-surface.test.ts` 가 `app` 아래 `page.tsx` 를 전수로 걸어
 * 표면에 안 붙는 경로를 찾는다. 그때 여기 없으면 실패한다. 사유 없이 넣을 수 없다 —
 * **사유를 적게 하는 것이 이 목록의 전부**다. 「일단 넣어 두고 나중에」가 안 되게.
 */
export const NOT_A_SURFACE: Readonly<Record<string, string>> = {
  '/': '루트는 로그인 여부를 보고 /home 이나 /login 으로 보내기만 한다',
  '/login': '로그인 화면, 로그인 전에 보는 자리라 접근권한을 걸 대상이 아니다',
  '/mfa': '2단계 인증 화면, 같은 이유로 로그인 전 자리다',
  '/change-password': '첫 로그인 비밀번호 변경, 로그인 직후 강제 경유라 막으면 들어올 길이 사라진다',
  '/offline': '네트워크가 끊겼을 때 서비스워커가 보여 주는 화면, 서버 판정이 닿지 않는다',
  '/api-access': '외부인이 API 사용을 신청하는 공개 양식, 사내 사용자 기준으로 막을 대상이 아니다',
  '/intake': '/pricing/gpu?tab=intake 로 보내기만 하는 옛 주소, 도착지 표면이 판정한다',
  '/ralph': '/pricing/gpu 로 보내기만 하는 옛 주소, 도착지 표면이 판정한다',
}

const BY_KEY = new Map(SURFACES.map((s) => [s.key, s]))

export function surfaceByKey(key: string): Surface | null {
  return BY_KEY.get(key) ?? null
}

/**
 * 주소가 어느 표면인가. `/pricing/gpu` 와 `/pricing/catalog` 처럼 **긴 쪽이 이긴다**.
 * 등재 안 된 주소는 `null` — 부르는 쪽이 「모르는 자리」를 알아볼 수 있어야 한다.
 */
export function surfaceOf(pathname: string): Surface | null {
  let best: Surface | null = null
  for (const s of SURFACES) {
    if (pathname !== s.href && !pathname.startsWith(s.href + '/')) continue
    if (!best || s.href.length > best.href.length) best = s
  }
  return best
}
