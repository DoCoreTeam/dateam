/**
 * 공개 API ↔ 영업 CRM 다리 — 권한 모델을 **새로 만들지 않는다**
 *
 * 공개 API 는 사내 자동화용이다(사용자 결정 2026-08-27). 그래서 규칙은 하나다:
 *   **키는 그 키를 만든 사용자의 권한을 그대로 상속한다.**
 * 내부 화면이 `withCrmApi('READONLY'|'MEMBER')` 로 보는 것을 여기서도 똑같이 본다.
 * 신원이 쿠키로 오느냐 키로 오느냐만 다르고, 그 뒤는 같은 `resolveCrmAccess*` 를 지난다.
 *
 * 권한 모델이 둘이 되면 언젠가 한쪽만 조여지고 느슨한 쪽이 문이 된다 —
 * 그래서 CrmError → HTTP 변환까지 내부와 같은 의미를 유지한다.
 */

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { CrmError } from '@/lib/crm/domain/errors'
import { getCrmDb, type CrmDb } from '@/lib/crm/db/client'
import {
  resolveCrmAccessForUser, hasCrmRole,
  type CrmRole, type CrmSession,
} from '@/lib/crm/auth/requireCrmMember'
import { authenticatePublicApi, type ApiKeyContext } from '@/lib/publicApiAuth'
import { fail, serverError, okList, responseHeaders } from './respond.ts'

export interface PublicCrmContext {
  session: CrmSession
  db: CrmDb
  /** 키 자체의 정보 — 한도 헤더·감사에 쓴다 */
  key: ApiKeyContext
  request: NextRequest
}

/**
 * 공개 CRM 라우트의 공통 껍데기.
 *
 * 순서가 곧 방어선이다: 키 → 한도 → CRM 멤버십 → 역할 → 핸들러.
 * 하나라도 앞으로 당기면 그만큼 검사받지 않은 요청이 안으로 들어온다.
 */
export async function withPublicCrmApi<T>(
  required: CrmRole,
  request: NextRequest,
  fn: (ctx: PublicCrmContext) => Promise<T>,
): Promise<Response> {
  const auth = await authenticatePublicApi(request)
  if ('error' in auth) return auth.error
  const key = auth.ctx

  try {
    const access = await resolveCrmAccessForUser(key.userId)
    if (!access.ok) {
      // 왜 못 들어오는지 구분해 말한다 — "권한 없음" 한 마디로는 관리자가 고칠 수 없다
      const message = access.reason === 'not_a_member'
        ? '이 키를 발급한 계정에 영업 CRM 사용 권한이 없습니다. 관리자에게 멤버 등록을 요청해 주세요.'
        : '이 키를 발급한 계정을 사용할 수 없습니다. 관리자에게 문의해 주세요.'
      return fail(403, message, { ctx: key, request })
    }

    if (!hasCrmRole(access.session.role, required)) {
      return fail(403, '이 작업을 할 권한이 없습니다. 키를 발급한 계정의 CRM 권한을 확인해 주세요.',
        { ctx: key, request })
    }

    const data = await fn({
      session: access.session,
      db: getCrmDb(access.session.workspaceId),
      key,
      request,
    })

    // 커서 페이지는 공개 API 의 목록 봉투로 편다 — 안 그러면 봉투가 또 두 벌이 된다.
    // (CRM 내부는 `{items, nextCursor}` 를 그대로 쓰지만, 공개 계약은 `data` + `meta` 다)
    if (isCursorPage(data)) {
      return okList(data.items, {
        nextCursor: data.nextCursor,
        hasMore: data.nextCursor !== null,
        ...(typeof data.total === 'number' ? { total: data.total } : {}),
      }, { ctx: key, request })
    }

    return NextResponse.json(
      { success: true, data },
      { headers: responseHeaders({ ctx: key, request }) },
    )
  } catch (e) {
    if (e instanceof CrmError) {
      // 내부 API 와 같은 뜻·같은 상태코드를 유지한다 — 봉투만 공개 API 형식으로 바꾼다
      return fail(e.status, e.message, { ctx: key, request })
    }
    return serverError('crm', e, { ctx: key, request })
  }
}

/** 목록 파라미터 — 내부 `readListQuery` 와 같은 이름·같은 기본값을 쓴다 */
export function readPublicListQuery(request: NextRequest): { cursor: string | null; limit: number; q: string | null } {
  const sp = request.nextUrl.searchParams
  const raw = Number(sp.get('limit'))
  const limit = Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), 100) : 20
  return { cursor: sp.get('cursor'), limit, q: sp.get('q') }
}

/** CRM 서비스가 돌려주는 커서 페이지인가 — 목록만 봉투를 편다 */
function isCursorPage(v: unknown): v is { items: unknown[]; nextCursor: string | null; total?: number } {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return Array.isArray(o.items) && 'nextCursor' in o
}
