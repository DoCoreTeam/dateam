'use client'

/**
 * 열린 자리 — **셸이 한 번 재고, 화면은 읽기만 한다**
 *
 * ## 왜 컨텍스트인가
 *
 * 판정은 서버에서만 된다(부여를 읽어야 하므로). 그런데 닫힌 곳을 안 그려야 하는 자리는
 * 대부분 클라이언트 부품이다 — 탭바·위젯·바로가기. 그 사이를 props 로 이으면
 * **넘기는 것을 잊은 부품에 죽은 문이 남는다.** 실제로 그렇게 남았다:
 * P0046 이 사이드바와 전체 메뉴를 고쳤는데, 업무 탭바·구 영업 탭바·홈은
 * 여전히 손목록을 그려서 닫힌 화면으로 보내고 있었다(실측 2026-09-22).
 *
 * 컨텍스트면 **셸 아래 아무 데서나** 읽을 수 있다. 새 부품이 생겨도 배선이 없다.
 *
 * ## 안 감싸인 자리
 *
 * 값이 없으면 `isOpen` 은 **참**을 돌려준다. 셸 밖(로그인·개발자센터)에서 쓰는 부품까지
 * 조용히 비게 만들지 않기 위해서다 — 거기는 애초에 판정 대상이 아니다.
 * 셸 안인데 안 감싸이는 실수는 `lib/ui/cross-surface-nav.test.ts` 가 잡는다.
 */

import { createContext, useContext, type ReactNode } from 'react'

/** 주소 → 열렸나. **닫힌 것도 담는다** — 아래 이유를 본다 */
export type OpenMap = Readonly<Record<string, boolean>>

const OpenSurfaces = createContext<OpenMap | null>(null)

export function OpenSurfacesProvider({ value, children }: { value: OpenMap; children: ReactNode }) {
  return <OpenSurfaces.Provider value={value}>{children}</OpenSurfaces.Provider>
}

/**
 * 이 주소가 지금 이 사람에게 열려 있나.
 *
 * **왜 열린 것만 담으면 안 되나**: 자리가 표면 안에 있기 때문이다. `/work` 는 열려 있고
 * `/work/projects` 만 닫힌 상태에서, 열린 목록만 들고 앞자리 맞추기를 하면
 * `/work/projects` 가 `/work` 에 걸려 **열린 것으로 읽힌다.** 닫힌 것도 담아야
 * 「가장 긴 쪽이 이긴다」가 성립한다 — 판정 함수(`surfaceOf`)가 쓰는 규칙과 같다.
 *
 * 질의가 붙거나(`/dept-tasks?assignee=me`) 더 깊어도(`/work/projects/123`) 같은 답이다.
 * 아니면 탭 하나가 자기 상세에서만 사라지는 이상한 일이 생긴다.
 */
export function useIsOpen(): (href: string) => boolean {
  const map = useContext(OpenSurfaces)
  return (href: string) => {
    if (map === null) return true
    const path = href.split(/[?#]/)[0]
    let best: string | null = null
    for (const key of Object.keys(map)) {
      if (path !== key && !path.startsWith(key + '/')) continue
      if (best === null || key.length > best.length) best = key
    }
    return best === null ? true : map[best]
  }
}
