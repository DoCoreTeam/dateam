// /admin/system-log — 실패를 한 화면에서 본다
//
// 탭을 셋으로 나눈 이유: **계층이 다르다.**
//   우리 기록  = 우리가 쓴 사건(사실 문장이 저장 시점에 확정돼 있다)
//   배포 로그  = Vercel 이 배포하면서 뱉은 것(빌드 오류·경고가 여기 있다)
//   배포       = Vercel 배포 이력(무엇이 언제 나갔는지)
//
// 런타임 로그(요청별 5xx)를 안 넣은 이유: Vercel 의 `runtime-logs` endpoint 가
// 이 계정에서 **응답 헤더조차 주지 않는다**(실측 2026-08-24: 트래픽을 쏘면서 30초 대기 → 무응답).
// 안 되는 것을 붙여 놓고 "느립니다"라고 말하지 않는다.
// 한 목록에 섞으면 같은 실패가 두 줄로 보이거나, 다른 것이 한 줄로 접힌다.
//
// 탭 렌더는 SegmentedTabs(SSOT) 하나만 쓴다 — 화면이 탭 마크업을 자작하지 않는다(§2).

import { Bug, ServerCrash, Rocket } from 'lucide-react'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import PageHeader from '@/components/ui/PageHeader'
import SegmentedTabs, { type SegmentedTab } from '@/components/ui/SegmentedTabs'
import SystemLogClient from './SystemLogClient'
import VercelLogPanel from './VercelLogPanel'

export const dynamic = 'force-dynamic'

export default async function SystemLogPage() {
  await requireAdmin()

  const tabs: SegmentedTab[] = [
    {
      id: 'events',
      label: '우리 기록',
      sub: '시스템이 남긴 실패',
      icon: <Bug size={15} />,
      content: <SystemLogClient />,
    },
    {
      id: 'logs',
      label: '배포 로그',
      sub: '배포하며 뱉은 오류',
      icon: <ServerCrash size={15} />,
      content: <VercelLogPanel kind="logs" />,
    },
    {
      id: 'deploys',
      label: '배포',
      sub: '무엇이 언제 나갔나',
      icon: <Rocket size={15} />,
      content: <VercelLogPanel kind="deployments" />,
    },
  ]

  return (
    <div className="page-inner">
      <PageHeader
        title="시스템 로그"
        description="시스템에서 실패한 일을 한곳에 모았습니다. 무엇이 왜 안 됐는지 사람 말로 적혀 있고, 해결 방법은 눌렀을 때만 AI가 만듭니다."
      />
      <SegmentedTabs tabs={tabs} ariaLabel="시스템 로그 분류" />
    </div>
  )
}
