/**
 * 예전 공개 쓰기 창구 감사 장치 (P0162 I03)
 *
 * 관문(lib/actions/dispatch.ts)을 안 지나는 손으로 쓴 공개 쓰기 창구도 api_write_audit 에 남긴다
 * 신원은 authenticatePublicApi 가 키와 계정을 확인한 뒤 남긴 것만 쓴다, 없으면 기록하지 않는다
 * 줄 모양은 api-audit.ts 의 writeAuditRow 가 정하고 여기는 넣기만 한다
 * 본문과 키 값은 읽지도 남기지도 않는다
 */
import 'server-only'
import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { identityOf, writeAuditRow } from './api-audit'

const REQUEST_ID_MAX = 100

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RouteHandler = (request: NextRequest, context: any) => Promise<Response>

async function insertAudit(name: string, request: NextRequest, status: number): Promise<void> {
  const identity = identityOf(request)
  if (!identity) return
  const row = writeAuditRow({
    identity,
    name,
    method: request.method,
    url: request.url,
    headers: request.headers,
    status,
    requestId: request.headers.get('x-request-id')?.slice(0, REQUEST_ID_MAX) || crypto.randomUUID(),
  })
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any
    const { error } = await admin.from('api_write_audit').insert(row)
    if (error) console.error('[write-audit] insert', error.code, name)
  } catch (e) {
    console.error('[write-audit] insert', (e as { code?: string })?.code ?? 'unknown', name)
  }
}

/** 창구 처리기를 감싸 응답 상태와 함께 기록한다, 던진 오류는 500 으로 남기고 다시 던진다 */
export function withWriteAudit(name: string, handler: RouteHandler): RouteHandler {
  return async (request, context) => {
    let status = 500
    try {
      const response = await handler(request, context)
      status = response.status
      return response
    } finally {
      await insertAudit(name, request, status)
    }
  }
}
