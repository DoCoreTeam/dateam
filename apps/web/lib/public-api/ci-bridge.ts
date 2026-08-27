/**
 * 공개 API ↔ 콘텐츠 인텔리전스 다리 — CRM 과 같은 원칙
 *
 * **키는 그 키를 만든 사용자의 권한을 그대로 상속한다.** CI 는 워크스페이스가 여럿일 수 있어
 * 쿠키(`ci_ws`)로 고르지만, 키에는 쿠키가 없다. 그래서 `?workspace=` 로 **명시**받고
 * 그 사용자의 멤버십 목록에 있는지 확인한다 — 클라이언트가 준 값을 그대로 믿지 않는다.
 *
 * 워크스페이스를 안 주면 그 사용자가 속한 곳이 **하나일 때만** 그것으로 정한다.
 * 여럿인데 말없이 첫 번째를 고르면, 사용자는 자기가 어느 워크스페이스를 본 건지 모른다.
 */

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { listCiWorkspaces, type CiWorkspaceRef } from '@/lib/ci/workspace'
import { ciRoleAtLeast, type CiMemberRole } from '@/lib/ci/types'
import { authenticatePublicApi, type ApiKeyContext } from '@/lib/publicApiAuth'
import { fail, serverError, responseHeaders } from './respond.ts'

export interface PublicCiContext {
  workspace: CiWorkspaceRef
  key: ApiKeyContext
  request: NextRequest
}

export async function withPublicCiApi<T>(
  minRole: CiMemberRole,
  request: NextRequest,
  fn: (ctx: PublicCiContext) => Promise<T>,
): Promise<Response> {
  const auth = await authenticatePublicApi(request)
  if ('error' in auth) return auth.error
  const key = auth.ctx

  try {
    const mine = await listCiWorkspaces(key.userId)
    if (mine.length === 0) {
      return fail(403, '이 키를 발급한 계정에 콘텐츠 인텔리전스 워크스페이스가 없습니다.',
        { ctx: key, request })
    }

    const asked = request.nextUrl.searchParams.get('workspace')?.trim() || null
    let workspace: CiWorkspaceRef | undefined
    if (asked) {
      workspace = mine.find((w) => w.id === asked)
      if (!workspace) {
        return fail(403, '그 워크스페이스에 접근할 권한이 없습니다. workspace 값을 확인해 주세요.',
          { ctx: key, request })
      }
    } else if (mine.length === 1) {
      workspace = mine[0]
    } else {
      // 조용히 고르지 않는다 — 어느 곳을 본 건지 모르는 응답이 가장 나쁘다
      return fail(400,
        `워크스페이스를 지정해 주세요. workspace 파라미터에 다음 중 하나를 넣습니다: ${mine.map((w) => w.id).join(', ')}`,
        { ctx: key, request })
    }

    if (!ciRoleAtLeast(workspace.role, minRole)) {
      return fail(403, '이 작업을 할 권한이 없습니다.', { ctx: key, request })
    }

    const data = await fn({ workspace, key, request })
    return NextResponse.json({ success: true, data }, { headers: responseHeaders({ ctx: key, request }) })
  } catch (e) {
    return serverError('ci', e, { ctx: key, request })
  }
}
