/**
 * 회의 녹음 원본 자동 삭제 (사용자 결정 D2 — "구글드라이브로 하고 자동삭제 적용")
 *
 * **왜 지워야 하나.** 녹음은 회의에서 오간 말 전부다. 전사가 끝나면 우리가 쓰는 것은
 * 글이지 소리가 아닌데, 소리는 계속 남아 쌓인다. 한 시간짜리 회의 하나가 14MB 이고
 * 주 열 건이면 반년에 3GB 가 넘는다 — 용량보다 **남겨서 얻는 것이 없다**는 쪽이 크다.
 *
 * **왜 전사된 것만 지우나.** 아직 전사 못 한 구간을 지우면 그 10분은 영영 복구할 수 없다.
 * 실패한 구간도 남긴다 — 사람이 나중에 재시도를 누를 수 있어야 한다.
 *
 * **왜 `drive_file_id` 를 null 로 만들지 않나.** 그 파일이 있었다는 사실 자체가 기록이다.
 * 지운 시각(`audio_deleted_at`)을 찍는 것으로 "지금은 없다"를 표현한다 —
 * id 를 지우면 화면이 '녹음이 애초에 없었던 것'과 구분하지 못한다.
 */

/** 기본 보관 기간. 회의 뒤 한 달이면 전사를 확인하고 고칠 시간으로 충분하다. */
export const DEFAULT_RETENTION_DAYS = 30

/** 한 번에 지우는 상한. 드라이브 API 를 몰아치지 않고, 함수 시간 안에 끝나게 한다. */
export const PURGE_BATCH = 50

/**
 * 보관 기간(일) — 어드민이 바꿀 수 있게 열어 두되, 말이 안 되는 값은 기본으로 접는다.
 *
 * 0 을 허용하지 않는 이유: 전사 직후 즉시 삭제가 되면 전사가 잘못됐을 때
 * 되돌릴 방법이 통째로 사라진다. 최소 1일은 남긴다.
 */
export function readRetentionDays(meta: Record<string, unknown>): number {
  const raw = meta.meeting_audio_retention_days
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n)) return DEFAULT_RETENTION_DAYS
  const days = Math.trunc(n)
  if (days < 1 || days > 3650) return DEFAULT_RETENTION_DAYS
  return days
}

/**
 * 이 시각보다 **먼저** 만들어진 구간이 삭제 대상이다.
 *
 * 순수 함수로 뺀 이유: 날짜 경계는 화면으로 밟을 수 없고, 부호 하나가 뒤집히면
 * **방금 녹음한 회의를 지운다**. 단정으로 고정해야 하는 계산이다(완료 조건 E-6).
 */
export function purgeCutoffIso(nowIso: string, retentionDays: number): string {
  const now = Date.parse(nowIso)
  if (!Number.isFinite(now)) throw new Error('purgeCutoffIso: 시각을 읽을 수 없습니다')
  return new Date(now - retentionDays * 24 * 60 * 60 * 1000).toISOString()
}

export interface PurgeCandidate {
  id: string
  drive_file_id: string | null
}

export interface PurgeResult {
  scanned: number
  deleted: number
  alreadyGone: number
  failed: number
  /** 아무것도 안 했을 때 왜 안 했는지 — 침묵하면 고장과 구분되지 않는다 */
  skippedReason?: string
}

/**
 * 보관 기간이 지난 전사 완료 구간의 오디오를 지운다.
 *
 * 실패해도 잡 전체를 멈추지 않는다 — 한 파일의 권한 문제로 나머지 49개가 영영 안 지워지면
 * 다음 실행에서도 같은 파일에 먼저 걸려 큐가 그대로 막힌다.
 */
export async function purgeExpiredAudio(opts: {
  meta: Record<string, unknown>
  nowIso: string
  limit?: number
}): Promise<PurgeResult> {
  const retentionDays = readRetentionDays(opts.meta)
  const cutoff = purgeCutoffIso(opts.nowIso, retentionDays)
  const limit = Math.max(1, Math.min(PURGE_BATCH, opts.limit ?? PURGE_BATCH))

  const { createAdminClient } = await import('../supabase/server.ts')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any

  const { data, error } = await admin
    .from('meeting_recording_part')
    .select('id, drive_file_id')
    .eq('status', 'TRANSCRIBED')
    .is('audio_deleted_at', null)
    .lt('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) {
    return { scanned: 0, deleted: 0, alreadyGone: 0, failed: 0, skippedReason: '삭제 대상을 조회하지 못했습니다' }
  }

  const rows = (data ?? []) as PurgeCandidate[]
  if (rows.length === 0) {
    return { scanned: 0, deleted: 0, alreadyGone: 0, failed: 0, skippedReason: `보관 기간(${retentionDays}일)이 지난 녹음이 없습니다` }
  }

  const { deleteFile } = await import('../google-drive.ts')
  let deleted = 0
  let alreadyGone = 0
  let failed = 0

  for (const row of rows) {
    try {
      if (row.drive_file_id) {
        const r = await deleteFile(row.drive_file_id)
        if (r.alreadyGone) alreadyGone += 1
        else deleted += 1
      } else {
        // 드라이브 id 가 없는 행은 지울 파일도 없다 — 시각만 찍어 목록에서 뺀다
        alreadyGone += 1
      }
      await admin
        .from('meeting_recording_part')
        .update({ audio_deleted_at: opts.nowIso })
        .eq('id', row.id)
    } catch {
      failed += 1
    }
  }

  return { scanned: rows.length, deleted, alreadyGone, failed }
}
