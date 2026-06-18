import { notFound } from 'next/navigation'
import { getMeetingNote } from '../actions'
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

  return <MeetingDetailClient note={note} />
}
