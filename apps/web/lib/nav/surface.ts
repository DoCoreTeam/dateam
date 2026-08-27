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

const SERVICE_HOME: Record<ServiceKey, string> = {
  member: '/home',
  crm: '/crm',
  ci: '/ci',
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

export function surfaceOf(pathname: string | null | undefined): Surface {
  // 경로 판정은 serviceOf 한 곳에서만 한다
  const { key } = serviceOf(pathname)
  if (key === 'admin') return 'admin'
  // 사이드바가 통째로 그 서비스 것으로 바뀌는 곳 — 나갈 문이 따로 있어야 한다
  if (key === 'crm' || key === 'ci') return 'sub'
  return 'member'
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
      // CRM·CI 는 사이드바가 통째로 바뀌므로 홈으로 돌아갈 문이 반드시 필요하다
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
