'use client'

// components/ui/ProjectTabs.tsx — 구 영업 그룹 탭(리드 인테이크→거래처→담당자→영업기회)
// 그리는 일은 SegmentedTabs가 한다. 여기는 "어떤 탭이 있는가"만 안다.
//
// **이 넷은 영업 CRM 과 개념이 겹친다** — 거래처↔회사 · 담당자↔인물 · 영업기회↔딜.
// 그래서 사용자는 두 곳을 오가며 **어느 쪽이 진짜인지 몰랐다**(사용자 지적 2026-08-27).
// 사이드바에서는 내렸고(§2-3-3), 여기서는 **어디가 새 자리인지 화면이 직접 말한다.**
// 지우지 않는 이유: 실데이터가 있다(거래처 12 · 담당자 1 · 영업기회 1).

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import SegmentedTabs, { type SegmentedTab } from './SegmentedTabs'
import { NAV_LABEL } from '@/lib/nav/menu'
import { SERVICE_LABEL, LEGACY_MOVING_ONLY } from '@/lib/terms'
import { useIsOpen } from '@/lib/access/open-context'
import styles from './project-tabs.module.css'

const TABS: SegmentedTab[] = [
  { id: 'lead-intake', label: NAV_LABEL['/lead-intake'], href: '/lead-intake' },
  { id: 'accounts', label: NAV_LABEL['/accounts'], href: '/accounts' },
  { id: 'contacts', label: NAV_LABEL['/contacts'], href: '/contacts' },
  { id: 'deals', label: NAV_LABEL['/deals'], href: '/deals' },
]

export default function ProjectTabs() {
  /*
    **닫힌 곳은 안 그린다** (P0049 I04).

    넷 다 다른 표면이라 관리자가 하나만 열어 줄 수 있다. 그때 나머지 셋이 남아 있으면
    누르는 족족 「접근할 권한이 없습니다」가 뜬다. 판정은 셸이 재 뒀고 여기서는 읽기만 한다.

    아래 안내의 「영업 CRM 으로」 링크도 같다 — CRM 이 닫힌 사람에게 그 링크는 죽은 문이고,
    「그쪽에서 만드세요」는 할 수 없는 일을 시키는 말이다. 그래서 그 사람에게는
    **옮겨가는 중이라는 사실만** 남긴다(`LEGACY_MOVING_ONLY`).
  */
  const isOpen = useIsOpen()
  const tabs = TABS.filter((t) => isOpen(t.href ?? ''))
  const crmOpen = isOpen('/crm')

  // 넷 다 닫히면 그릴 것이 없다 — 빈 줄만 남기지 않는다
  if (tabs.length === 0) return null

  return (
    <>
      <SegmentedTabs tabs={tabs} variant="primary" ariaLabel="영업 탭" />
      <p className={styles.legacy}>
        {crmOpen ? (
          <>
            이 화면들은 <b>{SERVICE_LABEL.crm}</b>으로 옮겨가는 중입니다. 새 영업 건은 그쪽에서 만드세요.
            <Link href="/crm" className={styles.go}>
              {SERVICE_LABEL.crm}으로 <ArrowRight size={13} aria-hidden />
            </Link>
          </>
        ) : LEGACY_MOVING_ONLY}
      </p>
    </>
  )
}
