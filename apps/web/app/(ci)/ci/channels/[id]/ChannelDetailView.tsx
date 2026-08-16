'use client'

// app/(ci)/ci/channels/[id]/ChannelDetailView.tsx — R03 채널 상세 뷰

import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import type { CiChannelListItem, CiContentListItem } from '@/lib/ci/contracts'
import ContentCard from '@/components/ci/ContentCard'
import DetailSheet from '@/components/ci/DetailSheet'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'
import ConfirmDeleteDialog from '@/components/ui/ConfirmDeleteDialog'
import { useCiDelete } from '@/lib/ci/use-delete'

interface Props {
  workspaceId: string
  channel: CiChannelListItem
  contents: CiContentListItem[]
  /**
   * 이 채널을 두고 하는 분석("이 계정에서 왜 잘 됐나").
   *
   * 왜 슬롯인가: 데이터는 서버(page.tsx)가 읽지만, **놓일 자리는 이 화면의 순서 문제**다.
   * 예전엔 page가 이 화면보다 위에 그려서 **채널이 누구인지 알기도 전에 분석이 먼저 나왔다**
   * (사용자 지적: "이거 채널명보다 위쪽에 나오는 게 맞는 거야?").
   * 분석은 대상을 알고 난 뒤에 읽는 것이라 정체(아바타·구독자·수집 현황) 다음에 둔다.
   */
  insight?: ReactNode
}

export default function ChannelDetailView({ workspaceId, channel, contents, insight }: Props) {
  const router = useRouter()
  // 목록에서만 지울 수 있고 상세에서는 못 지우던 것을 맞춘다 —
  // 상세까지 들어와서 판단을 끝내는 흐름이 자연스럽다
  const del_ = useCiDelete(workspaceId, () => router.push('/ci/monitoring'))
  const [openId, setOpenId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  // 실패를 작은 회색 글씨로 흘리면 사용자가 고장을 모른다 — 공용 오류 상태로 드러낸다
  const [error, setError] = useState<string | null>(null)

  /** 이 채널이 어떤 후킹으로 통했는지 — 게시물별 분석을 채널 단위로 합친다. */
  const hookSummary = Object.entries(
    contents.reduce<Record<string, number>>((acc, c) => {
      const type = c.creative?.hookType
      if (type) acc[type] = (acc[type] ?? 0) + 1
      return acc
    }, {}),
  ).sort((a, b) => b[1] - a[1])

  async function toggleMonitor() {
    setBusy(true)
    try {
      await fetch(`/api/ci/channels/${channel.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-CI-Workspace': workspaceId },
        body: JSON.stringify({ isMonitored: !channel.isMonitored }),
      })
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  /** 수집 기간 변경 — 바꾸면 그 자리에서 다시 훑는다. */
  async function changeWindow(collectWindow: string) {
    setBusy(true); setNotice(null)
    try {
      await fetch(`/api/ci/channels/${channel.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-CI-Workspace': workspaceId },
        body: JSON.stringify({ collectWindow }),
      })
      setNotice('수집 기간을 바꿨습니다. 다시 훑는 중입니다')
      router.refresh()
    } finally { setBusy(false) }
  }

  /** 채널 페이지에서 구독자·소개문·아바타를 다시 읽어온다. */
  async function refreshMeta() {
    setBusy(true); setNotice(null); setError(null)
    try {
      const res = await fetch(`/api/ci/channels/${channel.id}/refresh-meta`, {
        method: 'POST', headers: { 'X-CI-Workspace': workspaceId },
      }).then((r) => r.json() as Promise<{ success: boolean; data?: { note: string }; error?: { message: string } }>)
      if (res.success) setNotice(res.data?.note ?? '채널 정보를 새로 가져왔습니다')
      else setError(res.error?.message ?? '채널 정보를 가져오지 못했습니다')
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <section className="ci-channel-head">
        <div className="ci-channel-identity">
          {channel.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="ci-channel-avatar" src={channel.avatarUrl} alt="" width={72} height={72} />
          ) : (
            <div className="ci-channel-avatar ci-thumb-empty">사진 없음</div>
          )}
          <div style={{ minWidth: 0 }}>
            <p className="ci-card-meta">
              {channel.handle && <span>{channel.handle}</span>}
              {channel.profileUrl && (
                <a href={channel.profileUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--brand)' }}>
                  채널 열기
                </a>
              )}
            </p>
            {channel.description
              ? <p className="ci-caption">{channel.description}</p>
              : <p className="empty-state-desc">채널 소개문을 아직 확보하지 못했습니다.</p>}
          </div>
        </div>

        <dl className="ci-meta-grid">
          <div className="ci-meta-cell">
            <dt className="ci-basis">구독자</dt>
            <dd className="ci-metric-big">
              {channel.subscriberCount != null
                ? channel.subscriberCount.toLocaleString('ko-KR')
                : '미확보'}
            </dd>
            {channel.subscriberProvenance === 'estimated' && (
              <span className="ci-basis">공개 페이지 반올림 표기</span>
            )}
          </div>
          <div className="ci-meta-cell">
            <dt className="ci-basis">채널 게시물</dt>
            <dd className="ci-metric-big">
              {channel.videoCount != null ? channel.videoCount.toLocaleString('ko-KR') : '미확보'}
            </dd>
          </div>
          <div className="ci-meta-cell">
            <dt className="ci-basis">수집한 게시물</dt>
            <dd className="ci-metric-big">{contents.length}</dd>
            {/* 몇 개 중 몇 개인지 밝힌다 — 3%만 보고 채널을 판단하게 두면 안 된다 */}
            {channel.videoCount != null && channel.videoCount > contents.length && (
              <span className="ci-basis">
                채널 {channel.videoCount.toLocaleString('ko-KR')}개 중{' '}
                {Math.round((contents.length / channel.videoCount) * 100)}%
              </span>
            )}
          </div>
          <div className="ci-meta-cell">
            <dt className="ci-basis">규모 구간</dt>
            <dd style={{ fontWeight: 600 }}>{channel.sizeBand ?? '판정 전'}</dd>
          </div>
        </dl>

        {/* 라벨이 붙은 컨트롤(수집 기간)과 라벨 없는 버튼이 같은 줄에 선다.
            center 정렬이면 라벨 높이만큼 셀렉트가 아래로 밀려 어긋난다(실측 10px) → 바닥 정렬. */}
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label className="label" htmlFor="ch-window" style={{ margin: 0 }}>수집 기간</label>
            <select className="input-field" id="ch-window" style={{ width: 'auto' }}
              value={channel.collectWindow} disabled={busy}
              onChange={(e) => void changeWindow(e.target.value)}>
              <option value="1m">최근 1개월</option>
              <option value="3m">최근 3개월</option>
              <option value="1y">최근 1년</option>
              <option value="all">전체</option>
            </select>
          </div>
          <button type="button" className="btn-ghost" onClick={refreshMeta} disabled={busy}>
            {busy ? '가져오는 중…' : '채널 정보 새로고침'}
          </button>
          {channel.ownership === 'tracked' && (
            <button type="button" className="btn-ghost" onClick={toggleMonitor} disabled={busy}>
              {channel.isMonitored ? '모니터링 중지' : '모니터링 시작'}
            </button>
          )}
          {/* 지켜보기를 멈추는 것과 없애는 것은 다른 일이다.
              내 채널이든 관심 채널이든 지울 수 있어야 목록을 정리할 수 있다. */}
          <button type="button" className="btn-ghost"
            onClick={() => del_.ask({ kind: 'channel', id: channel.id, title: '이 채널을 지울까요?' })}
            disabled={busy}>지우기</button>
          {notice && <span className="ci-basis" role="status">{notice}</span>}
          {channel.metaError && !notice && !error && (
            <span className="ci-status ci-status-warn">{channel.metaError}</span>
          )}
        </div>

        {error && (
          <ErrorState
            message={error}
            onRetry={() => void refreshMeta()}
            helpHref="/ci/settings"
          />
        )}
      </section>

      {insight}

      {hookSummary.length > 0 && (
        <section style={{ marginBottom: 'var(--space-6)' }}>
          <h2 style={{ fontSize: 'var(--fs-md)', fontWeight: 700, marginBottom: 'var(--space-2)' }}>
            이 채널이 통한 방식
          </h2>
          <div className="ci-card-badges">
            {hookSummary.map(([type, count]) => (
              <span key={type} className="ci-status ci-status-info">{type} {count}</span>
            ))}
          </div>
        </section>
      )}

      <h2 style={{ fontSize: 'var(--fs-md)', fontWeight: 700, marginBottom: 'var(--space-3)' }}>
        게시물
      </h2>

      {contents.length === 0 ? (
        <EmptyState
          title="이 채널에서 수집한 게시물이 없습니다"
          description="채널의 게시물 링크를 수집함에 넣거나, 모니터링을 켜두면 새 게시물이 쌓입니다."
          action={{ label: '수집함으로', href: '/ci/inbox' }}
        />
      ) : (
        <div className="ci-card-grid">
          {contents.map((item) => (
            <ContentCard
              key={item.id}
              item={item}
              onOpen={setOpenId}
              onNextStep={(id) => router.push(`/ci/pipeline?from=${id}`)}
            />
          ))}
        </div>
      )}

      <DetailSheet
        contentId={openId}
        workspaceId={workspaceId}
        onClose={() => setOpenId(null)}
        onNextStep={(id) => router.push(`/ci/pipeline?from=${id}`)}
      />

      {del_.pending && (
        <ConfirmDeleteDialog
          title={del_.pending.title}
          impact={del_.impact}
          loading={del_.loading}
          busy={del_.busy}
          errorMessage={del_.errorMessage}
          onConfirm={del_.confirm}
          onClose={del_.close}
        />
      )}
    </>
  )
}
