import { notFound } from 'next/navigation'
import { getRequestUser } from '@/lib/supabase/server'
import { loadCrmFactsForNote, type NoteCrmFacts } from '@/lib/crm/services/meeting-publish'
import { getMeetingNote, listOrgPeople } from '../actions'
import MeetingDetailClient from '../MeetingDetailClient'
import type { MeetingNoteRecord } from '../MeetingDetailClient'

export const dynamic = 'force-dynamic'

export default async function MeetingNoteDetailPage({ params }: { params: { id: string } }) {
  let note: MeetingNoteRecord | null = null
  try {
    note = (await getMeetingNote(params.id)) as MeetingNoteRecord | null
  } catch {
    note = null
  }

  if (!note) notFound()

  // 참석자 매칭/추가 드롭다운용 조직원 목록(서버에서 주입)
  const people = await listOrgPeople().catch(() => [])

  /**
   * 이 회의가 영업 CRM 에서 어떤 건으로 잡혀 있나 — 회사·딜·장소.
   *
   * 같은 회의인데 CRM 만 「코나아이」를 알고 노트는 몰랐다(사용자 지적 2026-08-31).
   * 창구는 최소로 열려 있다 — 내 노트에 붙은 한 건, 이름만(§loadCrmFactsForNote).
   * CRM 멤버가 아니거나 아직 안 올린 회의면 null 이고, 화면은 그 줄을 안 그린다.
   */
  let crm: NoteCrmFacts | null = null
  const user = await getRequestUser()
  if (user) crm = await loadCrmFactsForNote(note.id, user.id)

  return <MeetingDetailClient note={note} people={people} crm={crm} />
}
