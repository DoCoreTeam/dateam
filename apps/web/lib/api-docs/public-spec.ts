/**
 * 공개 API 명세 한 벌, 서버의 /api/public/v1/openapi.json 과 teamda CLI 에 박는 명세가 같은 함수에서 나온다
 *
 * 왜 따로 뺐나 (P0173): CLI 는 정의 표 생성물(lib/actions/generated/openapi.json)만 박았고
 * 서버는 거기에 등재 표(registry)의 본문 정의를 합쳐 줬다. 그래서 등재 표에만 본문이 있는
 * gpu quote, gpu pool-stock create-v1, gpu settings update-v1, gpu supplier create-v1 이
 * sync 전의 CLI 에서 본문 없는 명령이 되어 칸이 주소 뒤로 붙었고 서버는 「본문이 올바른 JSON 이 아님」으로 막았다
 *
 * 생성물은 인자로 받는다, JSON import 방식이 Next 와 node 시험과 bun 박제에서 서로 달라서
 */
import { ENDPOINTS, API_GROUPS, type ApiEndpoint } from './registry.ts'
import { mergeSpecs, paramSchema, standardResponses } from '../actions/openapi.ts'

type Json = Record<string, unknown>

/** 등재 표와 정의 표 생성물을 합친 명세, base 는 servers 에 싣는 주소 */
export function publicSpec(base: string, generated: Json): Json {
  const paths: Record<string, Record<string, unknown>> = {}
  for (const e of ENDPOINTS) {
    const item = (paths[e.path] ??= {})
    item[e.method.toLowerCase()] = operation(e)
  }
  return mergeSpecs({
    openapi: '3.1.0',
    info: {
      title: '사내 자동화 API',
      version: '1',
      description:
        '지금 배포된 사내 자동화 API 의 엔드포인트 전체입니다. 모든 요청에 X-API-Key 헤더(또는 Authorization: Bearer <키>)가 필요하고, 키는 「내 키 관리」에서 발급합니다. 배포가 바뀌면 이 스펙도 함께 바뀌므로 코드 생성 전에 다시 받아 쓰세요.',
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
  }, generated)
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
      description: p.desc, schema: paramSchema(p.type),
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
    responses: standardResponses({ method: e.method }),
  }
}
