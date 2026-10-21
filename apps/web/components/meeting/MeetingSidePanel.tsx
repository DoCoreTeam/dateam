'use client'

/**
 * 회의 옆 패널 — 회의 화면을 그대로 둔 채 옆에서 할 일.
 *
 * 사용자 지적(2026-10-21): 녹음하며 다른 미팅 기록을 보려면 새 탭을 열어야 했다.
 * 그래서 다른 기록 보기와 이 회의에 묻기를 **한 패널의 두 탭**으로 둔다. 둘 다 회의를 띄워 둔 채 하는 일이라
 * 자리가 하나면 된다.
 *
 * 모달이 아니다 — 패널이 열려 있어도 왼쪽 메모에 계속 적는다. 열림과 탭은 주소(`?side=`)가 쥔다.
 */

import type { ReactNode } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { X } from 'lucide-react'
import { PEEK_PARAM, SIDE_PARAM, parseSideTab, type SideTab } from '@/lib/meeting/side-panel'
import { ACTION } from '@/lib/terms'
import SegmentedTabs from '@/components/ui/SegmentedTabs'
import styles from './side-panel.module.css'

export const SIDE_TAB_LABEL: Record<SideTab, string> = {
  records: '다른 기록',
  ask: '이 회의에 묻기',
}

interface Props {
  /** 탭마다 그릴 것. 없는 탭은 단추도 안 그린다 */
  tabs: Partial<Record<SideTab, ReactNode>>
}

/** 주소에서 패널을 열고 닫는다 — 여는 것은 쌓고(뒤로 가기로 닫힘), 닫는 것은 바꾼다 */
export function useSidePanelNav() {
  const router = useRouter()
  const go = (tab: SideTab | null) => {
    const url = new URL(window.location.href)
    if (tab) url.searchParams.set(SIDE_PARAM, tab)
    else { url.searchParams.delete(SIDE_PARAM); url.searchParams.delete(PEEK_PARAM) }
    const next = `${url.pathname}${url.search}`
    if (tab) router.push(next, { scroll: false })
    else router.replace(next, { scroll: false })
  }
  return go
}

export default function MeetingSidePanel({ tabs }: Props) {
  const sp = useSearchParams()
  const go = useSidePanelNav()
  const tab = parseSideTab(sp.get(SIDE_PARAM))
  if (!tab || !tabs[tab]) return null
  const available = (Object.keys(SIDE_TAB_LABEL) as SideTab[]).filter((t) => tabs[t])

  return (
    <aside className={styles.panel} aria-label="회의 옆 패널">
      <div className={styles.panelHead}>
        <SegmentedTabs
          tabs={available.map((t) => ({ id: t, label: SIDE_TAB_LABEL[t] }))}
          ariaLabel="옆 패널 보기"
          activeId={tab}
          onSelect={(id) => id !== tab && go(id as SideTab)}
        />
        <button type="button" className={styles.close} onClick={() => go(null)} aria-label={`옆 패널 ${ACTION.close}`}>
          <X size={16} aria-hidden />
        </button>
      </div>
      <div className={styles.panelBody} role="tabpanel">{tabs[tab]}</div>
    </aside>
  )
}
