/**
 * 회의 녹음 구간 — 저장과 조회 (통합 기획 §5, 마이그 217)
 *
 * **왜 10분 구간인가.** 세 제약이 동시에 걸린다.
 *   ① Vercel 요청 본문 4.5MB — 60분 녹음(≈14MB)은 우리 API를 통과할 수 없다
 *   ② 함수 실행 300초 — 60분 오디오를 한 번에 전사하면 넘는다
 *   ③ AI 출력 32,768토큰 — 60분 한국어 전사는 4~6만 토큰이라 중간에서 잘린다
 * 10분이면 2~3MB / 3초 / 8~12k 토큰이라 셋 다 안에 들어온다.
 *
 * 그리고 이 구조가 그냥 얻어 주는 것이 있다 — **회의 중에 앞 구간이 이미 전사까지 끝난다.**
 * 종료 버튼을 눌렀을 때 남은 건 마지막 구간뿐이라 기다림이 거의 없다.
 *
 * 오디오는 우리 구글드라이브에 둔다(사용자 결정 D2). 마이그 117 이 `audio_drive_id` 로
 * 예약해 둔 방식 그대로다 — 새 저장소를 만들지 않는다.
 */

/**
 * 상수·순수 판정은 recording-core.ts 에 있다 — 클라이언트가 그것만 가져갈 수 있어야 하기 때문.
 * 여기서 그대로 재수출한다: 서버 쪽 호출부는 import 경로를 바꾸지 않는다(SSOT 한 곳 유지).
 */
export {
  PART_MS, MAX_PART_BYTES, ALLOWED_AUDIO_MIMES,
  isAllowedAudioMime, extensionForMime, partOffsetMs, summarizeProgress,
} from './recording-core.ts'
export type { PartStatus, RecordingPart, RecordingProgress } from './recording-core.ts'

import { extensionForMime } from './recording-core.ts'
import type { RecordingPart } from './recording-core.ts'

/** 드라이브 폴더 — 명함 업로드가 쓰는 루트를 공유한다(새 루트를 만들지 않는다) */
const ROOT_FOLDER = 'AX사업본부'
const RECORDING_FOLDER = '회의녹음'

/** 녹음이 저장될 드라이브 폴더 — 월별로 나눠 담는다(한 폴더에 수천 개가 쌓이지 않게) */
export async function ensureRecordingFolder(yearMonth: string): Promise<string> {
  // 동적 import — google-drive.ts 가 `@/lib` 별칭을 쓰는데 단위 테스트 러너는 그걸 못 푼다.
  // 이 파일의 순수 함수(오프셋·mime·진행 문구)는 그것 없이도 검증돼야 한다.
  const { ensureFolder } = await import('../google-drive.ts')
  const root = await ensureFolder(ROOT_FOLDER)
  const recordings = await ensureFolder(RECORDING_FOLDER, root)
  return ensureFolder(yearMonth, recordings)
}

export interface SavePartInput {
  noteId: string
  partIdx: number
  mime: string
  durationSec: number | null
  bytes: Buffer
  /** 폴더 이름에 쓸 YYYY-MM (KST 기준으로 호출부가 만든다) */
  yearMonth: string
}

/**
 * 구간 하나를 드라이브에 올리고 행을 남긴다.
 *
 * 같은 구간이 두 번 오면(네트워크 재시도) **덮어쓰지 않고 기존 것을 돌려준다** —
 * 새로 만들면 같은 10분이 전사에 두 번 들어가 회의록이 겹친다.
 */
export async function saveRecordingPart(
  input: SavePartInput,
): Promise<{ partId: string; driveFileId: string; alreadyExisted: boolean }> {
  const { createAdminClient } = await import('../supabase/server.ts')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any

  const { data: existing } = await admin
    .from('meeting_recording_part')
    .select('id, drive_file_id')
    .eq('note_id', input.noteId)
    .eq('part_idx', input.partIdx)
    .maybeSingle()

  if (existing?.id) {
    return {
      partId: existing.id as string,
      driveFileId: (existing.drive_file_id as string | null) ?? '',
      alreadyExisted: true,
    }
  }

  const { uploadFile } = await import('../google-drive.ts')
  const folderId = await ensureRecordingFolder(input.yearMonth)
  const name = `${input.noteId}_${String(input.partIdx).padStart(3, '0')}.${extensionForMime(input.mime)}`
  // uploadFile 은 fileId 문자열을 돌려준다
  const driveFileId = await uploadFile(input.bytes, name, input.mime, folderId)

  const { data, error } = await admin
    .from('meeting_recording_part')
    .insert({
      note_id: input.noteId,
      part_idx: input.partIdx,
      drive_file_id: driveFileId,
      mime: input.mime,
      duration_sec: input.durationSec,
      status: 'UPLOADED',
    })
    .select('id')
    .single()

  if (error || !data?.id) {
    // 드라이브에는 올라갔는데 행이 없으면 **아무도 그 파일을 못 찾는다.**
    // 조용히 넘어가지 않고 실패로 말한다 — 다음 구간이라도 살리려면 사용자가 알아야 한다.
    throw new Error('녹음 구간을 저장하지 못했습니다. 다시 시도해 주세요.')
  }

  // 첫 구간이면 회의노트의 예약 컬럼도 채운다(하위호환 — 그 컬럼을 읽는 코드가 생겨도 값이 있다)
  if (input.partIdx === 0) {
    await admin
      .from('meeting_notes')
      .update({ audio_drive_id: driveFileId })
      .eq('id', input.noteId)
      .is('audio_drive_id', null)
  }

  return { partId: data.id as string, driveFileId, alreadyExisted: false }
}

/** 이 회의의 구간 전부 — 화면이 "3/6 전사됨"을 말하려면 필요하다 */
export async function listRecordingParts(noteId: string): Promise<RecordingPart[]> {
  const { createAdminClient } = await import('../supabase/server.ts')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data } = await admin
    .from('meeting_recording_part')
    .select('id, note_id, part_idx, drive_file_id, mime, duration_sec, status, error, retry_count, audio_deleted_at, created_at')
    .eq('note_id', noteId)
    .order('part_idx', { ascending: true })
  return (data ?? []) as RecordingPart[]
}

/** 전사 잡이 오디오를 받아 가는 자리 */
export async function readPartAudio(driveFileId: string): Promise<{ bytes: Buffer; mimeType: string }> {
  const { streamFile } = await import('../google-drive.ts')
  const res = await streamFile(driveFileId)
  const chunks: Buffer[] = []
  for await (const chunk of res.stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBufferLike))
  }
  return { bytes: Buffer.concat(chunks), mimeType: res.mimeType }
}
