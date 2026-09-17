'use client'

import { useMemo, useState, useTransition } from 'react'
import { noteStatusMeta } from '@/lib/meeting/ui/note-status'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Pencil, Trash2, CalendarClock, Users, Mic, Briefcase } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import NbButton from '@/components/ui/nb/NbButton'
import InlineError from '@/components/ui/InlineError'
import { ACTION, failedTo, NOTE_INFO_LABEL } from '@/lib/terms'
import MeetingEditor from './MeetingEditor'
import MeetingReadBody from './MeetingReadBody'
import CrmPublishCard from './CrmPublishCard'
import MeetingWorkbench from '@/components/meeting/MeetingWorkbench'
import { deleteMeetingNote } from './actions'

export interface MeetingNoteRecord {
  id: string
  title: string
  meeting_at: string | null
  status: string
  attendees: string | null
  attendee_user_ids: string[] | null
  attendee_person_ids?: string[] | null
  department_id: string | null
  tags: string[] | null
  body: string | null // HTML
  body_plain: string | null
  summary: string | null
  decisions: string | null
  created_at: string
  /** 공개 범위 — 작업대가 "나만 보기 / 영업팀 공개" 스위치를 그린다(마이그 216) */
  visibility?: 'private' | 'crm'
}


function formatMeetingAt(value: string | null): string {
  if (!value) return '일시 미지정'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '일시 미지정'
  return d.toLocaleString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function splitAttendees(raw: string | null): string[] {
  if (!raw) return []
  return raw.split(',').map((s) => s.trim()).filter(Boolean)
}

/**
 * 붙은 CRM 미팅의 사실. 서버가 준다(`loadCrmFactsForNote`).
 * 이름만 온다 — 금액·단계는 여기로 넘어오지 않는다(권한 경계).
 */
export interface NoteCrmFactsView {
  meetingId: string
  companyId: string | null
  companyName: string | null
  dealId: string | null
  dealName: string | null
  location: string | null
}

export default function MeetingDetailClient({ note, people, crm }: { note: MeetingNoteRecord; people: { id: string; name: string }[]; crm?: NoteCrmFactsView | null }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [deleting, startDelete] = useTransition()
  const autoAnalyze = useSearchParams().get('analyze') === '1'

  /**
   * **본문을 쓰는 길은 이제 하나다**(v0.10.98).
   *
   * 예전엔 둘이었다 — 작업대(자동저장 `PATCH`)와 이 폼(명시 저장). 작업대는 저장 뒤
   * `router.refresh()` 를 안 하므로 서버가 넘겨준 `note.body` 는 **페이지를 연 시점의 값**에
   * 머물고, 그 값으로 폼을 열어 저장하면 회의 중에 적은 글이 통째로 **옛 내용으로 덮였다.**
   * v0.7.677 은 그것을 «열기 전에 다시 읽기» 로 막았다 — 사고는 막았지만 길은 둘로 남았다.
   *
   * 이제 이 폼은 본문을 **보지도 보내지도 않는다**(`MeetingEditor` 의 `mode === 'edit'`).
   * 본문은 원문 카드 하나가 맡는다. 그래서 같은 「수정」이 둘이던 것도 함께 풀린다
   * (사용자 지적 2026-09-17: *"수정버튼이 상단에도 있고 여기도 있는데 정리가 필요할듯"*).
   *
   * 다시 읽는 것은 **남긴다.** 요약·결정사항은 아직 이 폼이 유일한 손인데, AI 정리가
   * 그 사이에 값을 바꿀 수 있다. 못 읽으면 열지 않는다 — 옛 값으로 덮는 것이 그 사고였다.
   */
  const [openingEditor, setOpeningEditor] = useState(false)
  const [openError, setOpenError] = useState<string | null>(null)
  const [fresh, setFresh] = useState<{ body: string; summary: string; decisions: string } | null>(null)

  async function openEditor() {
    setOpeningEditor(true)
    setOpenError(null)
    try {
      const res = await fetch(`/api/meeting-notes/${note.id}`)
      const b = await res.json().catch(() => null)
      if (!res.ok || !b) {
        setOpenError(failedTo('최신 내용', '불러오지'))
        return
      }
      setFresh({ body: b.bodyHtml ?? '', summary: b.summary ?? '', decisions: b.decisions ?? '' })
      setEditing(true)
    } catch {
      setOpenError(failedTo('최신 내용', '불러오지', '연결을 확인해 주세요.'))
    } finally {
      setOpeningEditor(false)
    }
  }

  const attendeeNames = useMemo(() => splitAttendees(note.attendees), [note.attendees])
  const userIds = useMemo(() => note.attendee_user_ids ?? [], [note.attendee_user_ids])

  // 읽기용 칩 분류: user_ids→조직원(indigo), 그 외 이름→외부(slate).
  const { memberChips, externalChips } = useMemo(() => {
    const byId = new Map(people.map((p) => [p.id, p.name] as const))
    const mem: { id: string; name: string }[] = []
    const memNames = new Set<string>()
    for (const id of userIds) {
      const name = byId.get(id)
      if (name) { mem.push({ id, name }); memNames.add(name) }
    }
    return { memberChips: mem, externalChips: attendeeNames.filter((n) => !memNames.has(n)) }
  }, [people, userIds, attendeeNames])

  function handleDelete() {
    if (!confirm(`회의노트 "${note.title || '(제목 없음)'}"을(를) 삭제하시겠습니까? 되돌릴 수 없습니다.`)) return
    startDelete(async () => {
      try {
        const res = await deleteMeetingNote(note.id)
        if (!res.ok) { alert(res.error); return }
        router.push('/meeting-notes')
        router.refresh()
      } catch {
        alert('삭제에 실패했습니다.')
      }
    })
  }

  if (editing && fresh) {
    return (
      <div>
        <PageHeader title={`회의노트 ${NOTE_INFO_LABEL} ${ACTION.edit}`} description="제목·일시·부서와 요약·결정사항·참석자·태그를 수정하세요. 원문은 아래 「원문」 카드에서 고칩니다" />
        <MeetingEditor
          mode="edit"
          onExit={() => setEditing(false)}
          initial={{
            id: note.id,
            title: note.title,
            meeting_at: note.meeting_at,
            department_id: note.department_id,
            tags: note.tags ?? [],
            /* 서버 렌더 값이 아니라 **방금 다시 읽은 값**이다 — 위 openEditor 주석 참조 */
            body: fresh.body,
            summary: fresh.summary,
            decisions: fresh.decisions,
            attendees: attendeeNames,
            attendeeUserIds: userIds,
            attendeePersonIds: note.attendee_person_ids ?? [],
          }}
        />
      </div>
    )
  }

  const meta = noteStatusMeta(note.status)
  const isEmptyAttendees = memberChips.length === 0 && externalChips.length === 0

  return (
    <div>
      <PageHeader
        back={{ href: '/meeting-notes', label: '회의노트 목록' }}
        title={note.title || '(제목 없음)'}
        /*
          공개 범위는 «이 기록의 속성»이라 제목에 붙는다(§2-3-2 L-1: 읽는 것 왼쪽).
          우측 `actions` 는 화면 전체에 대한 행동(수정·삭제) 자리라 여기가 아니다.
        */
        titleAfter={<CrmPublishCard noteId={note.id} visibility={note.visibility} />}
        actions={
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            {/* 「수정」이 아니라 「정보 수정」이다 — 원문 카드의 「수정」과 고치는 대상이 다르다 */}
            <NbButton onClick={() => void openEditor()} disabled={openingEditor} title="제목·일시·부서·참석자·태그를 고칩니다. 원문은 아래 「원문」 카드에서"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <Pencil size={15} /> {`${NOTE_INFO_LABEL} ${ACTION.edit}`}
            </NbButton>
            <NbButton variant="danger" onClick={handleDelete} disabled={deleting} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <Trash2 size={15} /> {deleting ? '삭제 중…' : '삭제'}
            </NbButton>
          </div>
        }
      />

      {/* 최신 내용을 못 읽어 편집을 못 연 경우 — 조용히 실패하면 «버튼이 안 눌린다»로만 보인다 */}
      {openError && (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <InlineError onDismiss={() => setOpenError(null)}>{openError}</InlineError>
        </div>
      )}

      {/* 메타 (읽기) */}
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-3)', marginBottom: 'var(--space-5)' }}>
        <span className="badge" data-status={meta.status}>{meta.label}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
          <CalendarClock size={14} color="var(--text-faint)" /> {formatMeetingAt(note.meeting_at)}
        </span>
        {note.tags && note.tags.length > 0 && (
          <span style={{ display: 'inline-flex', gap: 'var(--space-1)', flexWrap: 'wrap' }}>
            {note.tags.map((t) => <span key={t} className="badge badge-slate" style={{ fontSize: 'var(--fs-2xs)' }}>#{t}</span>)}
          </span>
        )}

        {/**
          * 영업 CRM 쪽 사실 — 회사·딜·장소.
          *
          * **왜 메타 줄에 얹나**: 이건 이 회의의 «속성»이다(§2-3-2 L-2 속성 → 관계 → 이력).
          * 그리고 회의 중에 폰으로 여는 화면이라, 카드를 하나 더 세우면 정작 적을 자리가
          * 스크롤 밖으로 나간다. 한 줄이면 접는 장치 없이도 본문이 밀리지 않는다.
          *
          * 안 올린 회의·CRM 멤버가 아닌 사람에게는 이 줄이 아예 없다 — 빈 칸을 만들지 않는다.
          */}
        {crm && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
            <Briefcase size={14} color="var(--text-faint)" />
            {crm.companyName
              ? <Link href={`/crm/companies/${crm.companyId}`} style={{ color: 'var(--brand)' }}>{crm.companyName}</Link>
              : <span style={{ color: 'var(--text-faint)' }}>회사 미정</span>}
            {crm.dealName && (
              <>
                <span aria-hidden>·</span>
                <Link href={`/crm/deals/${crm.dealId}`} style={{ color: 'var(--brand)' }}>{crm.dealName}</Link>
              </>
            )}
            {crm.location && <><span aria-hidden>·</span><span>{crm.location}</span></>}
            <span aria-hidden>·</span>
            <Link href={`/crm/meetings/${crm.meetingId}`} style={{ color: 'var(--brand)' }}>영업 CRM에서 보기</Link>
          </span>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
        {/* 참석자(읽기 전용 chips) — 고치는 곳은 [정보 수정] 폼이다.
            본문보다 **위**에 둔다: 회의록은 "누가 있었나"를 알고 내용을 읽는 문서다.
            내보내는 문서 서식도 표제 → 메타(일시·작성자·참석자) → 본문 순이다
            (lib/meeting/export-html.ts). 화면만 참석자를 맨 아래 두면 같은 회의록이
            보는 곳마다 다른 순서가 된다. */}
        <section className="card" style={{ padding: 'var(--space-5) var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }} aria-labelledby="mn-att-h">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <Users size={16} color="var(--brand)" />
            <h2 id="mn-att-h" className="tape-title" style={{ margin: 0 }}>참석자</h2>
          </div>
          {isEmptyAttendees ? (
            <p style={{ margin: 0, color: 'var(--text-faint)', fontSize: 'var(--fs-sm)' }}>{`등록된 참석자가 없습니다. 위 [${NOTE_INFO_LABEL} ${ACTION.edit}]에서 추가하세요.`}</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
              {memberChips.map((m) => (
                <li key={`mem-${m.id}`}><span className="badge badge-indigo">{m.name}</span></li>
              ))}
              {externalChips.map((name) => (
                <li key={`ext-${name}`}><span className="badge badge-slate">{name}</span></li>
              ))}
            </ul>
          )}
        </section>
        {/* 회의 작업대 — 쓰기·녹음·전사·정리를 한 자리에서.
            CRM 미팅 화면(/crm/meetings/[id])이 **같은 부품**을 쓴다 — 가운데가 같아야
            "같은 플랫폼을 공유"가 성립한다(사용자 지시 2026-08-24). */}
        <MeetingWorkbench
          noteId={note.id}
          title={note.title}
          href={`/meeting-notes/${note.id}`}
          /* 공개 범위는 아래 카드 하나가 정한다 — 두 곳에서 정하면 서로를 모른다 */
          showVisibility={false}
        />

        {/**
          * **읽을 본문이 있을 때만 그린다.**
          *
          * 예전엔 늘 그렸다. 그런데 이 카드의 버튼은 전부 `hasBody &&` 안에 있고
          * `actionsOnly` 라 탭·본문도 안 그리므로, 본문이 비면 **제목만 남은 빈 상자**가 됐다
          * (사용자 지적 2026-08-24: "AI로 뽑기는 어떻게? 쓰는거야?").
          * 못 하는 일은 누르기 전에 안 보이는 것이 이 저장소의 방식이다.
          */}
        {(note.body_plain ?? '').trim().length > 0 && (
        <MeetingReadBody
          meetingNoteId={note.id}
          body={note.body}
          bodyPlain={note.body_plain ?? ''}
          initialSummary={note.summary ?? ''}
          initialDecisions={note.decisions ?? ''}
          people={people}
          currentAttendees={attendeeNames}
          currentUserIds={userIds}
          autoAnalyze={autoAnalyze}
          actionsOnly
        />
        )}

        {/* 영업 CRM 연결 — 이 회의가 고객사 건일 때만 쓴다.
            CRM 멤버가 아니면 카드 자체가 안 보인다(못 쓰는 버튼을 보여 주지 않는다).
            본문 아래에 두는 이유: 회의록을 읽고 나서 "이건 영업 건이네"를 판단하는 순서다. */}
      </div>
    </div>
  )
}
