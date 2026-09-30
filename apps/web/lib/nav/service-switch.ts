/**
 * 서비스에서 서비스로 — **계정 메뉴가 그릴 목록**
 *
 * ## 왜 생겼나
 *
 * 사용자 지적(2026-09-30): *"각 서비스에서 계정 메뉴에서 다른 서비스로 이동할 수 있도록
 * 구현되어 있는걸로 알고 있었는데?"*
 *
 * 실측하니 **어느 서비스에도 없었다.** 하위 서비스에 들어가면 사이드바가 통째로 그 서비스
 * 것으로 바뀌므로 다른 서비스 이름은 화면 어디에도 안 남는다. 길은 둘뿐이었다 —
 * 사이드바 하단 「업무로 나가기」로 `/home` 에 나갔다가 「서비스」 묶음에서 다시 들어가거나
 * (두 걸음), 상단 「전체 메뉴」를 여는 것. **옆으로 가는 길이 없었다.**
 *
 * 나가는 문(N-2)과 **목적지가 다르다.** 그건 집(`/home`)으로 가고 이건 옆(다른 서비스)으로
 * 간다. 같은 곳으로 가는 문이 둘이면 다른 곳으로 읽히지만, 다른 곳으로 가는 문이 하나도
 * 없으면 그 길은 없는 것이다.
 *
 * ## 왜 화면이 아니라 여기인가
 *
 * 목록을 계정 메뉴 안에서 만들면 그게 **손목록**이 된다. 서비스를 하나 더 만들 때
 * 사이드바 묶음·전체 메뉴는 표에서 나오는데 이 목록만 안 따라오고, 그건 이 시스템이
 * 이미 두 번 겪은 일이다(콘텐츠 인텔리전스·AI 트레이딩).
 *
 * 그리고 가드가 **값이 가는지**를 물으려면 부를 수 있는 함수여야 한다. 소스 글자를 보는
 * 가드는 `SERVICE_NAV` 를 import 만 해 두고 화면은 손목록을 그려도 통과한다.
 */

import { SERVICE_NAV } from './menu.ts'
import { serviceOf, surfaceOf } from './surface.ts'

export interface ServiceSwitchLink {
  href: string
  label: string
  /** 지금 보고 있는 서비스. 지우지 않고 **표시**한다 — 빠지면 내가 어디 있는지 안 보인다 */
  current: boolean
}

/** 계정 메뉴에서 이 묶음을 부르는 이름. 화면이 직접 적지 않는다 */
export const SERVICE_SWITCH_LABEL = '다른 서비스로'

/**
 * 지금 자리에서 계정 메뉴가 보여 줄 서비스 목록.
 *
 * **빈 배열이면 그 묶음을 안 그린다.** 세 경우다.
 *
 * ① 업무 워크스페이스(`member`)에 있을 때 — 거기 사이드바에는 「서비스」 묶음이 이미 있다.
 *    한 화면에 같은 곳으로 가는 문을 둘 두지 않는다(N-1: 서비스는 한 자리에서 들어간다).
 * ② 열린 서비스가 **지금 것뿐**일 때 — 자기 자신만 든 목록은 고를 것이 없다.
 * ③ 접근권한이 다 닫혀 있을 때.
 *
 * @param pathname 지금 주소
 * @param isOpen   이 사람에게 그 주소가 열려 있나 (`useIsOpen()`)
 */
export function serviceSwitchLinks(
  pathname: string | null | undefined,
  isOpen: (href: string) => boolean,
): readonly ServiceSwitchLink[] {
  // 사이드바가 이미 서비스를 다 들고 있는 자리 — 여기서 또 그리면 문이 두 벌이다
  if (surfaceOf(pathname) === 'member') return []

  const here = serviceOf(pathname).key
  const links = SERVICE_NAV.filter((s) => isOpen(s.href)).map((s) => ({
    href: s.href,
    label: s.label,
    current: serviceOf(s.href).key === here,
  }))

  // 갈 곳이 없으면 묶음 자체가 소음이다
  return links.some((l) => !l.current) ? links : []
}
