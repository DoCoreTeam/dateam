/**
 * 드레인이 쓸 바깥것들 — 한 곳에서만 엮는다.
 *
 * `finish-drain.ts` 는 이것들을 주입받는다. 그래야 단계 전이를 Supabase·Gemini 없이
 * 그대로 검증할 수 있다(정책 E-6). 엮는 자리가 라우트마다 있으면 브라우저 입구와
 * 크론 입구가 서로 다른 것을 주게 된다 — 그러면 한쪽에서만 나는 버그가 생긴다.
 */
import { getCrmDb } from '../db/client.ts'
import { adapterFromSetting } from '../services/quick-create.ts'
import { CrmError } from '../domain/errors.ts'
import type { DrainDeps } from './finish-drain.ts'

/**
 * 원본 회의노트를 「확정」으로 — **이미 확정이면 아무것도 하지 않는다.**
 *
 * 돌려주는 값은 «바꿨나»다. 화면이 「올렸어요」와 「이미 확정이에요」를 구분해 말할 수
 * 있어야 사용자가 무슨 일이 있었는지 안다(둘 다 성공이지만 뜻이 다르다).
 */
async function confirmNote(noteId: string): Promise<boolean> {
  const { createAdminClient } = await import('../../supabase/server.ts')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any

  const { data, error: readErr } = await admin
    .from('meeting_notes').select('id, status').eq('id', noteId).maybeSingle()
  // supabase-js 는 오류를 **던지지 않고 반환한다** — 검사하지 않으면 조용히 넘어간다
  if (readErr) throw new CrmError('CONFLICT', '회의노트를 읽지 못했습니다.')
  const row = data as { id: string; status: string } | null
  if (!row) throw new CrmError('NOT_FOUND', '회의노트를 찾을 수 없습니다.')
  if (row.status === 'final') return false

  const { error } = await admin.from('meeting_notes').update({ status: 'final' }).eq('id', noteId)
  if (error) throw new CrmError('CONFLICT', '회의노트 상태를 바꾸지 못했습니다.')
  return true
}

/**
 * 정리 한 판에 줄 시간.
 *
 * 한 회차가 한 단계만 도는 구조라 이제 5축과 시간을 나눠 쓸 일이 없다 — 그래도 상한을
 * 둔다. 한 단계가 회차 예산을 통째로 먹으면 다른 잡이 영원히 못 집힌다.
 */
const DIGEST_BUDGET_MS = 200_000

export async function finishDrainDeps(): Promise<Omit<DrainDeps, 'deadlineMs'>> {
  const { runMeetingDigest } = await import('../../meeting/digest-run.ts')
  return {
    // 잡을 집은 뒤 그 워크스페이스 설정으로 만든다 — 미리 하나 만들면 남의 설정을 쓴다
    // 마감 잡은 예약으로 돈다 — 누른 사람이 없다. 「모른다」를 null 로 적어 둔다
    adapterFor: (workspaceId) => adapterFromSetting(getCrmDb(workspaceId), { actorId: null }),
    confirmNote,
    digest: async (noteId, hostUserId) => {
      const out = await runMeetingDigest(noteId, hostUserId ?? '', { budgetMs: DIGEST_BUDGET_MS })
      return { agendaCount: out.digest?.agenda?.length ?? 0 }
    },
  }
}
