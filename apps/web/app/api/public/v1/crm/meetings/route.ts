import { dispatchPublicApi } from '@/lib/actions/dispatch'
import type { NextRequest } from 'next/server'
import { optionsResponse } from '@/lib/publicApiAuth'
import { withPublicCrmApi, readPublicListQuery } from '@/lib/public-api/crm-bridge'
import { listMeetingsPage } from '@/lib/crm/services/meeting'

// 미팅 목록 — 커서 페이지 버전을 쓴다

export async function OPTIONS(request: NextRequest) {
  return optionsResponse(request)
}

export async function GET(request: NextRequest) {
  return withPublicCrmApi('READONLY', request, ({ db }) =>
    listMeetingsPage(db, readPublicListQuery(request)))
}

// 정의 표의 쓰기는 공개 API 관문으로 (P0158 I07)
export const POST = dispatchPublicApi
