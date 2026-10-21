'use client'

/**
 * 옆 패널의 「다른 기록」 — 회의를 띄워 둔 채 지난 기록을 읽는다.
 *
 * 사용자 지적(2026-10-21): 녹음하며 다른 미팅 기록을 보려면 새 탭을 열어야 했다.
 *
 * 목록은 이미 있는 두 창구만 부른다 — 회의노트 목록(`listMeetingNotes`, 내가 쓴 것)과
 * CRM 미팅 목록(같은 회사). 연 기록은 **읽기 전용**이다. 녹음 중인 회의와 헷갈려 남의 기록에
 * 적는 사고를 막으려고 고치는 단추를 두지 않고, 고치려면 「따로 열기」로 그 화면에 간다.
 */

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, ExternalLink, Plus, Search } from 'lucide-react'
import AXDotLoader from '@/components/ui/AXDotLoader'
import InlineError from '@/components/ui/InlineError'
import EmptyState from '@/components/ui/EmptyState'
import NbButton from '@/components/ui/nb/NbButton'
import { ACTION } from '@/lib/terms'
import { listMeetingNotes } from '@/app/(member)/meeting-notes/actions'
import { useMeetingMode } from '@/lib/crm/ui/meeting-mode'
import { formatKstDateTimeShort } from '@/lib/datetime/kst'
import {
  PEEK_PARAM, orderOtherRecords, summaryLines,
  type CrmMeetingRow, type NoteRow, type OtherRecord,
} from '@/lib/meeting/side-panel'
import MeetingDigestPanel from './MeetingDigestPanel'
import styles from './side-panel.module.css'

interface Props {
  noteId: string
  /** 한 줄을 지금 메모 끝에 붙인다. 고칠 수 없는 사람에게는 없다 */
  onPickLine?: (text: string) => void
}

/** 지금 회의가 걸린 CRM 미팅의 회사. CRM 을 못 쓰는 사람이면 null — 회의노트만 보인다 */
async function loadCompanyId(noteId: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/crm/meetings?noteId=${encodeURIComponent(noteId)}`)
    if (!res.ok) return null
    const body = await res.json()
    return (body?.items?.[0]?.companyId as string | null) ?? null
  } catch {
    return null
  }
}

async function loadCrm(companyId: string | null, q: string): Promise<CrmMeetingRow[]> {
  const params = new URLSearchParams({ limit: '20' })
  if (companyId && !q) params.set('companyId', companyId)
  if (q) params.set('q', q)
  try {
    const res = await fetch(`/api/crm/meetings?${params}`)
    if (!res.ok) return []
    const body = await res.json()
    return (body?.items ?? []) as CrmMeetingRow[]
  } catch {
    return []
  }
}

export default function OtherRecords({ noteId, onPickLine }: Props) {
  const router = useRouter()
  const sp = useSearchParams()
  const peekKey = sp.get(PEEK_PARAM)
  const { on: meetingMode } = useMeetingMode()

  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<OtherRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const companyId = await loadCompanyId(noteId)
      const [crm, notes] = await Promise.all([
        loadCrm(companyId, query),
        listMeetingNotes({ q: query, limit: 20 }).then((r) => r.items as NoteRow[]),
      ])
      setRows(orderOtherRecords({ notes, crmMeetings: crm, currentNoteId: noteId, companyId, meetingMode }))
    } catch {
      setRows([])
      setError('기록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')
    }
  }, [noteId, query, meetingMode])

  useEffect(() => { void load() }, [load])

  const setPeek = (key: string | null) => {
    const url = new URL(window.location.href)
    if (key) url.searchParams.set(PEEK_PARAM, key)
    else url.searchParams.delete(PEEK_PARAM)
    // 연 기록은 쌓는다 — 뒤로 가기가 목록으로 돌아오게
    if (key) router.push(`${url.pathname}${url.search}`, { scroll: false })
    else router.replace(`${url.pathname}${url.search}`, { scroll: false })
  }

  const opened = peekKey ? rows?.find((r) => r.key === peekKey) ?? null : null
  if (opened) return <OpenedRecord record={opened} onBack={() => setPeek(null)} onPickLine={onPickLine} />

  return (
    <div className={styles.records}>
      <form
        className={styles.search}
        role="search"
        onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()) }}
      >
        <Search size={14} aria-hidden />
        <input
          id="side-records-q"
          className="input-field"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="회사·제목·내용으로 찾기"
          aria-label="다른 기록 찾기"
        />
      </form>
      {meetingMode && <p className={styles.hint}>회의 모드라 같은 회사 기록만 보여요.</p>}
      {/* 실패는 빈 목록과 다른 상태다 — 「기록이 없어요」를 같이 그리지 않는다(U-N) */}
      {error ? (
        <>
          <InlineError spaced>{error}</InlineError>
          <NbButton variant="ghost" onClick={() => { setRows(null); void load() }}>{ACTION.retry}</NbButton>
        </>
      ) : rows === null ? <AXDotLoader /> : rows.length === 0 ? (
        query
          ? <EmptyState title="찾는 기록이 없어요" action={{ label: `검색어 ${ACTION.clear}`, onClick: () => { setQ(''); setQuery('') } }} />
          : <EmptyState title="볼 수 있는 다른 기록이 없어요" />
      ) : (
        <ul className={styles.recordList}>
          {rows.map((r, i) => (
            <li key={r.key}>
              {/* 같은 회사 묶음이 끝나는 자리에 말을 단다 — 같은 회사가 먼저라는 것을 화면이 보여 준다 */}
              {i === 0 && r.sameCompany && <p className={styles.groupLabel}>{r.companyName ?? '같은 회사'}</p>}
              {r.sameCompany === false && (i === 0 || rows[i - 1].sameCompany) && rows.some((x) => x.sameCompany) && (
                <p className={styles.groupLabel}>다른 기록</p>
              )}
              <button type="button" className={styles.recordRow} onClick={() => setPeek(r.key)}>
                <span className={styles.recordTitle}>{r.title}</span>
                <span className={styles.recordMeta}>
                  {formatKstDateTimeShort(r.at)}{r.companyName && !r.sameCompany ? ` · ${r.companyName}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function OpenedRecord({ record, onBack, onPickLine }: {
  record: OtherRecord
  onBack: () => void
  onPickLine?: (text: string) => void
}) {
  const lines = record.noteId ? [] : summaryLines(record.summary)
  const href = record.key.startsWith('crm:') ? `/crm/meetings/${record.key.slice(4)}` : `/meeting-notes/${record.noteId}`
  return (
    <div className={styles.records}>
      <div className={styles.openedHead}>
        <button type="button" className={styles.back} onClick={onBack}>
          <ArrowLeft size={14} aria-hidden /> 목록
        </button>
        {/* 고치려면 그 화면으로 — 이 패널에서는 읽기만 한다. 녹음 중인 지금 탭을 떠나지 않게 새 탭으로 */}
        <a className={styles.back} href={href} target="_blank" rel="noopener noreferrer">
          따로 열기 <ExternalLink size={13} aria-hidden />
        </a>
      </div>
      <h3 className={styles.openedTitle}>{record.title}</h3>
      <p className={styles.recordMeta}>{formatKstDateTimeShort(record.at)}{record.companyName ? ` · ${record.companyName}` : ''}</p>
      {record.noteId ? (
        <MeetingDigestPanel noteId={record.noteId} canEdit={false} />
      ) : lines.length === 0 ? (
        <EmptyState title="정리된 내용이 없어요" />
      ) : (
        <ul className={styles.lineList}>
          {lines.map((l, i) => (
            <li key={i} className={styles.line}>
              <span>{l}</span>
              {onPickLine && (
                <button type="button" className={styles.pick} onClick={() => onPickLine(l)} aria-label={`메모에 붙이기: ${l}`}>
                  <Plus size={12} aria-hidden /> 메모에
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
