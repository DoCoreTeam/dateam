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

/** 오류 응답 선언, 모든 동작이 같은 말로 싣는다 (P0165 I04) */
export const ERROR_RESPONSES = {
  400: { description: '입력 오류' },
  401: { description: 'API 키가 없거나 유효하지 않음' },
  403: { description: '범위 또는 권한 부족' },
  404: { description: '없음' },
  409: { description: '충돌, 버전이 다르거나 같은 멱등 키를 다른 요청에 씀' },
  429: { description: '분당 요청 한도 초과: Retry-After 헤더를 확인하세요' },
} as const

/**
 * 동작 하나의 응답 선언
 * POST 는 201(만들어짐), 승인 흐름이 있는 동작은 202(승인 요청 만들어짐), 읽기는 409 를 싣지 않는다
 */
export function standardResponses(opts: { method: string; approval?: boolean; success?: string }): Json {
  const method = opts.method.toUpperCase()
  const out: Json = { 200: { description: opts.success ?? '성공' } }
  if (method === 'POST') out[201] = { description: '만들어짐' }
  if (opts.approval) out[202] = { description: '이 키에 범위가 없어 승인 요청이 만들어짐' }
  for (const [code, r] of Object.entries(ERROR_RESPONSES)) {
    if (code === '409' && method === 'GET') continue
    out[code] = { ...r }
  }
  return out
}

/**
 * JSON 봉투 대신 파일 본문을 돌려주는 동작, 기능 이름 하나에 Content-Type 목록 하나
 * 여기 오른 동작은 200 응답이 application/json 이 아니라 이진 파일로 선언된다
 */
export const FILE_RESPONSES: Record<string, readonly string[]> = {
  'crm.quote.export': ['application/pdf', 'image/png'],
}

/** 파일 본문 200 응답 선언 */
export function fileResponse(types: readonly string[]): Json {
  return {
    description: '성공, JSON 봉투 대신 파일 본문 (오류일 때만 공통 봉투)',
    content: Object.fromEntries(types.map((t) => [t, { schema: { type: 'string', format: 'binary' } }])),
  }
}

/** 200 응답이 파일 본문인가 */
const isFileResponse = (r: Json): boolean =>
  !!r?.content && Object.keys(r.content).length > 0 && !('application/json' in r.content)

/** 문서 표의 형 이름을 JSON 스키마로, 숫자 칸(limit 등)이 문자열로 선언되지 않게 */
export function paramSchema(type: string | undefined): Json {
  switch ((type ?? 'string').toLowerCase()) {
    case 'number': return { type: 'number' }
    case 'integer': return { type: 'integer' }
    case 'boolean': return { type: 'boolean' }
    case 'array': return { type: 'array', items: { type: 'string' } }
    default: return { type: 'string' }
  }
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
    responses: standardResponses({ method: m.method, approval: true, success: '성공, data 는 화면이 받는 값과 같음' }),
  }
  const fileTypes = FILE_RESPONSES[m.name]
  if (fileTypes) op.responses = { ...op.responses, 200: fileResponse(fileTypes) }
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
      ...(doc.paths[p][lower] ?? { operationId: e.name, summary: e.name, responses: standardResponses({ method: e.method }) }),
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

const CLI_FIELDS = ['x-cli', 'x-scope', 'x-kind', 'x-name'] as const

/**
 * 손으로 쓴 공개 API 문서(registry)와 정의 표 생성물을 합친다 (P0158 I08)
 * 이미 문서가 있는 경로는 그 설명과 응답 모양을 그대로 두고 x-cli x-scope 만 붙인다
 * 문서가 없는 정의는 생성물의 동작을 그대로 싣는다, info 의 x-spec-hash 는 합친 경로의 해시
 */
export function mergeSpecs(registry: Json, generated: Json): Json {
  const paths: Json = {}
  for (const [p, item] of Object.entries(registry.paths ?? {})) paths[p] = { ...(item as Json) }
  for (const [p, item] of Object.entries(generated.paths ?? {})) {
    const target = (paths[p] ??= {})
    for (const [method, op] of Object.entries(item as Json)) {
      const gen = op as Json
      if (target[method]) {
        const extra: Json = {}
        for (const f of CLI_FIELDS) if (gen[f] !== undefined) extra[f] = gen[f]
        // 파일 본문 동작은 손으로 쓴 문서가 200 을 JSON 처럼 두어도 생성물의 이진 선언이 이긴다
        if (isFileResponse(gen.responses?.['200'])) extra.responses = { ...target[method].responses, 200: gen.responses['200'] }
        target[method] = { ...target[method], ...extra }
      } else {
        target[method] = gen
      }
    }
  }
  dedupeOperationIds(paths, generated)
  return { ...registry, info: { ...registry.info, 'x-spec-hash': specHash(JSON.stringify(paths)) }, paths }
}

/**
 * 같은 operationId 가 두 경로에 있으면 코드 생성 도구가 멈춘다
 * 정의 표 쪽 이름을 지키고, 옛 경로에 남은 등재 쪽 동작에 .alias 를 붙인다
 */
function dedupeOperationIds(paths: Json, generated: Json): void {
  const owner = new Map<string, string>()
  for (const [p, item] of Object.entries(generated.paths ?? {})) {
    for (const op of Object.values(item as Json)) {
      const id = (op as Json).operationId
      if (typeof id === 'string') owner.set(id, p)
    }
  }
  for (const [p, item] of Object.entries(paths)) {
    for (const [method, op] of Object.entries(item as Json)) {
      const id = (op as Json).operationId
      if (typeof id !== 'string' || !owner.has(id) || owner.get(id) === p) continue
      ;(item as Json)[method] = { ...(op as Json), operationId: `${id}.alias` }
    }
  }
}
