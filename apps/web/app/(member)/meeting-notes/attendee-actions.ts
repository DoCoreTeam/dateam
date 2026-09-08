'use server'

/**
 * 지난 회의에서 사람 찾기 — 훑고, 고른 것만 반영한다.
 *
 * 자동으로 담지 않는다(§5-3 추출/제안형). 동명이인과 이름 아닌 것이 섞여 있어
 * 자동 반영은 그 자체가 사고다 — 실측으로 「수원시 주무관 2명」과
 * 「김경수」(CRM 은 쉐어월드 대표, 회의는 한국수자원공사 대리)가 함께 들어 있었다.
 */

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { sweepAttendees, planApply, collectLinked, type SweepNote, type SweepRow, type LinkedRow } from '@/lib/meeting/attendee-sweep'
import { loadAttendeeCandidates, SWEEP_CANDIDATE_LIMIT } from '@/lib/crm/link/candidates'
import { failedTo } from '@/lib/terms'

export interface SweepView {
  link: SweepRow[]
  review: SweepRow[]
  drop: SweepRow[]
  /**
   * 이미 이어 둔 사람 — 풀 수 있으려면 먼저 보여야 한다.
   * 후보 3층과 달리 **고르는 대상이 아니다**(체크박스가 아니라 해제 버튼이다).
   */
  linked: LinkedRow[]
  noteCount: number
  /** CRM 을 못 봤을 때 — 화면이 「없다」와 「못 봤다」를 구분해 말할 수 있어야 한다 */
  crmAvailable: boolean
  /** 후보가 상한에 걸려 일부만 봤는가 — 자른 것을 조용히 넘기면 같은 사람이 한 벌 더 생긴다 */
  candidatesTruncated: boolean
}

/** 조직원 이름 — 이미 다른 길로 이어져 있으므로 후보에서 뺀다 */
async function loadMemberNames(): Promise<string[]> {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase.from('profiles') as any).select('name').limit(500)
  return ((data ?? []) as { name: string | null }[]).map((r) => r.name).filter((n): n is string => !!n)
}

export async function sweepMyNotes(): Promise<{ ok: true; view: SweepView } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: '인증이 필요합니다.' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from('meeting_notes') as any)
    .select('id, title, meeting_at, attendees, attendee_person_ids')
    .is('deleted_at', null)
    .not('attendees', 'is', null)
    .order('meeting_at', { ascending: false, nullsFirst: false })
    .limit(200)

  if (error) return { ok: false, error: '회의노트를 불러오지 못했습니다.' }

  const [candidates, memberNames] = await Promise.all([
    // 훑기는 코드가 대조하므로 화면 검색(200)보다 넓게 본다 — 자르면 있는 사람을 없다고 판정한다
    loadAttendeeCandidates(undefined, SWEEP_CANDIDATE_LIMIT),
    loadMemberNames(),
  ])

  const notes: SweepNote[] = ((data ?? []) as {
    id: string; title: string; meeting_at: string | null
    attendees: string[] | null; attendee_person_ids: string[] | null
  }[]).map((n) => ({
    id: n.id,
    title: n.title,
    meetingAt: n.meeting_at,
    attendees: n.attendees ?? [],
    linkedPersonIds: n.attendee_person_ids ?? [],
    memberNames,
  }))

  const result = sweepAttendees(notes, candidates)
  return {
    ok: true,
    view: {
      ...result,
      linked: collectLinked(notes, candidates.people),
      crmAvailable: candidates.people.length > 0 || candidates.companies.length > 0,
      candidatesTruncated: candidates.truncated,
    },
  }
}

export interface ApplyResult {
  ok: boolean
  linked: number
  created: number
  error?: string
  /** 못 담은 것 — 조용히 넘어가지 않는다 */
  failed: { name: string; reason: string }[]
}

/**
 * 고른 것을 반영한다.
 *
 * 인물을 먼저 만들고 **그 다음** 회의노트에 잇는다 — 순서를 바꾸면
 * 인물 생성이 실패했을 때 없는 id 가 노트에 박힌다.
 */
export async function applyAttendeeLinks(chosenKeys: string[]): Promise<ApplyResult> {
  const empty: ApplyResult = { ok: true, linked: 0, created: 0, failed: [] }
  if (chosenKeys.length === 0) return empty

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ...empty, ok: false, error: '인증이 필요합니다.' }

  const swept = await sweepMyNotes()
  if (!swept.ok) return { ...empty, ok: false, error: swept.error }

  const rows = [...swept.view.link, ...swept.view.review]
  const plan = planApply(rows, chosenKeys)

  const { resolveCrmWorkspaceId } = await import('@/lib/crm/workspace')
  const { createPerson } = await import('@/lib/crm/services/person')
  const workspaceId = resolveCrmWorkspaceId()

  const failed: ApplyResult['failed'] = []
  /** noteId → 붙일 인물 id들 */
  const toLink = new Map<string, string[]>()
  const push = (noteIds: string[], personId: string) => {
    for (const id of noteIds) toLink.set(id, [...(toLink.get(id) ?? []), personId])
  }

  for (const it of plan.linkExisting) push(it.noteIds, it.personId)

  let created = 0
  for (const it of plan.createAndLink) {
    try {
      const person = await createPerson(workspaceId, null, {
        name: it.name,
        title: it.title,
        companyId: it.companyId,
      })
      created += 1
      push(it.noteIds, person.id)
    } catch (e) {
      // 한 명이 실패해도 나머지는 담는다. 대신 무엇이 안 됐는지 밝힌다
      failed.push({ name: it.name, reason: e instanceof Error ? e.message : '인물을 만들지 못했습니다.' })
    }
  }

  let linked = 0
  for (const [noteId, personIds] of Array.from(toLink.entries())) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: cur } = await (supabase.from('meeting_notes') as any)
        .select('attendee_person_ids').eq('id', noteId).single()
      const prev: string[] = cur?.attendee_person_ids ?? []
      const next = Array.from(new Set([...prev, ...personIds]))

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from('meeting_notes') as any)
        .update({ attendee_person_ids: next }).eq('id', noteId)
      // supabase-js 는 오류를 던지지 않고 돌려준다 — 검사하지 않으면 조용히 0건이 된다
      if (error) { failed.push({ name: noteId, reason: '회의노트에 잇지 못했습니다.' }); continue }
      linked += personIds.length
    } catch {
      failed.push({ name: noteId, reason: '회의노트에 잇지 못했습니다.' })
    }
  }

  revalidatePath('/meeting-notes')
  return { ok: true, linked, created, failed }
}

export interface UnlinkResult {
  ok: boolean
  /** 실제로 연결이 끊긴 회의 수 */
  removed: number
  error?: string
}

/**
 * 이어 둔 인물을 회의노트에서 뗀다 (D).
 *
 * **인물은 지우지 않는다.** 여기서 지우는 것은 「이 회의에 그 사람이 있었다」는 연결뿐이고,
 * CRM 인물은 그대로 남는다 — 그래서 되돌릴 수 있다(다시 이으면 된다).
 * 인물 자체를 지우는 일은 인물 화면의 몫이다(`/crm/people/{id}`) — 지우는 자리가 둘이면
 * 한쪽만 고쳐지고 그때부터 서로 다른 규칙이 된다.
 *
 * 참석자 **이름 글자**(`attendees`)도 건드리지 않는다. 잇기가 그것을 안 건드렸으므로
 * 해제도 안 건드린다 — 그래야 해제한 이름이 다시 후보로 올라와 완전히 되돌아간다.
 */
export async function unlinkAttendeePerson(personId: string, noteIds: string[]): Promise<UnlinkResult> {
  const id = personId.trim()
  if (!id || noteIds.length === 0) return { ok: false, removed: 0, error: '해제할 대상이 없습니다.' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, removed: 0, error: '인증이 필요합니다.' }

  let removed = 0
  for (const noteId of noteIds.slice(0, 200)) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: cur, error: readErr } = await (supabase.from('meeting_notes') as any)
        .select('attendee_person_ids').eq('id', noteId).single()
      if (readErr || !cur) continue

      const prev: string[] = cur.attendee_person_ids ?? []
      if (!prev.includes(id)) continue
      const next = prev.filter((p) => p !== id)

      /**
       * `select('id')` 로 **몇 줄이 실제로 바뀌었는지** 받는다.
       * RLS 로 막히면 supabase-js 는 오류 없이 0줄을 돌려준다 —
       * 세지 않으면 「해제했어요」라고 말해 놓고 아무것도 안 바뀐다.
       */
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: hit, error } = await (supabase.from('meeting_notes') as any)
        .update({ attendee_person_ids: next.length > 0 ? next : null })
        .eq('id', noteId)
        .select('id')
      if (error || !hit || hit.length === 0) continue
      removed += 1
    } catch {
      // 한 건이 안 돼도 나머지는 시도한다. 결과는 removed 로 정직하게 돌려준다
      continue
    }
  }

  if (removed === 0) return { ok: false, removed: 0, error: failedTo('연결', '해제하지') }

  revalidatePath('/meeting-notes')
  return { ok: true, removed }
}
