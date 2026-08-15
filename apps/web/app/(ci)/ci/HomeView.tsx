'use client'

// app/(ci)/ci/HomeView.tsx — H01 홈 뷰

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { CiHomeData } from '@/lib/ci/contracts'
import LoopMinimap from '@/components/ci/LoopMinimap'
import ContentCard from '@/components/ci/ContentCard'
import DetailSheet from '@/components/ci/DetailSheet'
import EmptyState from '@/components/ui/EmptyState'
import PageHeader from '@/components/ui/PageHeader'
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

  // 콜드 스타트 안내는 "빈 대시보드"를 막으려는 장치다(설계서 §8.6).
  // 보여줄 브리핑이 이미 있으면 안내가 콘텐츠를 가려서는 안 된다 — 옆에 덧붙이기만 한다.
  const hasBriefing = data.briefing.length > 0
  const showColdStartInstead = Boolean(cold) && !hasBriefing

  return (
    <>
      <PageHeader
        title="홈"
        description="오늘 할 일과 루프 현황"
      />

      <LinkIntakeBox
        workspaceId={data.workspaceId}
        onDone={() => router.refresh()}
        // 이 칸은 링크만 받는다. 자연어는 어시스턴트가 받는다 —
        // 예전 문구가 "예: 요리 주제에서 이번 주 떡상 보여줘"라고 시켜놓고
        // 정작 문장을 넣으면 공백으로 쪼개 단어마다 오류를 뱉었다.
        placeholder="게시물이나 채널 주소를 붙여넣으세요 — 그 계정의 게시물을 함께 모읍니다"
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

        {showColdStartInstead && cold ? (
          <EmptyState title={cold.title} description={cold.desc} action={cold.action} />
        ) : !hasBriefing ? (
          <EmptyState
            title="아직 브리핑할 새 소식이 없습니다"
            description="관심 채널에 새 게시물이 올라오면 평소 대비 배수와 함께 여기 모입니다."
            action={{ label: '관심 채널 추가', href: '/ci/monitoring' }}
          />
        ) : (
          <>
            {cold && (
              <p
                className="ci-status ci-status-info"
                style={{ marginBottom: 'var(--space-3)', display: 'inline-flex' }}
              >
                {cold.title} —{' '}
                <Link href={cold.action.href} style={{ marginLeft: 'var(--space-1)' }}>
                  {cold.action.label}
                </Link>
              </p>
            )}
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
          </>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: 'var(--fs-md)', fontWeight: 700, marginBottom: 'var(--space-2)' }}>
          자동 업데이트
        </h2>
        <div className="card" style={{
          display: 'flex', gap: 'var(--space-4)', alignItems: 'center', flexWrap: 'wrap',
          padding: 'var(--space-3)',
        }}>
          <span className="ci-status ci-status-neutral">
            {data.refresh.status === 'running' ? '수집 중'
              : data.refresh.status === 'failed' ? '일부 실패' : '최신'}
          </span>
          {/* 진행률은 처리할 것이 남았을 때만 뜻이 있다. 다 끝난 상태에서 "100%"는
              읽는 사람에게 아무 정보도 주지 않으면서 자리만 차지한다. */}
          {data.refresh.status === 'running' && (
            <span className="ci-basis ci-num">진행률 {data.refresh.progress}%</span>
          )}
          {/* 숫자에 기간을 붙인다 — "신규 263"은 무엇의 263인지 알 수 없었다 */}
          <span className="ci-basis ci-num">최근 24시간 신규 {data.refresh.newCount}건</span>
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
