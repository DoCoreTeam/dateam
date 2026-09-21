import 'server-only'

/**
 * 문을 여닫는 **한 자리** — 숨기는 쪽과 막는 쪽이 여기서 만난다
 *
 * ## 왜 필요한가
 *
 * 판정(`decide.ts`)과 부여 읽기(`load.ts`)는 이미 있었는데, 그 둘을 **주소 하나**로
 * 부르는 자리가 없었다. 그래서 메뉴는 `canSeeNav`(표 하나)를 보고 라우트는 `requireAdmin`
 * 을 봤다 — 같은 화면에 대해 두 함수가 각자 답했고, 답이 갈린 결과가
 * 「메뉴에는 보이는데 들어가면 막히는 문」 넷이었다(실측 2026-09-21).
 *
 * 이제 둘 다 여기를 부른다. **메뉴에서 안 보이면 주소를 쳐도 안 열리고, 열린 것은 메뉴에 뜬다.**
 *
 * ## 왕복은 한 번이다
 *
 * `loadViewerAccess` 가 `cache()` 로 싸여 있어 한 요청 안에서는 한 번만 돈다.
 * 메뉴 스무 줄을 각각 물어도 질의는 늘지 않는다 — 그러니 부르는 쪽이 아껴 부르려고
 * 자기 목록을 따로 들 이유가 없다. 목록을 따로 드는 순간 그것이 두 벌째가 된다.
 *
 * ## 모르는 주소는 막는다
 *
 * 등재부에 없는 주소는 `decideAccess` 가 `unregistered` 로 막는다(관리자는 통과).
 * 열어 두면 화면을 새로 만들고 등재를 잊은 순간 **아무 표시 없이 전부에게 열린다.**
 */

import { decideAccess, type Decision } from './decide.ts'
import { loadViewerAccess } from './load.ts'
import { surfaceOf } from './surfaces.ts'
import { navLabel } from '../nav/menu.ts'

/** 로그인 안 한 요청의 답. 화면은 그 전에 이미 로그인으로 보내지만, 여기서도 닫아 둔다 */
const NO_VIEWER: Decision = { allowed: false, reason: 'unregistered' }

/**
 * 이 주소가 어느 표면인지 찾아 판정한다.
 *
 * 표면을 못 찾으면 **주소를 그대로 키로 넘긴다** — 등재부에 없는 키라
 * `decideAccess` 가 `unregistered` 로 막고, 그 사실이 사유에 남는다.
 */
export async function decideHref(href: string): Promise<Decision> {
  const access = await loadViewerAccess()
  if (!access) return NO_VIEWER
  return decideAccess(surfaceOf(href)?.key ?? href, access.viewer, access.grants)
}

export async function canOpen(href: string): Promise<boolean> {
  return (await decideHref(href)).allowed
}

/**
 * 메뉴가 쓰는 꼴 — 주소 여럿을 한 번에 걸러 **열린 것만** 돌려준다.
 *
 * 집합으로 주는 이유: 사이드바는 묶음 안에서, 전체 메뉴는 절 안에서 각각 거르는데
 * 두 곳이 같은 답을 봐야 한다. 각자 `canOpen` 을 부르면 답은 같지만
 * **거르는 규칙**이 두 벌이 된다.
 */
export async function openSurfaces(hrefs: readonly string[]): Promise<Set<string>> {
  const access = await loadViewerAccess()
  if (!access) return new Set()
  const open = new Set<string>()
  for (const href of hrefs) {
    const key = surfaceOf(href)?.key ?? href
    if (decideAccess(key, access.viewer, access.grants).allowed) open.add(href)
  }
  return open
}

/**
 * 지금 요청이 닿은 화면을 막아야 하나 — **레이아웃 하나가 (member) 전부를 지킨다.**
 *
 * ## 왜 화면마다가 아니라 여기인가
 *
 * 화면마다 적게 하면 **새 화면을 만든 사람이 기억해야 한다.** 기억해야 하는 규칙은
 * 반드시 빠뜨린다 — 그리고 빠뜨린 자리는 조용히 열려 있다. 실측 2026-09-21: 부여로
 * `/pricing/gpu` 를 막았더니 메뉴에서는 사라졌는데 **주소를 치면 그대로 열렸다.**
 * 「숨긴 것이 막힌 것과 같다」가 아니면 숨기는 기능은 권한이 아니라 정리 도구일 뿐이다.
 *
 * ## 표면이 아닌 자리는 지나간다
 *
 * `/intake`·`/ralph` 처럼 `NOT_A_SURFACE` 에 사유와 함께 적힌 자리는 표면이 아니다.
 * 여기서 막으면 그 자리가 통째로 사라진다. 등재를 **잊은** 새 화면은 이 길로 새지 않는다 —
 * `lib/policy/access-surface.test.ts` 가 커밋 전에 잡기 때문이다.
 *
 * 주소는 미들웨어가 `x-pathname` 으로 실어 보낸다(`middleware.ts`). 서버 컴포넌트는
 * 자기 주소를 직접 못 읽는다.
 *
 * @returns 막아야 하면 그 화면의 이름, 아니면 `null`
 */
export async function deniedSurfaceName(pathname: string | null): Promise<string | null> {
  if (!pathname) return null
  const surface = surfaceOf(pathname)
  if (!surface) return null
  const access = await loadViewerAccess()
  if (!access) return null
  if (decideAccess(surface.key, access.viewer, access.grants).allowed) return null
  return navLabel(surface.href)
}
