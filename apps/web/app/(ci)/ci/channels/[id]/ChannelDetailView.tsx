'use client'

// app/(ci)/ci/channels/[id]/ChannelDetailView.tsx — R03 채널 상세 뷰

import { useState, type ReactNode } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import type { CiChannelListItem, CiContentListItem } from '@/lib/ci/contracts'
import ContentCard from '@/components/ci/ContentCard'
import ListPager from '@/components/ui/list/ListPager'
import DetailSheet from '@/components/ci/DetailSheet'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'
import ConfirmDeleteDialog from '@/components/ui/ConfirmDeleteDialog'
import { useCiDelete } from '@/lib/ci/use-delete'
import s from './channel-detail.module.css'

interface Props {
  workspaceId: string
  channel: CiChannelListItem
  contents: CiContentListItem[]
  /** 1-based. 서버가 URL에서 읽어 넘긴다 */
  page: number
  pageSize: number
  /** 이 채널이 가진 전체 게시물 수 — 화면이 진짜 수를 말해야 한다 */
  totalContents: number
  /**
   * 이 채널을 두고 하는 분석("이 계정에서 왜 잘 됐나").
   *
   * 왜 슬롯인가: 데이터는 서버(page.tsx)가 읽지만, **놓일 자리는 이 화면의 순서 문제**다.
   * 예전엔 page가 이 화면보다 위에 그려서 **채널이 누구인지 알기도 전에 분석이 먼저 나왔다**
   * (사용자 지적: "이거 채널명보다 위쪽에 나오는 게 맞는 거야?").
   * 분석은 대상을 알고 난 뒤에 읽는 것이라 정체(아바타·구독자·수집 현황) 다음에 둔다.
   */
  insight?: ReactNode
  /** 이 워크스페이스의 주제 목록 — 채널 주제를 고르려면 고를 것이 화면에 있어야 한다 */
  topics: { id: string; name: string }[]
}

export default function ChannelDetailView({
  workspaceId, channel, contents, insight, topics, page, pageSize, totalContents,
}: Props) {
  const router = useRouter()
  const pathname = usePathname()
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
      setNotice('수집 기간 변경됨 · 다시 수집 중입니다')
      router.refresh()
    } finally { setBusy(false) }
  }

  /**
   * 채널 주제 확정 — 사람이 답할 질문은 이것 하나다.
   *
   * 왜 여기인가: 예전엔 확정 창구가 게시물 하나뿐이라 311건이면 클릭이 311번이었다.
   * 채널에서 한 번 고르면 그 채널 게시물이 함께 다시 판정된다.
   */
  async function changeTopic(topicId: string) {
    setBusy(true); setNotice(null); setError(null)
    try {
      const res = await fetch(`/api/ci/channels/${channel.id}/topic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CI-Workspace': workspaceId },
        body: JSON.stringify({ topicId: topicId || null }),
      }).then((r) => r.json() as Promise<{
        success: boolean
        data?: { applied: number; truncated: boolean }
        error?: { message: string }
      }>)
      if (res.success) {
        // 몇 건이 바뀌었는지 밝힌다 — 안 밝히면 눌러도 아무 일 없어 보인다
        const n = res.data?.applied ?? 0
        setNotice(
          n > 0
            ? `주제를 확정했습니다. 게시물 ${n}건에 함께 반영했습니다${res.data?.truncated ? ' (나머지는 이어서 처리합니다)' : ''}`
            : '주제를 확정했습니다',
        )
      } else {
        setError(res.error?.message ?? '주제를 바꾸지 못했습니다')
      }
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
            onClick={() => del_.ask({ kind: 'channel', id: channel.id, title: '이 채널을 삭제할까요?' })}
            disabled={busy}>삭제</button>
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

      {/* 사람에게 물어야 할 질문은 이것 하나다 — "이 채널 뭐 하는 채널이에요?"
          게시물마다 묻지 않는다. 여기서 한 번 고르면 소속 게시물이 함께 다시 판정된다. */}
      <section className={`card ${s.topicCard}`}>
        <div className={s.topicRow}>
          <div className={s.topicMain}>
            <h2 className={s.topicHead}>
              채널 주제
              <span className={`ci-status ${channel.topicSource === 'user' ? 'ci-status-info' : 'ci-status-warn'}`}>
                {channel.topicSource === 'user' ? '확정' : channel.topic ? '추정' : '미분류'}
              </span>
            </h2>
            {/* 근거를 같이 보여준다 — 근거 없이 물으면 사용자도 답할 수가 없다 */}
            <p className={s.topicBasis}>
              {channel.identityText ?? '아직 판정할 만큼 신호가 모이지 않았습니다'}
              {channel.identityAgreement != null && channel.identitySampleSize != null && (
                ` · 일치도 ${Math.round(channel.identityAgreement * 100)}% · 게시물 ${channel.identitySampleSize}건 기준`
              )}
            </p>
          </div>
          <div className={s.topicPicker}>
            <label className="label" htmlFor="ch-topic">주제 고르기</label>
            <select className={`input-field ${s.topicSelect}`} id="ch-topic"
              value={channel.topic?.id ?? ''} disabled={busy}
              onChange={(e) => void changeTopic(e.target.value)}>
              <option value="">주제 없음</option>
              {topics.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
        </div>
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
        게시물{totalContents > 0 ? ` ${totalContents.toLocaleString()}건` : ''}
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

      {/* 페이지 이동 — 예전엔 50건 고정에 페이지가 없어서 114건짜리 채널의
          뒤쪽 64건에 화면에서 도달할 방법이 아예 없었다(실측). */}
      {totalContents > pageSize && (
        <ListPager
          query={{
            q: '', sort: { key: 'recent', dir: 'desc' }, filters: {},
            view: 'card', size: pageSize as never, mode: 'pages', page,
          }}
          total={totalContents}
          onChange={(patch) => {
            if (patch.page == null) return
            const qs = patch.page > 1 ? `?page=${patch.page}` : ''
            router.push(`${pathname}${qs}`, { scroll: true })
          }}
        />
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
