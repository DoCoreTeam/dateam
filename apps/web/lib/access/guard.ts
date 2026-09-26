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
import { SURFACES, surfaceOf, zoneKey, zoneKeyOf, zoneOf } from './surfaces.ts'
import { vetoesAction, type AccessAction } from './actions.ts'
import { hasExtraGate, passesExtraGate, type ExtraGateContext } from './extra-gate.ts'
import { tradingOwnerUserId } from '../trading/access.ts'
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
  // 구역이 있으면 구역 키로 묻는다 — 구역 부여가 없으면 판정이 알아서 표면으로 내려간다
  return decideAccess(zoneKeyOf(href) ?? surfaceOf(href)?.key ?? href, access.viewer, access.grants)
}

export async function canOpen(href: string): Promise<boolean> {
  return (await decideHref(href)).allowed
}

/**
 * 추가 문이 쓰는 값을 모은다 — **필요할 때만 읽는다.**
 *
 * 표면 판정에서 이미 닫힌 사람에게는 부르지 않는다. 그래서 일반 사용자의 화면 전환에는
 * 왕복이 안 붙고, 통과한 사람(관리자·부여받은 사람)에게만 한 번 붙는다.
 * 그 한 번도 `cache()` 라 요청당 하나다.
 */
async function extraGateContext(): Promise<ExtraGateContext> {
  return { tradingOwnerUserId: await tradingOwnerUserId() }
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
  /** 통과한 것 중에 추가 문이 걸린 것이 있을 때만 값을 읽는다 */
  let extra: ExtraGateContext | null = null
  for (const href of hrefs) {
    const key = surfaceOf(href)?.key ?? href
    if (!decideAccess(key, access.viewer, access.grants).allowed) continue
    if (hasExtraGate(key)) {
      extra ??= await extraGateContext()
      if (!passesExtraGate(key, access.viewer, extra)) continue
    }
    open.add(href)
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

  /**
   * 구역 키로 묻는다. 구역 부여가 없으면 판정이 표면으로 내려가므로,
   * 구역을 안 건드린 경우의 답은 이 판 앞뒤로 같다.
   */
  const key = zoneKeyOf(pathname) ?? surface.key
  if (decideAccess(key, access.viewer, access.grants).allowed) return null

  /**
   * 막힌 자리의 이름을 말한다. 구역이 등재돼 있으면 **구역 이름**을 쓴다 —
   * 「업무에 접근할 권한이 없습니다」라고 하면 `/work` 는 열려 있는데도
   * 업무 전체가 막힌 줄로 읽힌다.
   */
  return zoneOf(key)?.zone.label ?? navLabel(surface.href)
}

/**
 * 이 자리에서 **이 동작까지** 되나 (I10).
 *
 * 창구가 부른다 — 화면이 아니라 창구다. 화면에서 단추를 숨기는 것은 편의이고,
 * 실제로 막는 자리는 값이 나가는 창구뿐이다. 주소를 알면 단추 없이도 부를 수 있다.
 *
 * 동작 부여가 하나도 없으면 **보기와 같은 답**이 나온다 — 판정이 좁은 키에서 넓은 키로
 * 내려가기 때문이다. 즉 이 함수를 붙여도 아무것도 안 바뀌고,
 * 바뀌는 것은 관리자가 차단을 적은 뒤부터다.
 */
export async function canDo(href: string, action: AccessAction): Promise<boolean> {
  const access = await loadViewerAccess()
  if (!access) return false
  // 관리자는 언제나 통과한다 — 잠그면 풀어 줄 사람이 사라진다(판정 1번과 같은 규칙)
  if (access.viewer.isAdmin) return true

  const surface = surfaceOf(href)
  if (!surface) return false
  const zone = zoneKeyOf(href)
  const bases = zone ? [zone, surface.key] : [surface.key]

  // **적힌 차단만** 본다. 아무 말도 없으면 통과 — 이 축은 거부권이라 새 문을 열지도 닫지도 않는다
  return !vetoesAction(action, bases, access.viewer, access.grants)
}

/** 값이 파일로 나가도 되나. 내보내기 창구가 부르는 이름 */
export async function canExport(href: string): Promise<boolean> {
  return canDo(href, 'export')
}

/** 값을 바꿔도 되나. 쓰기 창구가 부르는 이름 */
export async function canWrite(href: string): Promise<boolean> {
  return canDo(href, 'write')
}

/**
 * 표면과 등재된 자리 **전부**의 판정 — 셸이 한 번 재서 화면에 내려보낸다 (P0049 I01).
 *
 * **닫힌 것도 담는다.** 열린 것만 주면 `/work` 는 열려 있고 `/work/projects` 만 닫힌 경우를
 * 받는 쪽이 구분할 수 없다(앞자리가 걸려 열린 것으로 읽힌다). 「가장 긴 쪽이 이긴다」가
 * 성립하려면 닫힌 자리도 목록에 있어야 한다.
 *
 * 왕복은 안 는다 — `loadViewerAccess` 가 `cache()` 라 요청당 한 번이고, 아래는 순수 판정뿐이다.
 */
export async function openMap(): Promise<Record<string, boolean>> {
  const access = await loadViewerAccess()
  /**
   * 여기서는 미리 읽는다. 이 함수는 표면 **전부**를 재므로 추가 문이 걸린 표면을
   * 반드시 지나고, 지연해 읽어도 결국 한 번은 읽는다.
   */
  const extra = access ? await extraGateContext() : null
  const out: Record<string, boolean> = {}
  for (const s of SURFACES) {
    const allow = (key: string) => {
      if (!access || !extra) return false
      if (!decideAccess(key, access.viewer, access.grants).allowed) return false
      // 추가 문은 **닫기만 한다** — 표면 판정이 이미 닫은 것을 열지 않는다
      return passesExtraGate(key, access.viewer, extra)
    }
    out[s.href] = allow(s.key)
    for (const z of s.zones ?? []) {
      // 탭 자리는 주소가 표면과 같아 앞자리 맞추기로 못 가른다 — 경로 자리만 담는다
      if (z.tab) continue
      out[`${s.href}/${z.name}`] = allow(zoneKey(s.key, z.name))
    }
  }
  return out
}
