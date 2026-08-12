'use client'

import dynamic from 'next/dynamic'
import { SkelCard } from '@/components/ui/LoadingSkeleton'

// react-organizational-chart(Tree)가 SSR 중 document를 참조해 크래시 → 클라이언트 전용 로드
const OrgPublicTree = dynamic(() => import('./OrgPublicTree'), {
  ssr: false,
  loading: () => <SkelCard lines={6} />,
})

interface Props {
  nodes: unknown[]
  emailMap?: Record<string, string>
  profileMap?: Record<string, { name: string; rank: string | null; position: string | null }>
}

export default function OrgPublicTreeClient(props: Props) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return <OrgPublicTree {...(props as any)} />
}
