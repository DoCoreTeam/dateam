/**
 * CRM API 공통 껍데기 (구현명세서 5장·7장)
 *
 * 라우트마다 인증·에러 변환을 다시 쓰면 언젠가 한 곳이 빠진다.
 * 빠지는 쪽은 보통 **에러 응답**이라, 실패가 500 으로 뭉개져 사용자에게 아무 말도 못 한다.
 *
 * 여기서 보장하는 것:
 *   1) CRM 멤버가 아니면 요청이 서비스까지 못 간다
 *   2) CrmError 는 명세 7장 형태로 나간다(code·message·details + 맞는 상태코드)
 *   3) 예상 못 한 예외도 사용자가 읽을 수 있는 말로 바뀐다(원문은 서버 로그에만)
 */

import { NextResponse } from 'next/server'
import { CrmError } from '../domain/errors.ts'
import { recordSystemEventAsync } from '../../system-log/record.ts'
import { getCrmDb, type CrmDb } from '../db/client.ts'
import { resolveCrmAccess, hasCrmRole, type CrmRole, type CrmSession } from '../auth/requireCrmMember.ts'
import { canWrite } from '../../access/guard.ts'
import { WRITE_DENIED } from '../../terms/index.ts'

export interface CrmApiContext {
  session: CrmSession
  db: CrmDb
}

/** 쓰기는 MEMBER 이상, 읽기는 READONLY 이상 (명세 5장) */
export type RequiredRole = CrmRole

/**
 * 어떤 요구 등급이 「쓰기」인가.
 *
 * `READONLY` 만 읽기다 — 나머지 셋은 전부 값을 바꿀 수 있는 자리라 쓰기로 센다.
 * 등급이 늘면 여기도 늘려야 하고, 안 늘리면 **새 등급의 쓰기가 판정을 안 지난다.**
 * 그래서 목록을 뒤집어 적는다(읽기만 빼기)가 아니라 **쓰기를 적어 둔다** — 빠뜨리면
 * 새 등급이 조용히 통과하는 대신 조용히 막혀서, 빠뜨린 사실이 바로 드러난다.
 */
const WRITE_ROLES = new Set<CrmRole>(['OWNER', 'ADMIN', 'MEMBER'])

export async function withCrmApi<T>(
  required: RequiredRole,
  fn: (ctx: CrmApiContext) => Promise<T>,
): Promise<Response> {
  try {
    const access = await resolveCrmAccess()
    if (!access.ok) {
      // 로그인 자체가 없는 것과 권한이 없는 것은 다른 말이다 — 화면이 다르게 안내해야 한다
      const err = access.reason === 'no_session'
        ? new CrmError('UNAUTHORIZED')
        : new CrmError('FORBIDDEN', '영업 CRM 사용 권한이 없습니다.')
      return NextResponse.json(err.toResponseBody(), { status: err.status })
    }

    if (!hasCrmRole(access.session.role, required)) {
      const err = new CrmError('FORBIDDEN', '이 작업을 할 권한이 없습니다.')
      return NextResponse.json(err.toResponseBody(), { status: err.status })
    }

    /**
     * **CRM 안의 등급과 별개로**, 관리자가 이 사람에게 쓰기를 닫아 뒀나 (I10).
     *
     * 두 표는 서로 다른 것을 안다. `CrmMember.role` 은 「이 워크스페이스에서 무슨 일을 맡나」를
     * 알고, 접근권한은 「회사가 이 사람에게 이 문을 열어 줬나」를 안다. 한쪽이 열려 있어도
     * 다른 쪽이 닫혀 있으면 닫힌 것이다 — 문을 안 연 사람에게 등급이 있다고 들여보내면
     * 접근권한 화면에서 닫아 둔 것이 아무 뜻이 없어진다.
     *
     * 쓰기 등급을 요구하는 창구에서만 묻는다. 읽기 창구는 표면 판정이 이미 지나온 자리다.
     * 그리고 동작 부여가 0건이면 이 판정은 표면 판정과 같은 답이라 **지금과 다르지 않다.**
     */
    if (WRITE_ROLES.has(required) && !(await canWrite('/crm'))) {
      const err = new CrmError('FORBIDDEN', WRITE_DENIED)
      return NextResponse.json(err.toResponseBody(), { status: err.status })
    }

    const data = await fn({ session: access.session, db: getCrmDb(access.session.workspaceId) })
    /**
     * 스트리밍 응답은 **그대로 흘려보낸다.**
     *
     * `NextResponse.json` 으로 감싸면 스트림이 통째로 문자열이 되어 진행률이 끝난 뒤에야 온다.
     * 라우트가 직접 `new Response(stream)` 을 만들되, 인증·권한·오류 처리는 여기 한 곳에 남긴다
     * (스트리밍 전용 핸들러를 따로 만들면 그 셋이 두 벌이 된다).
     */
    if (data instanceof Response) return data as Response
    return NextResponse.json(data)
  } catch (e) {
    if (e instanceof CrmError) {
      return NextResponse.json(e.toResponseBody(), { status: e.status })
    }
    // Prisma 유니크 위반 — 사용자에게는 무엇이 겹쳤는지만 말한다(내부 제약명은 안 보인다)
    const msg = e instanceof Error ? e.message : String(e)
    if (/unique|duplicate/i.test(msg)) {
      const err = new CrmError('DUPLICATE', '이미 등록된 값입니다. 중복되지 않는 값으로 입력해 주세요.')
      return NextResponse.json(err.toResponseBody(), { status: err.status })
    }
    console.error('[crm/api]', msg)
    /**
     * 관리자가 읽는 곳에도 남긴다 — `console.error` 는 **아무도 안 본다.**
     * 여기가 CRM API 전체의 단일 통로라 한 줄이면 CRM 이 통째로 덮인다(C-8).
     * 기다리지 않는다: 로그 저장이 응답을 늦추면 안 된다.
     */
    await recordSystemEventAsync({
      source: 'crm_api', error: e, blocksUser: true,
      feature: 'crm-api',
      context: { handledAs: 'unhandled' },
    })
    // 코드가 없는 실패도 사용자에게는 읽히는 말이어야 한다
    const err = new CrmError('VALIDATION_FAILED', '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    return NextResponse.json(err.toResponseBody(), { status: 500 })
  }
}

/** 요청 본문을 안전하게 읽는다 — 깨진 JSON 이 500 이 되지 않게 */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json()
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  } catch {
    throw new CrmError('VALIDATION_FAILED', '요청 형식이 올바르지 않습니다.')
  }
}

/** PATCH 에 반드시 있어야 하는 version — 없으면 잠금이 성립하지 않는다 */
export function requireVersion(body: Record<string, unknown>): number {
  const v = body.version
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
    throw new CrmError('VALIDATION_FAILED',
      '수정하려면 현재 버전이 필요합니다. 새로고침 후 다시 시도해 주세요.', { field: 'version' })
  }
  return v
}

/** 목록 쿼리 — 커서·개수·검색어를 한 곳에서 읽는다 */
export function readListQuery(req: Request): { cursor: string | null; limit: number; q: string | null } {
  const sp = new URL(req.url).searchParams
  const rawLimit = Number(sp.get('limit'))
  return {
    cursor: sp.get('cursor'),
    limit: Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 20,
    q: sp.get('q'),
  }
}
