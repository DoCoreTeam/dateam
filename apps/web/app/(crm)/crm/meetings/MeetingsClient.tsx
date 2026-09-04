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

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Mic, Plus, NotebookPen } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import { ACTION, progress } from '@/lib/terms'
import NbModal from '@/components/ui/nb/NbModal'
import AXDotLoader from '@/components/ui/AXDotLoader'
import EmptyState from '@/components/ui/EmptyState'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import ListToolbar from '@/components/ui/list/ListToolbar'
import { SHARE_STATE_LABEL, SHARE_STATE_STATUS, type MeetingShareState } from '@/lib/meeting/share-state'
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
  /**
   * 팀에게 어디까지 보이나. 아래 `noteOnly` 와 함께 «가져오기 버튼»을 대신한다.
   * 서버가 목록과 함께 준다 — 건당 다시 물으면 노트 수만큼 왕복이 생긴다(N+1).
   */
  shareState?: MeetingShareState
  /**
   * 아직 CRM 에 안 올린 **내 회의노트**. 목록에는 서지만 미팅 행이 아니다 —
   * 누르면 CRM 미팅이 아니라 원본 회의노트로 간다(없는 미팅으로 보내면 404 다).
   */
  noteOnly?: boolean
}

/**
 * 내가 쓴 회의노트 한 건.
 *
 * 왜 목록에 함께 서나(사용자 지적 v0.7.686):
 *   *"왜 회의노트에 기록한걸 CRM에서는 가져오기 버튼으로 해야 하는지?
 *     내가 쓴거니깐 두개 동시에 보이고 현재 공개 상태만 표시 해주면 되는거 아냐?"*
 * 맞는 말이다. 「가져오기」가 필요했던 이유는 회의노트와 CRM 미팅이 **두 벌의 기록**이라
 * 사본을 떠야 했기 때문이지, 사용자가 원해서가 아니었다.
 */
interface PickableNote {
  id: string
  title: string | null
  meetingAt: string | null
  published: boolean
  shareState: MeetingShareState
}


const FAINT = { color: 'var(--text-faint)' }

/** 목록에서 «누가 볼 수 있나»를 한 글자로. 말과 색은 SSOT 가 정한다(§0-2) */
function ShareBadge({ state }: { state: MeetingShareState }) {
  return (
    <span style={{ marginLeft: 'var(--space-2)' }}>
      <NbBadge status={SHARE_STATE_STATUS[state]}>{SHARE_STATE_LABEL[state]}</NbBadge>
    </span>
  )
}

/**
 * 컬럼을 **함수로** 만든다 — 배지가 「올리기」를 눌러야 해서 화면의 상태가 필요하다.
 * 모듈 상수로 두면 그 손잡이를 못 잡는다.
 */
const makeColumns = (setPublishing: (noteId: string | null) => void): ColumnDef<Meeting>[] => [
  {
    key: 'title',
    header: '미팅',
    primary: true,
    cell: (m) => (
      <>
        <span>{m.title}</span>
        {/*
          팀에게 어디까지 보이는지 **목록에서** 밝힌다.
          예전엔 「회의노트」라는 회색 글씨뿐이라 «누가 볼 수 있나»를 알 길이 없었고,
          안 올린 노트는 아예 이 목록에 없어서 「가져오기」 버튼을 눌러야 했다(v0.7.686).
        */}
        {m.shareState && (
          m.noteOnly
            ? (
              /*
                안 올린 내 노트 — 배지가 곧 「올리기」다. 이게 「가져오기」 버튼을 대신한다.
                행 클릭(상세 이동)과 겹치므로 전파를 막는다(§2-3-1 (1) 액션 칸 규칙).
              */
              <span onClick={(e) => { e.preventDefault(); e.stopPropagation() }}>
                <button type="button" className="badge-btn" onClick={() => setPublishing(m.noteId)}
                  title="눌러서 영업팀에 공개합니다">
                  <ShareBadge state={m.shareState} />
                </button>
              </span>
            )
            : <ShareBadge state={m.shareState} />
        )}
        {m.noteId && !m.shareState && <span style={{ ...FAINT, marginLeft: 'var(--space-2)' }}>회의노트</span>}
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
  /** 올리기 확인을 기다리는 노트 id. 되돌릴 수는 있지만 팀이 보게 되는 일이라 한 번 묻는다 */
  const [publishing, setPublishing] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
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
      const res = await fetch(`/api/crm/meetings/notes?limit=50${q ? `&q=${encodeURIComponent(q)}` : ''}`)
      const body = await res.json()
      setNotes(res.ok ? (body.items ?? []) : [])
    } catch {
      setNotes([])
    }
  }, [q])

  /*
    내 노트는 **언제나** 읽는다 — 예전엔 「가져오기」 모달을 열 때만 읽었다.
    이제 목록에 함께 서므로 첫 화면부터 필요하다.
  */
  useEffect(() => { void loadNotes() }, [loadNotes])


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
      /*
        올린 뒤 **목록을 다시 읽는다.** 예전엔 미팅 상세로 이동했는데,
        사용자가 한 것은 「공개 범위 바꾸기」이지 「그 미팅 열기」가 아니다 —
        그 자리에서 배지가 바뀌는 것이 기대하는 결과다.
      */
      setPublishing(null)
      await Promise.all([loadNotes(), load(false, null)])
      setStarting(false)
    } catch {
      setStartError('회의노트를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.')
      setStarting(false)
    }
  }, [loadNotes, load])

  useEffect(() => { void load(false, null) }, [load])

  /**
   * 올라간 미팅 + **아직 안 올린 내 회의노트**를 한 목록으로.
   *
   * 이미 올린 노트는 넣지 않는다 — 그 건은 이미 미팅 행으로 서 있어서, 넣으면 같은 회의가
   * 목록에 두 번 나온다. 그게 바로 이 변경이 없애려는 상태다.
   *
   * 안 올린 노트는 **첫 페이지에만** 선다(커서로 더 불러올 때는 미팅만 이어진다) —
   * 내 노트는 내가 쓴 만큼이라 수가 적고, 페이지마다 다시 끼우면 같은 줄이 여러 페이지에 겹친다.
   */
  const columns = useMemo(() => makeColumns(setPublishing), [])

  const merged = useMemo(() => {
    const unpublished = (notes ?? [])
      .filter((n) => !n.published)
      .map((n): Meeting => ({
        id: n.id, title: n.title || '(제목 없음)',
        startedAt: n.meetingAt ?? '', companyId: null, dealId: null, location: null,
        summaryMd: null, noteId: n.id, companyName: null, dealName: null,
        statusKey: 'draft' as MeetingStatusKey,
        shareState: n.shareState, noteOnly: true,
      }))
    if (unpublished.length === 0) return rows
    return [...unpublished, ...rows].sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''))
  }, [rows, notes])

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
            {/*
              「회의노트에서 가져오기」는 없앴다(v0.7.686). 내가 쓴 노트는 **이미 아래 목록에 있고**,
              공개 범위는 그 행의 배지로 바꾼다. 버튼으로 «가져오는» 동작이 필요했던 이유는
              기록이 두 벌이었기 때문이지 사용자가 원해서가 아니었다.
            */}
            <NbButton onClick={() => void begin()} disabled={starting}>
              <Plus size={16} /> {starting ? '여는 중…' : '미팅 기록'}
            </NbButton>
          </>
        )}
      />

      <ListSurface
        rows={merged}
        columns={columns}
        query={query}
        onChange={set}
        rowKey={(m) => m.id}
        /* 안 올린 노트는 CRM 미팅이 아니다 — 없는 미팅으로 보내면 404 다 */
        rowHref={(m) => (m.noteOnly ? `/meeting-notes/${m.noteId}` : `/crm/meetings/${m.id}`)}
        loading={loading && merged.length === 0}
        error={error ? { message: error, onRetry: () => void load(false, null) } : null}
        empty={{
          title: q || status ? '조건에 맞는 미팅이 없어요' : '기록된 미팅이 아직 없어요',
          description: q || status
            ? '검색어나 상태를 바꿔 보세요.'
            : '미팅을 기록하고 전사를 붙여넣으면, AI가 누가 나왔고 무엇이 걸림돌인지 뽑아 인박스로 보냅니다.',
          action: q || status ? undefined : { label: '미팅 기록하기', onClick: () => void begin() },
        }}
      />


      <ListPager
        query={query}
        total={total}
        loaded={rows.length}
        hasMore={Boolean(cursor)}
        loading={loading}
        onChange={() => void load(true, cursor)}
      />

      {/* 팀이 보게 되는 일이라 한 번 묻는다. 되돌릴 수 있다는 것도 함께 말한다 */}
      {publishing && (
        <NbModal title="영업팀에 공개할까요?" onClose={() => setPublishing(null)}>
          <p style={{ ...FAINT, marginTop: 0, fontSize: 'var(--fs-sm)' }}>
            이 회의의 제목·요약·받아적은 내용이 <strong>영업 CRM 멤버에게 보입니다.</strong>{' '}
            고치거나 지우는 건 계속 나만 할 수 있어요.
            <br /><br />
            나중에 배지를 눌러 <strong>「{SHARE_STATE_LABEL.PRIVATE}」로 되돌릴 수 있습니다.</strong>
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}>
            <NbButton variant="ghost" onClick={() => setPublishing(null)}>{ACTION.cancel}</NbButton>
            <NbButton onClick={() => void publishNote(publishing)} disabled={starting}>
              {starting ? progress('올리기') : '영업팀에 공개'}
            </NbButton>
          </div>
        </NbModal>
      )}
    </>
  )
}
