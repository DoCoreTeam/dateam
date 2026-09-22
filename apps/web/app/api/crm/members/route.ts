// GET  /api/crm/members — 멤버 목록 (+ 아직 안 들인 호스트 사용자)
// POST /api/crm/members — 팀원 들이기
//
// 호스트에 사용자가 32명인데 CRM 멤버는 1명이었다. 멤버가 아니면 CRM 에 들어올 수 없는데
// **들일 화면이 없었다** — 팀이 쓰기 시작하는 순간 제품이 멈추는 상태였다.
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { getCrmDb } from '@/lib/crm/db/client'
import { createAdminClient } from '@/lib/supabase/server'
import { listMembers, addMember } from '@/lib/crm/services/member'
import { activeMembers } from '@/lib/members/resigned-server'

/** 조직에서 읽은 직급·직책을 멤버 줄에 붙인다 */
async function attachOrgTitles<T extends { hostUserId: string }>(
  members: T[],
): Promise<(T & { position: string | null; rank: string | null })[]> {
  const ids = members.map((m) => m.hostUserId).filter(Boolean)
  if (ids.length === 0) return members.map((m) => ({ ...m, position: null, rank: null }))
  try {
    const sb = createAdminClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (sb.from('profiles') as any)
      .select('id, rank, position')
      .in('id', ids) as { data: { id: string; rank: string | null; position: string | null }[] | null }
    const byId = new Map((data ?? []).map((p) => [p.id, p]))
    return members.map((m) => ({
      ...m,
      position: byId.get(m.hostUserId)?.position ?? null,
      rank: byId.get(m.hostUserId)?.rank ?? null,
    }))
  } catch {
    return members.map((m) => ({ ...m, position: null, rank: null }))
  }
}

export async function GET(req: NextRequest) {
  return withCrmApi('READONLY', async ({ session }) => {
    const db = getCrmDb(session.workspaceId)
    const trash = req.nextUrl.searchParams.get('trash') === '1'
    const members = await listMembers(db, { trash })

    /**
     * 직급과 직책을 조직에서 붙인다 — CRM 은 자기 칸(`crm_member.title`)만 보고 있었고
     * 그 칸은 손으로 채우는 자리라 **전원 비어 있었다**(실측 2026-09-22). 그래서 멤버 목록에
     * 이름만 떴다. 값은 이미 `profiles` 에 있다(34명 중 직급 32, 직책 11).
     *
     * **이미 멤버인 사람의 id 로만 묻는다.** 조건 없이 훑으면 이 창구가 「그 사람이 있느냐」를
     * 대답하는 자리가 된다(LOOP.md 7절 S3 이메일 열거와 같은 이유).
     * 못 읽어도 목록은 나온다 — 직함은 있으면 좋은 값이지 없으면 화면이 멈출 값이 아니다.
     */
    const withOrgTitle = await attachOrgTitles(members)

    /**
     * 아직 안 들인 사람 목록도 함께 준다 — 관리자가 이름을 외워서 입력할 수는 없다.
     * 이름을 못 불러와도 멤버 목록 자체는 보여야 하므로 실패는 조용히 흡수한다.
     */
    let candidates: { id: string; name: string; email: string }[] = []
    try {
      const sb = createAdminClient()
      // profiles 에는 email 이 없다 — 로그인 이메일은 auth.users 에 있다(실측 확인)
      // 타입의 role 유니온에 api_user 가 없어 .neq() 를 걸면 결과가 never 로 좁혀진다.
      // 실제 DB 에는 있는 값이라 거르기는 해야 한다 — 조회는 넓게, 판정은 코드에서.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (sb.from('profiles') as any)
        .select('id, name, role')
        .is('deleted_at', null)
        .order('name') as { data: { id: string; name: string | null; role: string }[] | null }

      const taken = new Set((await listMembers(db)).map((m) => m.hostUserId))
      // 영업 담당으로 세울 후보다 — 퇴사자는 고를 수 없어야 한다
      const rows = (await activeMembers(sb, data ?? []))
        .filter((p) => String(p.role) !== 'api_user')
        .filter((p) => !taken.has(p.id))

      // 이메일은 인증 쪽에서 가져온다 — 없으면 이름만으로도 고를 수 있어야 한다
      const emailOf = new Map<string, string>()
      try {
        const { data: users } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 })
        for (const u of users?.users ?? []) if (u.email) emailOf.set(u.id, u.email)
      } catch {
        // 이메일을 못 읽어도 후보 목록은 나온다
      }

      candidates = rows.map((p) => ({
        id: p.id,
        name: p.name ?? '(이름 없음)',
        email: emailOf.get(p.id) ?? '',
      }))
    } catch {
      // 후보를 못 불러와도 멤버 목록은 보여 준다
    }

    return { items: withOrgTitle, candidates }
  })
}

export async function POST(req: NextRequest) {
  return withCrmApi('ADMIN', async ({ session }) => {
    const body = await readJson(req)
    return addMember(session.workspaceId, session.memberId, {
      hostUserId: typeof body.hostUserId === 'string' ? body.hostUserId : '',
      displayName: typeof body.displayName === 'string' ? body.displayName : '',
      email: typeof body.email === 'string' ? body.email : '',
      role: typeof body.role === 'string' ? body.role : undefined,
    })
  })
}
