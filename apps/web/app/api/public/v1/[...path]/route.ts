// 공개 API 관문 (P0158 I07), 정의 표의 모든 줄이 이 입구로 들어온다
// 따로 있는 공개 라우트가 이기고, 그 라우트에 없는 메서드는 그 파일이 같은 입구를 재수출한다
import type { NextRequest } from 'next/server'
import { dispatchPublicApi } from '@/lib/actions/dispatch'

export const runtime = 'nodejs'
export const maxDuration = 60

// 몸통 첫 줄이 authenticatePublicApi 다 (lib/actions/dispatch.ts)
const enter = (request: NextRequest) => dispatchPublicApi(request)

export const GET = enter
export const POST = enter
export const PUT = enter
export const PATCH = enter
export const DELETE = enter
export const OPTIONS = enter
