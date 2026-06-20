import { notFound } from 'next/navigation'
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

  return <MeetingDetailClient note={note} people={people} />
}
