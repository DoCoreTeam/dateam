/**
 * OpenAPI 3.1 스펙 — `lib/api-docs/registry.ts` 에서 **생성**한다.
 *
 * 손으로 쓴 스펙은 코드와 갈린다. 그게 개발자센터가 73일 멈춰 있던 이유다.
 * 여기서는 registry 가 유일한 입력이므로, 엔드포인트를 등재하면 스펙도 같이 늘어난다.
 *
 * 정의 표 생성물(lib/actions/generated/openapi.json)을 합쳐 CLI 명령(x-cli)과 범위(x-scope)를 싣는다
 *
 * 키를 요구한다 — 이 API 는 사내 자동화용이고 스펙도 사내 문서다.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { authenticatePublicApi, optionsResponse } from '@/lib/publicApiAuth'
import { responseHeaders } from '@/lib/public-api/respond'
import { publicSpec } from '@/lib/api-docs/public-spec'
import generated from '@/lib/actions/generated/openapi.json'

export async function OPTIONS(request: NextRequest) {
  return optionsResponse(request)
}

export async function GET(request: NextRequest) {
  const auth = await authenticatePublicApi(request)
  if ('error' in auth) return auth.error

  // 정의 표의 모든 동작이 x-cli x-scope 와 함께 실린다 (P0158 I08), teamda sync 가 이것을 받는다
  // 봉투 없이 문서 그대로 준다 (P0165 I04): 코드 생성 도구는 최상위 openapi 키를 읽는다
  // 헤더(CORS, 한도)는 다른 공개 응답과 같은 responseHeaders 로 싣는다
  // CLI 가 박는 명세도 같은 publicSpec 에서 나온다 (P0173)
  const spec = publicSpec(`${request.nextUrl.origin}/api/public/v1`, generated)
  return NextResponse.json(spec, { headers: responseHeaders({ ctx: auth.ctx, request }) })
}
