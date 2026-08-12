import { createAdminClient } from '@/lib/supabase/server'
import { ok, failUnexpected } from '@/lib/ci/api'
import { requireCiMemberApi, workspaceIdFromRequest } from '@/lib/ci/auth/requireCiMember'
import { getGeminiMeta } from '@/lib/ci/ai/meta'
import { getDriveConnectionStatus } from '@/lib/google-drive'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 설정 개요 — 레지스트리로 표현되지 않는 것들.
 *  - 내 계정: 누구로 로그인했고 이 워크스페이스에서 무슨 권한인가
 *  - 연동: 어떤 키가 꽂혀 있고, 없으면 무엇이 제한되는가
 *  - 멤버: 누가 이 워크스페이스에 있는가
 *
 * 키 **값**은 절대 내려보내지 않는다. 있다/없다와 무엇이 제한되는지만 말한다.
 */
export async function GET(req: Request) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId)
    if (error) return error

    const adminClient = createAdminClient() as any

    const [meta, drive, wsRes, membersRes, profileRes] = await Promise.all([
      getGeminiMeta().catch(() => ({ geminiApiKey: '', geminiModel: '', youtubeApiKey: undefined })),
      getDriveConnectionStatus().catch(() => ({ connected: false, email: null })),
      adminClient.from('ci_workspaces').select('name, created_at').eq('id', session.workspaceId).maybeSingle(),
      // profiles에는 email이 없다(이메일은 auth 쪽). 없는 컬럼을 넣으면 조회가 통째로 실패해
      // 이름·권한·멤버가 전부 비어 보인다 — 실측으로 잡은 사고.
      // profiles로 가는 FK가 user_id·invited_by 둘이라 임베드가 모호하다 → FK를 명시한다
      adminClient.from('ci_workspace_members')
        .select('user_id, role, profiles!ci_workspace_members_user_id_fkey ( name )')
        .eq('workspace_id', session.workspaceId).limit(50),
      adminClient.from('profiles').select('name, role').eq('id', session.userId).maybeSingle(),
    ])

    return ok({
      account: {
        name: profileRes.data?.name ?? null,
        // 이메일은 세션(auth)에서 온다
        email: session.email ?? null,
        appRole: profileRes.data?.role ?? null,
        workspaceRole: session.role,
      },
      workspace: {
        name: wsRes.data?.name ?? '이름 없음',
        createdAt: wsRes.data?.created_at ?? null,
        memberCount: (membersRes.data ?? []).length,
      },
      members: ((membersRes.data ?? []) as any[]).map((m) => ({
        userId: m.user_id,
        role: m.role,
        name: m.profiles?.name ?? null,
        /** 본인만 이메일을 안다 — 남의 이메일을 설정 화면에서 흘리지 않는다 */
        email: m.user_id === session.userId ? (session.email ?? null) : null,
      })),
      integrations: [
        {
          id: 'youtube',
          label: 'YouTube Data API',
          connected: Boolean(meta.youtubeApiKey),
          detail: meta.youtubeApiKey
            ? '채널 업로드를 설정한 기간만큼 전부 가져옵니다'
            : '키가 없어 채널 수집이 최근 15개(RSS)로 제한됩니다',
          settingsHref: '/admin/settings',
        },
        {
          id: 'gemini',
          label: 'Gemini (AI 분석)',
          connected: Boolean(meta.geminiApiKey),
          detail: meta.geminiApiKey
            ? `모델 ${meta.geminiModel}`
            : '키가 없어 썸네일 판독·기획안 생성이 규칙 기반으로만 동작합니다',
          settingsHref: '/admin/settings',
        },
        {
          id: 'drive',
          label: '구글드라이브 (자료 보관)',
          connected: drive.connected,
          detail: drive.connected
            ? `${drive.email} 계정에 보관합니다`
            : '연결하지 않으면 자료 파일을 올릴 수 없습니다',
          settingsHref: '/admin/settings',
        },
      ],
    })
  } catch (e) {
    return failUnexpected(e)
  }
}
