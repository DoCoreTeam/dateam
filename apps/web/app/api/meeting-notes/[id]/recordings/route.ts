// POST /api/meeting-notes/:id/recordings — 녹음 10분 구간 하나를 올린다
// GET  /api/meeting-notes/:id/recordings — 이 회의의 구간·진행 상태
//
// 서명 URL 이 필요 없다: 10분 구간은 2~3MB 라 Vercel 본문 4.5MB 한도를 통과한다.
// 전체 파일을 한 번에 올리는 경로가 아니라 **구간 단위**여서 가능한 단순함이다.
//
// 올린 직후 전사를 한 번 킥한다(fire-and-forget). 크론만 믿으면 주기만큼 기다린다 —
// analyze-drain 이 이미 쓰는 이중 구조다.
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import {
  saveRecordingPart, listRecordingParts, summarizeProgress,
  isAllowedAudioMime, MAX_PART_BYTES,
} from '@/lib/meeting/recording'
import { drainTranscription } from '@/lib/meeting/transcribe-parts'
import { kstTodayKey } from '@/lib/datetime/kst'

export const runtime = 'nodejs'
export const maxDuration = 60

type Ctx = { params: Promise<{ id: string }> }

/** 본인 노트인지 — service_role 로 쓰기 전에 코드가 막는다 */
async function assertOwnNote(noteId: string, userId: string): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data } = await admin
    .from('meeting_notes')
    .select('id')
    .eq('id', noteId)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .maybeSingle()
  return Boolean(data?.id)
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
  if (!await assertOwnNote(id, user.id)) {
    return NextResponse.json({ error: '회의노트를 찾을 수 없습니다.' }, { status: 404 })
  }

  const parts = await listRecordingParts(id)
  return NextResponse.json({ parts, progress: summarizeProgress(parts) })
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
  if (!await assertOwnNote(id, user.id)) {
    return NextResponse.json({ error: '회의노트를 찾을 수 없습니다.' }, { status: 404 })
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: '잘못된 요청 형식입니다.' }, { status: 400 })
  }

  const file = form.get('audio')
  const partIdxRaw = form.get('partIdx')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: '녹음 파일이 없습니다.' }, { status: 400 })
  }
  const partIdx = Number(partIdxRaw)
  if (!Number.isInteger(partIdx) || partIdx < 0) {
    return NextResponse.json({ error: '구간 번호가 올바르지 않습니다.' }, { status: 400 })
  }
  if (file.size === 0) {
    return NextResponse.json({ error: '녹음 파일이 비어 있습니다.' }, { status: 400 })
  }
  if (file.size > MAX_PART_BYTES) {
    return NextResponse.json({ error: '녹음 구간이 너무 큽니다. 더 짧게 나눠 주세요.' }, { status: 413 })
  }
  if (!isAllowedAudioMime(file.type)) {
    // 모르는 형식을 그냥 받으면 전사 단계에서 실패하는데, 그때는 이미 회의가 끝난 뒤다
    return NextResponse.json(
      { error: `지원하지 않는 녹음 형식입니다 (${file.type || '알 수 없음'}).` },
      { status: 400 },
    )
  }

  const durationRaw = Number(form.get('durationSec'))
  const bytes = Buffer.from(await file.arrayBuffer())

  let saved: Awaited<ReturnType<typeof saveRecordingPart>>
  try {
    saved = await saveRecordingPart({
      noteId: id,
      partIdx,
      mime: file.type,
      durationSec: Number.isFinite(durationRaw) && durationRaw > 0 ? Math.round(durationRaw) : null,
      bytes,
      // 폴더는 KST 기준 월별. UTC 로 나누면 매월 1일 새벽 9시간이 지난달 폴더로 간다
      yearMonth: kstTodayKey().slice(0, 7),
    })
  } catch (e) {
    // 드라이브 연결이 끊겼거나 용량이 찼을 때 여기로 온다 — 조용히 성공한 척하지 않는다
    return NextResponse.json(
      { error: e instanceof Error ? e.message : '녹음을 저장하지 못했습니다.' },
      { status: 502 },
    )
  }

  // 전사를 한 번 킥한다. 실패해도 크론이 받으므로 응답을 막지 않는다.
  void (async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const admin = createAdminClient() as any
      const { data: metaRow } = await admin.from('org_content').select('value').eq('key', 'META').single()
      await drainTranscription({ meta: (metaRow?.value as Record<string, unknown>) ?? {}, limit: 2, deadlineMs: 40_000 })
    } catch { /* 크론이 받는다 */ }
  })()

  const parts = await listRecordingParts(id)
  return NextResponse.json({
    partId: saved.partId,
    alreadyExisted: saved.alreadyExisted,
    progress: summarizeProgress(parts),
  })
}
