'use client'

// 가격 기준으로 가는 카드 — 화면은 한 벌이고 문이 둘이다(딜 메뉴의 탭, 여기)
//
// 가격 기준을 설정 안으로 옮기지 않은 데는 기록된 이유가 있다(lib/crm/nav/groups.ts):
// 설정으로 내리면 견적을 쓰다 오타를 발견해도 고치러 갈 길이 안 보인다. 그래서 길을 하나 더 낸다.

import Link from 'next/link'
import { Package } from 'lucide-react'
import SettingsCard from '@/components/ui/settings/SettingsCard'
import { PRICEBOOK } from '@/lib/terms'

const LINKS = [
  { href: '/crm/products?tab=product', label: PRICEBOOK.tabProduct },
  { href: '/crm/products?tab=item', label: PRICEBOOK.tabItem },
  { href: '/crm/products?tab=labor', label: PRICEBOOK.tabLabor },
] as const

export default function PricebookCard() {
  return (
    <SettingsCard
      title={PRICEBOOK.title}
      icon={<Package size={18} />}
      description="제품 정상가, 품목, 인건비 등급 단가. 견적이 빈칸을 채울 때 여기 값을 씁니다."
    >
      <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        {LINKS.map((l) => <Link key={l.href} href={l.href} className="btn-ghost">{l.label}</Link>)}
      </div>
    </SettingsCard>
  )
}
