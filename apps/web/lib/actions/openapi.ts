/**
 * 기능 정의에서 OpenAPI 3.1 문서를 만든다
 *
 * 서버의 /api/public/v1/openapi.json 과 CLI 빌드(scripts/cli/gen.mjs)가 같은 함수를 쓴다
 * 그래서 CLI 에 들어간 명령 표와 서버가 주는 명령 표가 갈라질 수 없다
 * x-cli 는 CLI 명령, x-scope 는 필요한 키 범위, x-spec-hash 는 teamda sync 가 캐시를 갈지 정하는 값
 */
import type { Scope } from './types.ts'

export interface OpenApiMounted {
  name: string
  scope: Scope
  cli: string
  kind: 'route' | 'action'
  method: string
  mount: string
  internal: string
  params: string[]
  summary: string
}

export interface OpenApiExisting {
  name: string
  scope: Scope
  cli: string
  method: string
  mount: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

/** 순수 해시 (FNV-1a 32비트 두 번), 모듈 의존 없이 서버와 node 스크립트 양쪽에서 같은 값 */
export function specHash(text: string): string {
  let a = 0x811c9dc5
  let b = 0x01000193
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193) >>> 0
    b = Math.imul(b ^ c ^ (i & 0xff), 0x811c9dc5) >>> 0
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0')
}

const pathParams = (mount: string): string[] => [...mount.matchAll(/\{(\w+)\*?\}/g)].map((m) => m[1])

/** {path*} 꼴은 OpenAPI 에 맞게 {path} 로 */
const oaPath = (mount: string): string => mount.replace(/\{(\w+)\*\}/g, '{$1}')

function mountedOperation(m: OpenApiMounted): Json {
  const params = pathParams(m.mount).map((name) => ({ name, in: 'path', required: true, schema: { type: 'string' } }))
  const op: Json = {
    operationId: m.name,
    summary: m.summary || m.name,
    tags: [m.name.split('.')[0]],
    'x-cli': m.cli,
    'x-scope': m.scope,
    'x-kind': m.kind,
    'x-internal': m.internal,
    parameters: [
      ...params,
      ...(m.method === 'GET' ? [] : [{ name: 'dryRun', in: 'query', required: false, schema: { type: 'string', enum: ['1'] } }]),
    ],
    responses: {
      200: { description: '성공, data 는 화면이 받는 값과 같음' },
      202: { description: '이 키에 범위가 없어 승인 요청이 만들어짐' },
      400: { description: '입력 오류' }, 401: { description: '키 없음' }, 403: { description: '범위 또는 권한 부족' },
      404: { description: '없음' }, 409: { description: '버전 충돌' }, 429: { description: '한도 초과' },
    },
  }
  if (m.kind === 'action') {
    op['x-args'] = m.params
    op.requestBody = {
      required: false,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            description: '서버 액션 인자, 이름으로 주거나 args 배열로 줌',
            properties: Object.fromEntries([
              ...m.params.map((p) => [p, {}]),
              ['args', { type: 'array' }],
            ]),
          },
        },
      },
    }
  } else if (m.method !== 'GET' && m.method !== 'DELETE') {
    op.requestBody = { required: false, content: { 'application/json': { schema: { type: 'object' } } } }
  }
  return op
}

export function buildOpenApi(mounted: OpenApiMounted[], existing: OpenApiExisting[], base?: Json): Json {
  const doc: Json = base ? JSON.parse(JSON.stringify(base)) : {
    openapi: '3.1.0',
    info: { title: 'teamda API', version: 'v1' },
    servers: [{ url: '/api/public/v1' }],
    components: { securitySchemes: { ApiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' } } },
    security: [{ ApiKey: [] }],
    paths: {},
  }
  doc.paths ??= {}
  for (const e of existing) {
    const p = oaPath(e.mount)
    doc.paths[p] ??= {}
    const lower = e.method.toLowerCase()
    doc.paths[p][lower] = {
      ...(doc.paths[p][lower] ?? { operationId: e.name, summary: e.name, responses: { 200: { description: '성공' } } }),
      'x-cli': e.cli,
      'x-scope': e.scope,
      'x-kind': 'public',
      parameters: doc.paths[p][lower]?.parameters ?? pathParams(e.mount).map((name) => ({ name, in: 'path', required: true, schema: { type: 'string' } })),
    }
  }
  for (const m of mounted) {
    const p = oaPath(m.mount)
    doc.paths[p] ??= {}
    doc.paths[p][m.method.toLowerCase()] = mountedOperation(m)
  }
  const sig = [...existing.map((e) => `${e.method} ${e.mount} ${e.cli} ${e.scope}`), ...mounted.map((m) => `${m.method} ${m.mount} ${m.cli} ${m.scope} ${m.params.join(',')}`)].join('\n')
  doc['x-spec-hash'] = specHash(sig)
  return doc
}
