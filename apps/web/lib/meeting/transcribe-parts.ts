/**
 * 녹음 구간 전사 드레인 (통합 기획 §5-3)
 *
 * 새 잡 시스템을 만들지 않는다 — `analyze-drain` 과 CRM 잡들이 쓰는 모양 그대로다.
 * 크론이 주기로 돌고, 업로드 완료가 한 번 킥한다. 크론만 믿으면 최대 주기만큼 기다린다.
 *
 * **타이밍 계약(D7)**: 전사는 자동, AI 분석은 버튼이다.
 * 여기서 전사만 끝내고 멈춘다 — 사용자가 전사를 먼저 보고 잘못 들린 곳을 고칠 수 있어야
 * 분석 결과가 맞고, 안 볼 회의까지 비용을 쓸 이유가 없다.
 */

import { listRecordingParts, partOffsetMs, readPartAudio, type RecordingPart } from './recording.ts'
import { readSttSettings, sttProviderFor, SttError, type SttProvider } from '../stt/provider.ts'

/** 실패해도 이만큼은 다시 해 본다. 넘으면 FAILED 로 두고 사유를 남긴다(CRM 녹음 규칙과 같은 값). */
export const MAX_PART_RETRY = 3

/** 이 시간이 지나도 TRANSCRIBING 이면 죽은 작업으로 보고 회수한다 */
export const STALE_CLAIM_MS = 10 * 60 * 1000

export interface DrainResult {
  claimed: number
  transcribed: number
  failed: number
  /** 남은 대기 구간 — 크론이 다음 판에 이어서 한다 */
  remaining: number
}

/** 전사 대기 중인 구간을 집는다. 죽은 작업(오래된 claim)도 함께 회수한다. */
export async function claimPendingParts(limit: number): Promise<RecordingPart[]> {
  const { createAdminClient } = await import('../supabase/server.ts')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MS).toISOString()

  const { data } = await admin
    .from('meeting_recording_part')
    .select('id, note_id, part_idx, drive_file_id, mime, duration_sec, status, error, retry_count, audio_deleted_at, created_at, claimed_at')
    .or(`status.eq.UPLOADED,and(status.eq.TRANSCRIBING,claimed_at.lt.${staleBefore})`)
    .not('drive_file_id', 'is', null)
    .lt('retry_count', MAX_PART_RETRY)
    .order('created_at', { ascending: true })
    .limit(limit)

  const rows = (data ?? []) as RecordingPart[]
  if (rows.length === 0) return []

  // 락을 건다. 두 판이 겹쳐 같은 구간을 두 번 전사하면 같은 10분이 두 벌 저장된다.
  const now = new Date().toISOString()
  await admin
    .from('meeting_recording_part')
    .update({ status: 'TRANSCRIBING', claimed_at: now })
    .in('id', rows.map((r) => r.id))

  return rows
}

/** 앞 구간의 끝 몇 줄 — 고유명사가 구간 경계에서 흔들리는 걸 줄인다 */
async function priorContextFor(noteId: string, partIdx: number): Promise<string | undefined> {
  if (partIdx === 0) return undefined
  const { createAdminClient } = await import('../supabase/server.ts')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data: prev } = await admin
    .from('meeting_recording_part')
    .select('id')
    .eq('note_id', noteId)
    .eq('part_idx', partIdx - 1)
    .maybeSingle()
  if (!prev?.id) return undefined

  const { data } = await admin
    .from('meeting_transcript_segment')
    .select('text')
    .eq('part_id', prev.id)
    .order('idx', { ascending: false })
    .limit(6)
  const rows = (data ?? []) as { text: string }[]
  if (rows.length === 0) return undefined
  return rows.reverse().map((r) => r.text).join(' ')
}

/**
 * 회의노트의 평문 전사를 세그먼트에서 다시 만든다.
 *
 * `meeting_notes.transcript` 는 마이그 117 이 예약해 둔 컬럼이고 읽는 코드가 생길 수 있다.
 * 비워 두면 나중에 누가 읽었을 때 조용히 빈 값을 받는다 — 파생값이라도 채워 둔다.
 */
async function refreshNotePlainTranscript(noteId: string): Promise<void> {
  const { createAdminClient } = await import('../supabase/server.ts')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const parts = await listRecordingParts(noteId)
  const ids = parts.map((p) => p.id)
  if (ids.length === 0) return

  const { data } = await admin
    .from('meeting_transcript_segment')
    .select('speaker, text, start_ms')
    .in('part_id', ids)
    .order('start_ms', { ascending: true })
  const rows = (data ?? []) as { speaker: string; text: string }[]
  if (rows.length === 0) return

  const plain = rows.map((r) => `${r.speaker}: ${r.text}`).join('\n')
  await admin.from('meeting_notes').update({ transcript: plain }).eq('id', noteId)
}

/** 구간 하나를 전사해 저장한다. 실패는 사유를 남기고 재시도 횟수를 올린다. */
export async function transcribeOnePart(part: RecordingPart, provider: SttProvider): Promise<boolean> {
  const { createAdminClient } = await import('../supabase/server.ts')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any

  try {
    if (!part.drive_file_id) throw new SttError('empty', '녹음 파일을 찾을 수 없습니다.', false)

    const { bytes, mimeType } = await readPartAudio(part.drive_file_id)
    const result = await provider.transcribe({
      bytes,
      mimeType: mimeType || part.mime,
      filename: `${part.note_id}_${part.part_idx}.webm`,
      language: 'ko',
      priorContext: await priorContextFor(part.note_id, part.part_idx),
    })

    // 전체 시간축으로 옮겨 담는다 — 구간마다 0 부터 세면 이어 붙였을 때 시각이 뒤죽박죽이다
    const offset = partOffsetMs(part.part_idx)
    const rows = result.segments.map((s, i) => ({
      part_id: part.id,
      idx: i,
      speaker: s.speaker,
      start_ms: offset + s.startMs,
      end_ms: offset + s.endMs,
      text: s.text,
    }))

    // 재시도로 들어온 경우 옛 세그먼트를 치운다. 안 치우면 같은 말이 두 번 남는다.
    await admin.from('meeting_transcript_segment').delete().eq('part_id', part.id)
    const { error: insErr } = await admin.from('meeting_transcript_segment').insert(rows)
    if (insErr) throw new SttError('server', '전사를 저장하지 못했습니다.', true)

    await admin
      .from('meeting_recording_part')
      .update({ status: 'TRANSCRIBED', error: null, claimed_at: null })
      .eq('id', part.id)

    await refreshNotePlainTranscript(part.note_id)
    return true
  } catch (e) {
    const err = e instanceof SttError ? e : null
    const nextRetry = part.retry_count + 1
    // 재시도로 안 풀릴 실패(키 오류·형식 오류)는 바로 FAILED 로 둔다 —
    // "다시 시도합니다"라고 해 놓고 100% 또 실패하는 안내를 만들지 않는다.
    const exhausted = nextRetry >= MAX_PART_RETRY || (err !== null && !err.retryable)
    await admin
      .from('meeting_recording_part')
      .update({
        status: exhausted ? 'FAILED' : 'UPLOADED',
        error: err?.userMessage ?? (e instanceof Error ? e.message : '전사에 실패했습니다.'),
        retry_count: nextRetry,
        claimed_at: null,
      })
      .eq('id', part.id)
    return false
  }
}

/**
 * 한 판 돌린다.
 *
 * 키가 없으면 **아무것도 집지 않고 사실을 말한다.** 집어 놓고 실패시키면
 * 재시도 횟수만 소진돼 나중에 키를 넣어도 그 구간들이 되살아나지 않는다.
 */
export async function drainTranscription(opts: {
  meta: Record<string, unknown>
  limit?: number
  deadlineMs?: number
}): Promise<DrainResult & { skippedReason?: string }> {
  const settings = readSttSettings(opts.meta)
  if (!settings) {
    return {
      claimed: 0, transcribed: 0, failed: 0, remaining: 0,
      skippedReason: '음성 인식 키가 등록되지 않았습니다. 시스템 설정 → 통합에서 등록해 주세요.',
    }
  }

  let provider: SttProvider
  try {
    provider = sttProviderFor(settings)
  } catch (e) {
    return {
      claimed: 0, transcribed: 0, failed: 0, remaining: 0,
      skippedReason: e instanceof SttError ? e.userMessage : '음성 인식 설정을 읽지 못했습니다.',
    }
  }

  const started = Date.now()
  const deadline = opts.deadlineMs ?? 240_000
  const parts = await claimPendingParts(opts.limit ?? 6)

  let transcribed = 0
  let failed = 0
  let remaining = 0
  for (const part of parts) {
    // 남은 시간이 없으면 손대지 않고 돌려놓는다 — 함수가 잘리면 그 구간이 TRANSCRIBING 에 갇힌다
    if (Date.now() - started > deadline) {
      const { createAdminClient } = await import('../supabase/server.ts')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const admin = createAdminClient() as any
      await admin
        .from('meeting_recording_part')
        .update({ status: 'UPLOADED', claimed_at: null })
        .eq('id', part.id)
      remaining += 1
      continue
    }
    const ok = await transcribeOnePart(part, provider)
    if (ok) transcribed += 1
    else failed += 1
  }

  return { claimed: parts.length, transcribed, failed, remaining }
}
