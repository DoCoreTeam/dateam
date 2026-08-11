'use client'

// app/(ci)/ci/HomeView.tsx — H01 홈 뷰

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { CiHomeData } from '@/lib/ci/contracts'
import LoopMinimap from '@/components/ci/LoopMinimap'
import ContentCard from '@/components/ci/ContentCard'
import DetailSheet from '@/components/ci/DetailSheet'
import { EmptyState } from '@/components/ci/states'
import CiPageHeader from '@/components/ci/CiPageHeader'
import LinkIntakeBox from '@/components/ci/LinkIntakeBox'

const COLD_START_COPY: Record<string, { title: string; desc: string; action: { label: string; href: string } }> = {
  topic: {
    title: '먼저 다룰 주제를 정합니다',
    desc: '주제를 하나 정하면 그 주제의 시장과 떡상을 모아 보여줍니다.',
    action: { label: '주제 만들기', href: '/ci/settings?group=topic' },
  },
  samples: {
    title: '첫 링크를 붙여넣으면 30초 안에 분석이 시작됩니다',
    desc: '유튜브, 틱톡, 인스타, 페북, X, 스레드 링크를 그대로 붙여넣어 보세요.',
    action: { label: '수집함으로', href: '/ci/inbox' },
  },
  channels: {
    title: '관심 채널을 3곳 이상 등록해 보세요',
    desc: '지켜볼 채널이 있어야 평소 대비 배수와 시장 비교가 의미를 갖습니다.',
    action: { label: '관심 채널 추가', href: '/ci/monitoring' },
  },
}

export default function HomeView({ data }: { data: CiHomeData }) {
  const router = useRouter()
  const [openId, setOpenId] = useState<string | null>(null)

  const cold = data.coldStart.needed && data.coldStart.step
    ? COLD_START_COPY[data.coldStart.step]
    : null

  return (
    <>
      <CiPageHeader
        title="홈"
        desc="오늘 할 일과 루프 현황"
      />

      <LinkIntakeBox
        workspaceId={data.workspaceId}
        onDone={() => router.refresh()}
        placeholder="무엇을 도와드릴까요. 링크를 붙여넣거나 예: 요리 주제에서 이번 주 떡상 보여줘"
      />

      <section style={{ margin: 'var(--space-6) 0' }}>
        <h2 style={{ fontSize: 'var(--fs-md)', fontWeight: 700, marginBottom: 'var(--space-3)' }}>
          루프 현황
        </h2>
        <LoopMinimap counts={data.minimap} />
      </section>

      <section style={{ marginBottom: 'var(--space-6)' }}>
        <div style={{
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
          gap: 'var(--space-3)', marginBottom: 'var(--space-3)',
        }}>
          <h2 style={{ fontSize: 'var(--fs-md)', fontWeight: 700 }}>오늘의 브리핑</h2>
          <span className="ci-basis">최근 7일, 평소 대비 높은 순</span>
        </div>

        {cold ? (
          <EmptyState title={cold.title} description={cold.desc} action={cold.action} />
        ) : data.briefing.length === 0 ? (
          <EmptyState
            title="아직 브리핑할 새 소식이 없습니다"
            description="관심 채널에 새 게시물이 올라오면 평소 대비 배수와 함께 여기 모입니다."
            action={{ label: '관심 채널 추가', href: '/ci/monitoring' }}
          />
        ) : (
          <div className="ci-card-grid">
            {data.briefing.map((item) => (
              <ContentCard
                key={item.id}
                item={item}
                onOpen={setOpenId}
                onNextStep={(id) => router.push(`/ci/pipeline?from=${id}`)}
                onAddToBoard={(id) => router.push(`/ci/boards?add=${id}`)}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: 'var(--fs-md)', fontWeight: 700, marginBottom: 'var(--space-2)' }}>
          자동 업데이트
        </h2>
        <div style={{
          display: 'flex', gap: 'var(--space-4)', alignItems: 'center', flexWrap: 'wrap',
          padding: 'var(--space-3)', border: 'var(--hairline) solid var(--border-color)',
          borderRadius: 'var(--radius)', background: 'var(--color-surface)',
        }}>
          <span className="ci-status ci-status-neutral">
            {data.refresh.status === 'running' ? '진행 중'
              : data.refresh.status === 'failed' ? '일부 실패' : '대기'}
          </span>
          <span className="ci-basis ci-num">진행률 {data.refresh.progress}%</span>
          <span className="ci-basis ci-num">신규 {data.refresh.newCount}</span>
          {data.refresh.failedCount > 0 && (
            <Link href="/ci/inbox?tab=failed" className="ci-status ci-status-danger">
              실패 {data.refresh.failedCount}건 보기
            </Link>
          )}
        </div>
      </section>

      <DetailSheet
        contentId={openId}
        workspaceId={data.workspaceId}
        onClose={() => setOpenId(null)}
        onNextStep={(id) => router.push(`/ci/pipeline?from=${id}`)}
      />
    </>
  )
}
