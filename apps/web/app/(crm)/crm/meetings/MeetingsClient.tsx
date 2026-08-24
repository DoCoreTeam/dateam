'use client'

// 미팅 목록 (dacrm F2) — 목록 표준(§2-6)
//
// 이 화면이 답해야 하는 것: **"지난주에 누구를 만났고 무슨 이야기가 오갔나."**
//
// 예전 판이 실제로 못 하던 것 셋:
//   ① 검색·필터·페이지가 없어 미팅이 쌓이면 최근 50건 밖은 **볼 방법 자체가 없었다.**
//   ② 회사·딜 이름을 화면이 건당 다시 물었다 — 한 화면에 최대 40번 왕복(N+1)이었고,
//      그중 하나만 실패하면 그 줄만 이름이 빈 채로 남아 사용자는 이유를 알 수 없었다.
//   ③ 상태가 '정리됨/전사 대기' 둘뿐이라 **한 시간째 멈춘 것과 방금 시작한 것이 같은 말**이었다.
//      전사 실패는 '대기'로 위장돼 영영 발견되지 않았다.
//
// 셋 다 서버로 내렸다 — 화면은 조건을 주소에 싣고 그리기만 한다.

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Mic, Plus, NotebookPen } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import NbModal from '@/components/ui/nb/NbModal'
import AXDotLoader from '@/components/ui/AXDotLoader'
import EmptyState from '@/components/ui/EmptyState'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import ListToolbar from '@/components/ui/list/ListToolbar'
import ListSurface from '@/components/ui/list/ListSurface'
import ListPager from '@/components/ui/list/ListPager'
import type { ColumnDef } from '@/components/ui/list/types'
import { useListQuery } from '@/lib/ui/use-list-query'
import { formatKstDateTimeShort } from '@/lib/datetime/kst'
import { startMeeting, meetingHref } from '@/lib/crm/ui/start-meeting'
import notePick from './note-pick.module.css'
import {
  MEETING_STATUS_META, MEETING_STATUS_ORDER, meetingStatusMeta,
} from '@/lib/crm/ui/meeting-status'
import type { MeetingStatusKey } from '@/lib/crm/ui/meeting-status'

interface Meeting {
  id: string
  title: string
  startedAt: string
  companyId: string | null
  dealId: string | null
  location: string | null
  summaryMd: string | null
  noteId: string | null
  companyName: string | null
  dealName: string | null
  statusKey: MeetingStatusKey
}

/** 발행 후보로 고를 수 있는 회의노트 */
interface PickableNote {
  id: string
  title: string | null
  meetingAt: string | null
  published: boolean
}

const FAINT = { color: 'var(--text-faint)' }

const COLUMNS: ColumnDef<Meeting>[] = [
  {
    key: 'title',
    header: '미팅',
    primary: true,
    cell: (m) => (
      <>
        <span>{m.title}</span>
        {/* 원본이 회의노트인 건은 그 사실을 목록에서 밝힌다 — 어디를 고쳐야 하는지가 달라진다 */}
        {m.noteId && <span style={{ ...FAINT, marginLeft: 'var(--space-2)' }}>회의노트</span>}
      </>
    ),
  },
  {
    key: 'startedAt',
    header: '일시',
    cell: (m) => formatKstDateTimeShort(m.startedAt),
  },
  {
    key: 'who',
    header: '회사 · 딜',
    cell: (m) => (
      m.companyName || m.dealName ? (
        <>
          {m.companyName}
          {m.dealName && (
            <span style={{ ...FAINT, marginLeft: m.companyName ? 'var(--space-2)' : 0 }}>{m.dealName}</span>
          )}
        </>
      ) : <span style={FAINT}>붙은 곳 없음</span>
    ),
  },
  {
    key: 'location',
    header: '장소',
    hideOnCard: true,
    cell: (m) => (m.location ? m.location : <span style={FAINT}>기록 없음</span>),
  },
  {
    key: 'status',
    header: '상태',
    cell: (m) => {
      const meta = meetingStatusMeta({ summaryMd: m.summaryMd, recordingStatuses: [] })
      // 서버가 이미 판정해 준 키가 있으면 그걸 쓴다 — 화면이 다시 판정하면 둘이 갈린다
      const resolved = MEETING_STATUS_META[m.statusKey] ?? meta
      return <NbBadge status={resolved.status}>{resolved.label}</NbBadge>
    },
  },
]

const STATUS_FILTER = {
  key: 'status',
  label: '상태',
  options: [
    { value: '', label: '전체' },
    ...MEETING_STATUS_ORDER.map((s) => ({ value: s, label: MEETING_STATUS_META[s].label })),
  ],
}

export default function MeetingsClient() {
  const router = useRouter()
  const { query, set, queryKey } = useListQuery({
    view: 'table', size: 20, sort: { key: 'startedAt', dir: 'desc' }, mode: 'more',
    filterKeys: ['status'],
  })
  const [rows, setRows] = useState<Meeting[]>([])
  /**
   * 미팅 시작 상태.
   *
   * 예전엔 여기서 `/crm/meetings/new` 로 보냈다 — 제목·시각·회사·딜을 묻고,
   * 진입 방식을 고르게 한 뒤, 그제서야 작업대로 넘어갔다. 화면이 셋이었다.
   * 지금은 누르는 순간 미팅이 생기고 곧장 작업대로 간다(사용자 지시 2026-08-24).
   */
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [pickingNote, setPickingNote] = useState(false)
  const [notes, setNotes] = useState<PickableNote[] | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [total, setTotal] = useState<number | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const q = query.q ?? ''
  const status = query.filters?.status ?? ''

  /** 미팅을 만들고 곧장 작업대로 — 중간에 묻는 화면이 없다 */
  const begin = useCallback(async () => {
    setStarting(true)
    setStartError(null)
    try {
      const created = await startMeeting()
      router.push(meetingHref(created.id))
    } catch (e) {
      setStartError(e instanceof Error ? e.message : '미팅을 만들지 못했습니다.')
      setStarting(false)
    }
  }, [router])

  /** 이미 쓴 회의노트를 올린다 — 새로 만드는 게 아니라 발행이라 모달이 맞다 */
  const loadNotes = useCallback(async () => {
    setNotes(null)
    try {
      const res = await fetch('/api/crm/meetings/notes?limit=20')
      const body = await res.json()
      setNotes(res.ok ? (body.items ?? []) : [])
    } catch {
      setNotes([])
    }
  }, [])

  useEffect(() => { if (pickingNote) void loadNotes() }, [pickingNote, loadNotes])

  const publishNote = useCallback(async (noteId: string) => {
    setStarting(true)
    setStartError(null)
    try {
      const res = await fetch('/api/crm/meetings/from-note', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteId }),
      })
      const body = await res.json()
      if (!res.ok) {
        setStartError(body?.error?.message ?? '회의노트를 가져오지 못했습니다.')
        setStarting(false)
        return
      }
      setPickingNote(false)
      router.push(meetingHref(body.meetingId as string))
    } catch {
      setStartError('회의노트를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.')
      setStarting(false)
    }
  }, [router])

  const load = useCallback(async (append: boolean, nextCursor: string | null) => {
    // 기본값으로 되돌리는 조작은 주소가 그대로라 개별 필드로는 안 보인다 — queryKey 로만 들어온다
    void queryKey
    setLoading(true)
    setError(null)
    try {
      const sp = new URLSearchParams()
      if (q) sp.set('q', q)
      if (status) sp.set('status', status)
      sp.set('limit', String(query.size))
      if (nextCursor) sp.set('cursor', nextCursor)

      const res = await fetch(`/api/crm/meetings?${sp.toString()}`)
      const body = await res.json()
      if (!res.ok) {
        setError(body?.error?.message ?? '미팅을 불러오지 못했습니다.')
        return
      }
      setRows((prev) => (append ? [...prev, ...body.items] : body.items))
      setCursor(body.nextCursor ?? null)
      if (!append) setTotal(typeof body.total === 'number' ? body.total : undefined)
    } catch {
      setError('미팅을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }, [queryKey, q, status, query.size])

  useEffect(() => { void load(false, null) }, [load])

  return (
    <>
      <FormErrorBanner message={startError} />

      <ListToolbar
        query={query}
        onChange={set}
        searchPlaceholder="제목·장소로 검색"
        views={['table', 'card']}
        filters={[STATUS_FILTER]}
        actions={(
          /**
           * **누르면 바로 작업대다.** 중간에 묻는 화면이 없다.
           *
           * 예전엔 `/crm/meetings/new` 로 보내 제목·시각·회사·딜을 묻고 진입 방식을 고르게 했다.
           * 그런데 그 화면이 하던 일은 전부 작업대가 이미 할 수 있는 것이다 —
           * 녹음·직접 쓰기·붙여넣기는 `MeetingWorkbench` 안에 있고 나머지는 상세의 "이 미팅은"이다.
           * 회의 중에 화면이 두 번 갈아엎히면 사용자는 기록을 놓친다(사용자 지시 2026-08-24).
           */
          <>
            <NbButton variant="ghost" onClick={() => setPickingNote(true)} disabled={starting}>
              <NotebookPen size={16} /> 회의노트에서 가져오기
            </NbButton>
            <NbButton onClick={() => void begin()} disabled={starting}>
              <Plus size={16} /> {starting ? '여는 중…' : '미팅 기록'}
            </NbButton>
          </>
        )}
      />

      <ListSurface
        rows={rows}
        columns={COLUMNS}
        query={query}
        onChange={set}
        rowKey={(m) => m.id}
        rowHref={(m) => `/crm/meetings/${m.id}`}
        loading={loading && rows.length === 0}
        error={error ? { message: error, onRetry: () => void load(false, null) } : null}
        empty={{
          title: q || status ? '조건에 맞는 미팅이 없어요' : '기록된 미팅이 아직 없어요',
          description: q || status
            ? '검색어나 상태를 바꿔 보세요.'
            : '미팅을 기록하고 전사를 붙여넣으면, AI가 누가 나왔고 무엇이 걸림돌인지 뽑아 인박스로 보냅니다.',
          action: q || status ? undefined : { label: '미팅 기록하기', onClick: () => void begin() },
        }}
      />

      {pickingNote && (
        <NbModal title="회의노트에서 가져오기" onClose={() => setPickingNote(false)}>
          <p style={{ ...FAINT, marginTop: 0, fontSize: 'var(--fs-sm)' }}>
            내가 쓴 회의노트를 영업 CRM에 올립니다. 회의 내용과 요약이 함께 넘어와요.
          </p>
          {notes === null ? (
            <AXDotLoader />
          ) : notes.length === 0 ? (
            <EmptyState
              title="가져올 회의노트가 없어요"
              description="회의노트에 먼저 기록하면 여기서 고를 수 있습니다."
              icon={<NotebookPen size={28} />}
            />
          ) : (
            <ul className={notePick.noteList}>
              {notes.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    className={notePick.noteItem}
                    onClick={() => void publishNote(n.id)}
                    disabled={starting}
                  >
                    <span className={notePick.noteTitle}>{n.title || '(제목 없음)'}</span>
                    <span className={notePick.noteMeta}>
                      {n.meetingAt ? formatKstDateTimeShort(n.meetingAt) : '일시 미지정'}
                    </span>
                    {/* 이미 올린 것을 숨기지 않는다 — 숨기면 "분명 있었는데"가 된다 */}
                    {n.published && <NbBadge status="done">올라감</NbBadge>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </NbModal>
      )}

      <ListPager
        query={query}
        total={total}
        loaded={rows.length}
        hasMore={Boolean(cursor)}
        loading={loading}
        onChange={() => void load(true, cursor)}
      />
    </>
  )
}
