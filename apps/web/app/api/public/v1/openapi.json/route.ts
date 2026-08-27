/**
 * OpenAPI 3.1 스펙 — `lib/api-docs/registry.ts` 에서 **생성**한다.
 *
 * 손으로 쓴 스펙은 코드와 갈린다. 그게 개발자센터가 73일 멈춰 있던 이유다.
 * 여기서는 registry 가 유일한 입력이므로, 엔드포인트를 등재하면 스펙도 같이 늘어난다.
 *
 * 키를 요구한다 — 이 API 는 사내 자동화용이고 스펙도 사내 문서다.
 */
import type { NextRequest } from 'next/server'
import { authenticatePublicApi, optionsResponse } from '@/lib/publicApiAuth'
import { ok } from '@/lib/public-api/respond'
import { ENDPOINTS, API_GROUPS, type ApiEndpoint } from '@/lib/api-docs/registry'

export async function OPTIONS(request: NextRequest) {
  return optionsResponse(request)
}

export async function GET(request: NextRequest) {
  const auth = await authenticatePublicApi(request)
  if ('error' in auth) return auth.error

  const base = `${request.nextUrl.origin}/api/public/v1`
  const paths: Record<string, Record<string, unknown>> = {}

  for (const e of ENDPOINTS) {
    const item = (paths[e.path] ??= {})
    item[e.method.toLowerCase()] = operation(e)
  }

  return ok({
    openapi: '3.1.0',
    info: {
      title: '사내 자동화 API',
      version: '1',
      description:
        '이 스펙은 lib/api-docs/registry.ts 에서 생성됩니다. 손으로 고치지 마세요 — 다음 배포에 덮입니다.',
    },
    servers: [{ url: base }],
    tags: API_GROUPS.filter((g) => g.key !== 'start' && g.key !== 'ref')
      .map((g) => ({ name: g.label, description: g.desc })),
    components: {
      securitySchemes: {
        apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
      },
    },
    security: [{ apiKey: [] }],
    paths,
  }, { ctx: auth.ctx, request })
}

/** `/crm/companies/{id}` → ['id'] */
function pathParams(path: string): string[] {
  const out: string[] = []
  const re = /\{(\w+)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(path)) !== null) out.push(m[1])
  return out
}

function operation(e: ApiEndpoint): Record<string, unknown> {
  const group = API_GROUPS.find((g) => g.key === e.group)
  const params = [
    // 경로 변수는 정규식으로 훑는다 — 이터레이터 스프레드는 tsconfig target 이 막는다
    ...pathParams(e.path).map((name) => ({
      name, in: 'path', required: true, schema: { type: 'string' },
    })),
    ...(e.query ?? []).map((p) => ({
      name: p.name, in: 'query', required: !!p.required,
      description: p.desc, schema: { type: 'string' },
    })),
  ]

  return {
    operationId: e.id,
    summary: e.title,
    // 이관 중이면 대안을 설명에 함께 싣는다 — 스펙만 보고 쓰는 사람이 있다
    description: e.deprecatedNote ? `${e.desc}\n\n${e.deprecatedNote}` : e.desc,
    tags: group ? [group.label] : [],
    deprecated: e.status === 'deprecated',
    ...(params.length ? { parameters: params } : {}),
    ...(e.body?.length
      ? {
          requestBody: {
            required: e.body.some((b) => b.required),
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: e.body.filter((b) => b.required).map((b) => b.name),
                  properties: Object.fromEntries(
                    e.body.map((b) => [b.name, { description: b.desc }]),
                  ),
                },
              },
            },
          },
        }
      : {}),
    responses: {
      200: { description: '성공' },
      401: { description: 'API 키가 없거나 유효하지 않음' },
      403: { description: '권한 없음' },
      429: { description: '분당 요청 한도 초과 — Retry-After 헤더를 확인하세요' },
    },
  }
}
