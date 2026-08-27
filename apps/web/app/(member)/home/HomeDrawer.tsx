'use client'

/**
 * 오늘 서랍 — 캘린더 아래 **한 장**.
 *
 * ## 왜 한 장인가
 *
 * 예전엔 카드 넷이 나란히 있었다. 넷은 서로를 모르는 부품이라 각자 높이를 정하고, 각자
 * 말을 쓰고, 각자 데이터를 불렀다. 실측(v0.7.617 · 뷰포트 819px):
 *
 *   높이   부서 609 · 오늘 283 · 메모 245 · 주간보고 206  → **최대/최소 2.96배**
 *   여백   메모만 16/20, 나머지 20/24                      → 글자 시작점이 넷 다 달랐다
 *   요청   화면이 준비된 4.07초에 6건이 한꺼번에 출발       → 다 채워지는 데 ≈6.4초
 *
 * 사용자 지적(2026-08-27): *"높낮이가 안 맞고 체계가 명확하지 않은 케이스를 처음 봤어.
 * 탭이든 버튼이든 처리할 수 있는 건 그렇게 하고 … 합칠 수는 없는 거야?"*
 *
 * **넷이 동시에 다 보일 필요가 없다.** 한 번에 하나만 보이면 —
 *   · 높이가 하나로 정해지고
 *   · 껍데기가 하나라 말·여백·빈 상태도 하나가 되고
 *   · 처음 받을 데이터가 4분의 1이 되고
 *   · 권한은 「탭을 넣을까」 한 곳에서 끝난다.
 *
 * ## 접혀 있어도 알 수 있어야 한다
 *
 * 탭 이름에 **건수를 붙인다**. 「부서 5」·「주간보고 미작성」이 접힌 채로 보이므로,
 * 지난번 지시(*"일부만 보이게 해서 바로 누를 수 있게"*)가 여기서 완성된다.
 * 다만 이제는 **눌러도 화면을 떠나지 않는다.**
 *
 * ## 숫자는 서버가 센다
 *
 * 배지를 클라이언트가 세면 탭을 펼치기 전까지 「세는 중…」이 된다(실제로 그런 화면이 있었다).
 * 네 숫자는 전부 `home/page.tsx` 가 서버에서 세어 내려보낸다.
 */

import { useState, type ReactNode } from 'react'
import SegmentedTabs from '@/components/ui/SegmentedTabs'
import { ENTITY, count } from '@/lib/terms'
import styles from './home.module.css'

export interface HomeDrawerTab {
  id: string
  /** 탭에 적히는 말 — 화면이 한글을 직접 짓지 않는다(§0-2) */
  label: string
  /**
   * 접힌 채로 보이는 신호. 숫자면 건수, 문자열이면 상태 한 마디.
   *
   * **뜻은 넷이 같아야 한다 — 「아직 손대지 않은 것의 수」.**
   * 어떤 탭은 남은 것을, 어떤 탭은 전체를 세면 같은 자리의 숫자가 서로 다른 말을 한다.
   * (실측 2026-08-27: 부서는 기한경과 1, 오늘은 기록한 2, 메모는 미확인 6 —
   *  사용자가 *"숫자는 뭐야? 1 2 6?"* 이라고 물었다. 물어야 읽히는 숫자는 실패한 숫자다.)
   */
  badge?: number | string
  /** 그 숫자가 무엇인지 한 마디. 배지에 마우스를 올리면 나온다 */
  badgeTitle?: string
  /** 배지를 주의 색으로 — 기한 지남·미작성처럼 오늘 손대야 하는 것 */
  alert?: boolean
  content: ReactNode
}

/**
 * 탭은 **넷을 넘지 않는다.**
 *
 * 한 장으로 합치고 나면 탭을 더 붙이고 싶어진다(CRM 할 일·회의 예정·승인 대기…).
 * 그러면 1년 뒤 다시 「무엇부터 볼지 모르겠는 화면」이 된다. 홈에 올 자격은
 * **오늘 안에 행동이 필요한 것**이고, 자리는 넷뿐이다.
 */
export const HOME_DRAWER_MAX_TABS = 4

export default function HomeDrawer({ tabs }: { tabs: HomeDrawerTab[] }) {
  const shown = tabs.slice(0, HOME_DRAWER_MAX_TABS)
  const [activeId, setActiveId] = useState(shown[0]?.id ?? '')
  const active = shown.find((t) => t.id === activeId) ?? shown[0]

  if (shown.length === 0) return null

  return (
    <section className={`card ${styles.drawer}`} aria-label={`오늘의 ${ENTITY.task.label}`}>
      <div className={styles.head}>
        <SegmentedTabs
          ariaLabel="오늘 서랍"
          tabs={shown.map((t) => ({
            id: t.id,
            label: t.label,
            icon: t.badge === undefined || t.badge === 0 ? undefined : (
              <span
                className={`${styles.badge}${t.alert ? ` ${styles.badgeAlert}` : ''}`}
                title={t.badgeTitle}
              >
                {t.badge}
              </span>
            ),
          }))}
          activeId={active.id}
          onSelect={setActiveId}
        />
      </div>

      {/**
        * 높이를 여기서 정한다 — 안의 부품이 정하지 않는다. 그래야 탭을 바꿔도 캘린더가 안 움직이고,
        * 아래에 무엇이 오든 화면이 흔들리지 않는다. 넘치면 이 안에서만 스크롤한다.
        */}
      <div className={styles.panel} role="tabpanel" aria-label={active.label}>
        {active.content}
      </div>
    </section>
  )
}

/** 탭 이름 — 「할 일 2」처럼 개체 이름과 건수를 함께 짓는다(조수사는 용어집이 고른다) */
export function drawerCountLabel(entityKey: Parameters<typeof count>[0], n: number): string {
  return count(entityKey, n)
}
