/**
 * 지금 어느 표면에 있나 — 계정 메뉴가 무엇을 보여 줄지 정하는 SSOT
 *
 * ## 왜 생겼나
 *
 * 사용자 지적(2026-08-24): *"CRM에서는 멤버화면 가는 메뉴가 안나오면 되겠니?"*
 *
 * 계정 메뉴는 위치를 딱 한 줄로 판정했다 — `pathname.startsWith('/admin')`.
 * 그래서 CRM(`/crm`)과 콘텐츠 인텔리전스(`/ci`)에서는 `false` 가 되어
 * **밖으로 나가는 문이 아니라 더 안쪽(관리자 패널)으로 들어가는 문**이 떴다.
 * 게다가 그 항목은 관리자에게만 보이므로, **일반 멤버는 계정 메뉴에서 나갈 길이 0개**였다.
 *
 * 나갈 길 자체는 있었다(상단 `전체 메뉴`, `Cmd+K` 팔레트). 다만 사람이 찾는 자리에 없었다.
 *
 * ## 왜 파일로 빼나
 *
 * 셸이 넷((member)·admin·(crm)·(ci))이고, 판정을 컴포넌트 안에 인라인으로 두면
 * 표면을 하나 더 만들 때 또 한 곳이 빠진다. 실제로 그렇게 빠졌다.
 */

import { SERVICE_LABEL, type ServiceKey } from '../terms/index.ts'

/**
 * 경로 → 서비스. **경로 표는 여기 한 곳뿐이다.**
 *
 * `surfaceOf`(아래)는 이 표에서 유도한다 — 두 함수가 각자 경로를 판정하면
 * 서비스를 하나 더 만들 때 한쪽만 고쳐지고, 그게 이 파일이 생긴 이유다.
 *
 * 순서가 규칙이다: 위에서부터 먼저 맞는 것을 쓴다.
 */
const SERVICE_ROUTES: { key: ServiceKey; prefixes: string[] }[] = [
  { key: 'admin', prefixes: ['/admin'] },
  { key: 'crm', prefixes: ['/crm'] },
  { key: 'ci', prefixes: ['/ci'] },
  { key: 'ai', prefixes: ['/ai'] },
  { key: 'rfp', prefixes: ['/rfp'] },
  { key: 'trading', prefixes: ['/trading'] },
  // 셸 밖 공개 화면 — 로그인 없이 외부인이 본다
  { key: 'develop', prefixes: ['/develop', '/api-access'] },
]

export interface Service {
  key: ServiceKey
  /** 로고 자리에 거는 간판 */
  label: string
  /** 그 서비스의 첫 화면 */
  home: string
}

/**
 * 서비스별 첫 화면. `serviceOf().home` 이 이걸 돌려준다.
 *
 * **왜 export 하나**: 가드가 «모든 서비스에 나가는 문이 있나»를 물으려면 서비스마다
 * 경로 하나가 필요하다. 테스트가 경로를 따로 적으면 그게 또 하나의 손목록이 되고,
 * 이 파일이 막으려던 것이 테스트 쪽에서 되살아난다(lib/nav/surface.test.ts).
 */
export const SERVICE_HOME: Record<ServiceKey, string> = {
  member: '/home',
  crm: '/crm',
  ci: '/ci',
  ai: '/ai',
  rfp: '/rfp',
  trading: '/trading',
  admin: '/admin/users',
  develop: '/develop',
}

/** 경계를 본다 — `/crm` 은 CRM 이지만 `/crmx` 는 아니다 */
function hits(p: string, prefix: string): boolean {
  return p === prefix || p.startsWith(`${prefix}/`)
}

/**
 * 지금 어느 **서비스**인가 — 셸의 로고 자리가 이걸로 간판을 건다.
 *
 * **왜 `surfaceOf` 로 부족한가**: 그건 "나갈 문이 필요한가"를 묻느라 CRM 과 CI 를
 * 똑같이 `sub` 로 뭉갠다. 로고 자리는 **둘을 구분해야** 한다 — 사용자가 보는 것은
 * "하위 표면"이 아니라 「영업 CRM」이거나 「콘텐츠 인텔리전스」다.
 */
export function serviceOf(pathname: string | null | undefined): Service {
  const p = pathname ?? ''
  const hit = SERVICE_ROUTES.find((s) => s.prefixes.some((x) => hits(p, x)))
  const key: ServiceKey = hit?.key ?? 'member'
  return { key, label: SERVICE_LABEL[key], home: SERVICE_HOME[key] }
}

export type Surface = 'admin' | 'sub' | 'member'

/**
 * 나가는 문이 **필요 없는** 서비스. 여기 없는 것은 전부 `sub` 다.
 *
 * 예전에는 반대로 적었다 — `crm | ci | ai` 를 손으로 나열하고 나머지를 `member` 로 뒀다.
 * 그래서 RFP 분석기(`/rfp`)를 만들었을 때 이 줄에 더하는 것을 잊었고, 거기서는
 * 나가는 문이 **아예 안 그려졌다**(`ShellExit` 은 `surface === 'member'` 면 null 이다).
 * 이 파일은 «표면을 하나 더 만들 때 한 곳이 빠진다»를 막으려고 생겼는데,
 * 정작 자기 안에 같은 손목록을 하나 더 들고 있었다.
 *
 * 그래서 뒤집는다: **빠뜨리면 문이 사라지는 쪽이 아니라, 빠뜨리면 문이 생기는 쪽으로.**
 * 새 서비스는 `SERVICE_ROUTES` 에 한 줄만 더하면 문이 따라온다.
 */
const NO_EXIT_SERVICES = new Set<ServiceKey>([
  // 여기가 집이다 — 나갈 곳이 없다
  'member',
  // 나가는 문은 있지만 문구가 다르다(「멤버 화면으로」) — surfaceOf 가 따로 돌려준다
  'admin',
  // 셸 자체가 없는 공개 화면이라 문을 걸 자리가 없다(lib/ui/shell-contract.test.ts 의 PublicSurface)
  'develop',
])

export function surfaceOf(pathname: string | null | undefined): Surface {
  // 경로 판정은 serviceOf 한 곳에서만 한다
  const { key } = serviceOf(pathname)
  if (key === 'admin') return 'admin'
  // 사이드바가 통째로 그 서비스 것으로 바뀌는 곳 — 나갈 문이 따로 있어야 한다
  return NO_EXIT_SERVICES.has(key) ? 'member' : 'sub'
}

export interface ExitLink {
  href: string
  label: string
}

/**
 * 계정 메뉴에 넣을 **나가는 문**. 없으면 `null`.
 *
 * 관리자 패널로 **들어가는** 링크는 이 함수가 다루지 않는다 — 그건 나가는 문이 아니고,
 * 관리자에게만 보이는 별개 항목이다. 둘을 한 자리에서 계산하면
 * "관리자가 아니면 나갈 길도 없다"는 지금의 결함이 그대로 남는다.
 */
export function exitLinkFor(surface: Surface): ExitLink | null {
  switch (surface) {
    case 'admin':
      return { href: '/home', label: '멤버 화면으로' }
    case 'sub':
      // 하위 서비스는 사이드바가 통째로 바뀌므로 홈으로 돌아갈 문이 반드시 필요하다
      return { href: '/home', label: '홈으로 나가기' }
    default:
      // 이미 멤버 화면이다 — 나갈 곳이 없다
      return null
  }
}

/** 관리자 패널로 **들어가는** 문. 관리자이고, 지금 거기가 아닐 때만 */
export function adminEntryFor(surface: Surface, isAdmin: boolean): ExitLink | null {
  if (!isAdmin || surface === 'admin') return null
  return { href: '/admin/users', label: '관리자 패널' }
}
