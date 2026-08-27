'use client'

// components/ci/ChannelListView.tsx — 채널 목록 공용 뷰
// 모니터링(관심 채널)과 내 채널이 같은 데이터·같은 표를 쓴다.
// 화면 두 개가 각자 표를 만들면 표시 규칙이 갈라진다.
//
// 목록 자체는 표준 부품(ListToolbar/ListSurface/ListPager)이 그린다 — 검색·정렬·보기가
// URL에 남아 새로고침·공유가 성립한다. 데이터는 그대로 서버 컴포넌트가 통째로 넘긴다.

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ApiResponse, CiChannelListItem } from '@/lib/ci/contracts'
import { CI_PLATFORM_LABEL } from '@/lib/ci/types'
import ErrorState from '@/components/ui/ErrorState'
import ListToolbar from '@/components/ui/list/ListToolbar'
import ListSurface from '@/components/ui/list/ListSurface'
import ListPager from '@/components/ui/list/ListPager'
import RowActions from '@/components/ui/list/RowActions'
import type { ColumnDef } from '@/components/ui/list/types'
import { useListQuery } from '@/lib/ui/use-list-query'
import { rangeOf, type ListDefaults } from '@/lib/ui/list-query'
import { isEnterKey } from '@/lib/ui/ime'
import ConfirmDeleteDialog from '@/components/ui/ConfirmDeleteDialog'
import { useCiDelete } from '@/lib/ci/use-delete'

interface ChannelListViewProps {
  workspaceId: string
  items: CiChannelListItem[]
  /** 'tracked' = 관심 채널(모니터링), 'owned' = 내 채널 */
  mode: 'tracked' | 'owned'
  /**
   * 채널별 최근 활동 — 화면 제목이 약속한 "새 게시물과 성과 변화"의 실체다.
   * 안 주면 그 칸을 아예 그리지 않는다(빈 칸을 만들지 않는다).
   */
  activity?: Record<string, { newCount: number; medianOutlierText: string | null; hitCount: number }>
  /** 활동 집계의 기간 — 숫자 옆에 무엇을 근거로 셌는지 붙인다 */
  activityWindowDays?: number
}

const LIST_DEFAULTS: ListDefaults = { sort: { key: 'name', dir: 'asc' }, view: 'table' }

const SORT_OPTIONS = [
  { key: 'name', label: '채널명' },
  { key: 'subscribers', label: '구독자' },
  { key: 'platform', label: '플랫폼' },
]

export default function ChannelListView({
  workspaceId, items, mode, activity, activityWindowDays = 28,
}: ChannelListViewProps) {
  const router = useRouter()
  const del_ = useCiDelete(workspaceId, () => router.refresh())
  const { query, set } = useListQuery(LIST_DEFAULTS, {
    persistKey: mode === 'tracked' ? '/ci/monitoring' : '/ci/my-channels',
  })
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ code: string; message: string } | null>(null)

  async function add() {
    if (!input.trim()) return
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/ci/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CI-Workspace': workspaceId },
        body: JSON.stringify({ input: input.trim(), monitor: mode === 'tracked' }),
      }).then((r) => r.json() as Promise<ApiResponse<CiChannelListItem>>)

      if (!res.success) { setError({ code: res.error.code, message: res.error.message }); return }

      if (mode === 'owned') {
        await fetch(`/api/ci/channels/${res.data.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'X-CI-Workspace': workspaceId },
          body: JSON.stringify({ ownership: 'owned' }),
        })
      }
      setInput('')
      router.refresh()
    } catch {
      setError({ code: 'INTERNAL', message: '채널을 추가하지 못했습니다' })
    } finally {
      setBusy(false)
    }
  }

  async function toggleMonitor(ch: CiChannelListItem) {
    await fetch(`/api/ci/channels/${ch.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-CI-Workspace': workspaceId },
      body: JSON.stringify({ isMonitored: !ch.isMonitored }),
    })
    router.refresh()
  }

  const monitored = items.filter((c) => c.isMonitored).length

  const columns = useMemo<ColumnDef<CiChannelListItem>[]>(() => {
    const base: ColumnDef<CiChannelListItem>[] = [
      {
        // 제목 칸의 링크는 ListSurface가 rowHref로 그린다 — 화면이 또 감싸면 링크가 겹친다
        key: 'name', header: '채널', primary: true, sortable: true,
        cell: (ch) => (
          <span style={{ display: 'inline-flex', flexDirection: 'column' }}>
            <span>{ch.displayName}</span>
            <span className="ci-basis">{CI_PLATFORM_LABEL[ch.platform]}</span>
          </span>
        ),
      },
      {
        key: 'subscribers', header: '구독자', align: 'right', sortable: true,
        cell: (ch) => (ch.subscriberCount != null
          ? <span className="ci-num">{ch.subscriberCount.toLocaleString('ko-KR')}</span>
          : <span className="ci-basis" title="아직 확보하지 못했습니다">—</span>),
      },
      { key: 'topic', header: '주제', cell: (ch) => ch.topic?.name ?? '미지정' },
    ]

    // 화면이 "새 게시물과 성과 변화를 따라갑니다"라고 약속했는데 예전엔 구독자 수와
    // 배지뿐이었다. 약속한 것을 여기서 지킨다 — 없는 숫자는 지어내지 않고 '—'로 둔다.
    if (mode === 'tracked' && activity) {
      base.push({
        key: 'newCount', header: '새 게시물', align: 'right', sortable: true,
        cell: (ch) => {
          const a = activity[ch.id]
          return a && a.newCount > 0
            ? <span className="ci-num" title={`최근 ${activityWindowDays}일`}>{a.newCount}</span>
            : <span className="ci-basis" title={`최근 ${activityWindowDays}일에 새로 들어온 게시물이 없습니다`}>—</span>
        },
      })
      base.push({
        key: 'perf', header: '평소 대비',
        cell: (ch) => {
          const a = activity[ch.id]
          // 비교군이 얇으면 배수를 내지 않는다 — 이 규칙은 전 화면이 공유한다
          if (!a?.medianOutlierText) return <span className="ci-basis">근거 부족</span>
          return (
            // 배지를 쌓으면 이 칸이 행 높이를 정하게 된다 — 한 줄에 붙인다(§2-3-1 (3))
            <span style={{ display: 'flex', gap: 'var(--space-1)', flexWrap: 'nowrap', alignItems: 'center' }}>
              <span className="ci-status ci-status-neutral" style={{ whiteSpace: 'nowrap' }}>
                {a.medianOutlierText}
              </span>
              {a.hitCount > 0 && (
                <span className="ci-status ci-status-ok" style={{ whiteSpace: 'nowrap' }}
                  title="평소의 2배를 넘은 게시물">
                  떡상 {a.hitCount}건
                </span>
              )}
            </span>
          )
        },
      })
    }

    if (mode === 'tracked') {
      base.push({
        key: 'monitored', header: '모니터링',
        cell: (ch) => (
          <span className={ch.isMonitored ? 'ci-status ci-status-ok' : 'ci-status ci-status-neutral'}>
            {ch.isMonitored ? '지켜보는 중' : '중지'}
          </span>
        ),
      })
    }

    // '상세' 버튼은 두지 않는다 — 행 전체가 상세로 열린다(rowHref).
    // 버튼을 남기면 "행은 죽어 있고 버튼만 되는" 상태로 되돌아간다.
    if (mode === 'tracked') {
      base.push({
        key: 'action', header: '작업', noLabel: true, align: 'right',
        cell: (ch) => (
          // RowActions 가 전파 차단과 "접히지 않음"을 함께 맡는다.
          // 활동 칸이 늘면서 이 칸이 좁아졌고, 예전 구조는 버튼이 세로로 접혀 행 높이가 터졌다(§2-3-1 (3)).
          <RowActions inline={1} subject={ch.displayName}>
            <button type="button" className="btn-ghost" onClick={() => toggleMonitor(ch)}>
              {ch.isMonitored ? '중지' : '지켜보기'}
            </button>
            {/* 지켜보기를 멈추는 것과 목록에서 없애는 것은 다른 일이다.
                예전엔 중지만 있어 그만 볼 채널이 목록에 영원히 남았다. */}
            <button type="button" className="btn-ghost"
              onClick={() => del_.ask({ kind: 'channel', id: ch.id, title: '이 채널을 지울까요?' })}
              aria-label="채널 지우기" title="지우기">지우기</button>
          </RowActions>
        ),
      })
    }

    return base
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, del_, activity, activityWindowDays])

  // 서버가 전체 목록을 한 번에 넘긴다 — 걸러내기·정렬·자르기는 표현 계층에서 한다(§2-6)
  const rows = useMemo(() => {
    const q = query.q.trim().toLowerCase()
    const filtered = q
      ? items.filter((ch) => `${ch.displayName} ${ch.handle ?? ''}`.toLowerCase().includes(q))
      : items
    const dir = query.sort.dir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      if (query.sort.key === 'subscribers') return ((a.subscriberCount ?? -1) - (b.subscriberCount ?? -1)) * dir
      if (query.sort.key === 'platform') {
        return (CI_PLATFORM_LABEL[a.platform] ?? '').localeCompare(CI_PLATFORM_LABEL[b.platform] ?? '', 'ko') * dir
      }
      return a.displayName.localeCompare(b.displayName, 'ko') * dir
    })
  }, [items, query.q, query.sort.key, query.sort.dir])

  const { from, to } = rangeOf(query)

  return (
    <>
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
        <label className="label" htmlFor="ci-ch-add" style={{ position: 'absolute', left: '-9999px' }}>
          채널 주소
        </label>
        <input className="input-field" id="ci-ch-add"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (isEnterKey(e)) { e.preventDefault(); add() } }}
          placeholder="채널 페이지 주소를 붙여넣으세요 (예: https://www.youtube.com/@채널)"
          disabled={busy}
          style={{ flex: 1 }}
        />
        <button type="button" className="btn-primary" onClick={add} disabled={busy || !input.trim()}>
          {busy ? '추가 중…' : '추가'}
        </button>
      </div>

      {error && (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <ErrorState code={error.code} message={error.message} helpHref="/ci/settings" />
        </div>
      )}

      {mode === 'tracked' && items.length > 0 && (
        <p className="ci-basis" style={{ marginBottom: 'var(--space-2)' }}>
          지켜보는 중 {monitored}곳 / 등록 {items.length}곳
        </p>
      )}

      <ListToolbar
        query={query}
        onChange={set}
        searchPlaceholder="채널명·핸들로 찾기"
        sortOptions={SORT_OPTIONS}
        total={rows.length}
      />

      <ListSurface
        rows={rows.slice(from, to + 1)}
        columns={columns}
        query={query}
        rowKey={(ch) => ch.id}
        rowHref={(ch) => `/ci/channels/${ch.id}`}
        onChange={set}
        empty={items.length === 0
          ? {
            title: mode === 'tracked' ? '아직 등록한 관심 채널이 없습니다' : '연결한 내 채널이 없습니다',
            description: mode === 'tracked'
              ? '지켜볼 채널을 3곳 이상 등록하면 평소 대비 배수와 시장 비교가 의미를 갖습니다. 위 칸에 채널 주소를 붙여넣어 보세요.'
              : '내 채널을 등록하면 게시물 성과를 추적하고 시장과 비교할 수 있습니다. 위 칸에 채널 주소를 붙여넣어 보세요.',
          }
          : { title: '조건에 맞는 채널이 없어요', description: '검색어나 정렬을 바꿔보세요' }}
      />

      <ListPager query={query} total={rows.length} onChange={set} />

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
