/**
 * 개발자센터 CLI 명령 참조의 데이터와 검색 (P0168)
 *
 * 화면(app/develop/ActionReference.tsx)은 이 파일을 그리기만 한다
 * 목록은 손으로 적지 않는다, CliSection 이 여는 그 생성물(lib/actions/generated/openapi.json)에서 만든다
 *
 * 왜 표를 버렸나: 802개를 표 한 장에 넣자 390 폭에서 쪽 길이가 102,553px, 명령 칸이 1,236번 꺾였다
 *   영역별로 접고, 명령은 줄바꿈 없이 옆으로 밀리게 하고, 펼친 것만 그린다
 *
 * 검색은 낱말 단위다: 「crm companies」 가 crm company 명령과 /companies 경로를 같이 찾는다
 *   예전 검색은 문장 전체를 한 덩이로 includes 해서 낱말 순서나 복수형이 다르면 0건이었다
 */

import { API_CLI_DOC } from '../terms/api-key.ts'
import { LANGUAGES, placeholderPath, type HttpMethod } from './snippets.ts'
import { ENDPOINTS } from './registry.ts'

/** scripts/cli/gen.mjs AREAS 와 같은 순서, action-ref.test.ts 가 대조한다 */
export const ACTION_AREAS = ['work', 'crm', 'ci', 'studio', 'rfp', 'trading', 'gpu', 'admin', 'meta'] as const
export type ActionArea = (typeof ACTION_AREAS)[number]

/** scripts/cli/gen.mjs AREA_LABEL 과 같은 말, action-ref.test.ts 가 대조한다 */
export const ACTION_AREA_LABEL: Record<ActionArea, string> = {
  work: '사내 업무', crm: '영업 CRM', ci: '콘텐츠 인텔리전스', studio: 'AI 스튜디오', rfp: 'RFP 분석기',
  trading: 'AI 트레이딩', gpu: '가격정책', admin: '관리자 설정', meta: '공통',
}

/** 화면 문구, 뒤에 lib/terms 로 옮긴다 */
export const ACTION_REF_COPY = {
  search: API_CLI_DOC.search,
  searchPlaceholder: '예: crm companies',
  total: API_CLI_DOC.total,
  command: API_CLI_DOC.command,
  scope: API_CLI_DOC.scope,
  path: API_CLI_DOC.path,
  empty: '찾는 명령이 없습니다. 다른 낱말로 검색해 보세요',
  params: '매개변수',
  noParams: '매개변수 없음',
  inPath: '경로',
  inQuery: '쿼리',
  required: '필수',
  body: '본문',
  bodyFree: '정해진 칸이 없는 JSON 객체, --json 으로 넘깁니다',
  noBody: '본문 없음',
  example: '예시',
  count: (n: number): string => `${n.toLocaleString()}개`,
} as const

export interface ActionParam {
  name: string
  in: 'path' | 'query'
  required: boolean
  values: readonly string[]
}

export interface ActionRefEntry {
  id: string
  area: ActionArea
  areaLabel: string
  /** teamda 로 시작하는 명령 */
  command: string
  method: string
  /** 공개 경로, servers 주소 뒤 */
  path: string
  scope: string
  kind: 'route' | 'action'
  params: readonly ActionParam[]
  /** 본문 칸 이름, null 이면 정해진 칸이 없는 객체, 빈 배열이면 본문 없음 */
  bodyFields: readonly string[] | null
  /** 그대로 붙여 넣어 고칠 명령 한 줄, 자리표시는 <이름> */
  /** 개발자센터 등록부에 같은 동작의 본문 예시가 있으면 그 값, 예시를 복사해 바로 부를 수 있게 */
  bodyExample: Record<string, unknown> | null
  cliExample: string
  /** 검색용 낱말, 정규화된 꼴과 원래 꼴 */
  tokens: readonly string[]
}

export interface ActionRefGroup {
  area: ActionArea
  label: string
  entries: readonly ActionRefEntry[]
}

export interface ActionRefResult {
  groups: readonly ActionRefGroup[]
  /** 찾은 명령 수 */
  count: number
}

const DRY_RUN = 'dryRun'

/** 낱말 하나를 단수 꼴로, companies 와 company 가 같은 낱말이 되게 */
export function singular(word: string): string {
  const w = word.toLowerCase()
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`
  if (w.length > 4 && /(s|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2)
  if (w.length > 3 && w.endsWith('s') && !/(ss|us|is)$/.test(w)) return w.slice(0, -1)
  return w
}

/** 낱말 둘이 같은 낱말인가, 한쪽만 줄여도 맞으면 같다 (aliases 와 alias) */
export function sameWord(a: string, b: string): boolean {
  const x = a.toLowerCase()
  const y = b.toLowerCase()
  if (x === y) return true
  const sx = singular(x)
  const sy = singular(y)
  return sx === sy || sx === y || x === sy
}

/** 글을 검색 낱말로 쪼갠다, 공백과 / . - _ { } 와 낙타 꼴 경계에서 */
export function wordsOf(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s/._\-{}()[\]:,]+/)
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean)
}

/** 검색어 낱말 하나가 항목 낱말 하나에 맞나, 세 글자 넘게 친 것은 앞부분만 맞아도 맞다 */
function tokenHits(q: string, t: string): boolean {
  if (sameWord(q, t)) return true
  return q.length >= 3 && t.startsWith(q)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Op = Record<string, any>

function areaOf(op: Op): ActionArea {
  const tag = (op.tags?.[0] ?? String(op['x-cli']).split(' ')[0]) as string
  return (ACTION_AREAS as readonly string[]).includes(tag) ? (tag as ActionArea) : 'meta'
}

function paramsOf(op: Op): ActionParam[] {
  const list: Op[] = Array.isArray(op.parameters) ? op.parameters : []
  return list
    .filter((p) => p.in === 'path' || p.in === 'query')
    .map((p) => ({
      name: String(p.name),
      in: p.in,
      required: p.in === 'path' || p.required === true,
      values: Array.isArray(p.schema?.enum) ? p.schema.enum.map(String) : [],
    }))
}

function bodyFieldsOf(op: Op): string[] | null {
  if (!op.requestBody) return []
  const props = op.requestBody.content?.['application/json']?.schema?.properties
  return props ? Object.keys(props) : null
}

const routeKey = (method: string, path: string) =>
  `${method.toUpperCase()} ${path.replace(/\{[^}]+\}|:[A-Za-z_]+/g, '{}')}`

/** 등록부 본문 예시 표, 경로 변수 이름이 달라도 같은 자리면 같은 동작 */
const BODY_EXAMPLES: ReadonlyMap<string, Record<string, unknown>> = new Map(
  ENDPOINTS.filter((e) => e.bodyExample).map((e) => [routeKey(e.method, e.path), e.bodyExample as Record<string, unknown>]),
)

const shellJson = (v: unknown) => `'${JSON.stringify(v).replace(/'/g, `'\\''`)}'`

function cliExampleOf(command: string, params: readonly ActionParam[], body: readonly string[] | null, example: Record<string, unknown> | null = null): string {
  const parts = [command]
  for (const p of params) if (p.in === 'path') parts.push(`<${p.name}>`)
  for (const p of params) if (p.in === 'query' && p.required && p.name !== DRY_RUN) parts.push(`--${p.name} <${p.name}>`)
  if (example) parts.push(`--json ${shellJson(example)}`)
  else if (body === null) parts.push(`--json '{}'`)
  else for (const f of body) if (f !== 'args') parts.push(`--${f} <${f}>`)
  return parts.join(' ')
}

function entryOf(path: string, method: string, op: Op): ActionRefEntry {
  const area = areaOf(op)
  const cli = String(op['x-cli'])
  const command = `teamda ${cli}`
  const params = paramsOf(op)
  const bodyFields = bodyFieldsOf(op)
  const bodyExample = BODY_EXAMPLES.get(routeKey(method, path)) ?? null
  const label = ACTION_AREA_LABEL[area]
  const raw = [
    ...wordsOf(cli), ...wordsOf(path), ...wordsOf(String(op.operationId ?? '')),
    ...wordsOf(String(op.summary ?? '')), area, ...wordsOf(label), method.toLowerCase(),
  ]
  return {
    id: `${method.toUpperCase()} ${path}`,
    area, areaLabel: label, command,
    method: method.toUpperCase(), path,
    scope: String(op['x-scope'] ?? ''),
    kind: op['x-kind'] === 'action' ? 'action' : 'route',
    params, bodyFields, bodyExample,
    cliExample: cliExampleOf(command, params, bodyFields, bodyExample),
    tokens: [...new Set(raw)],
  }
}

/** 생성물 한 벌을 명령 항목으로, x-cli 가 있는 동작만 */
export function buildActionEntries(spec: unknown): ActionRefEntry[] {
  const paths = ((spec as Op)?.paths ?? {}) as Record<string, Op>
  const out: ActionRefEntry[] = []
  for (const [path, item] of Object.entries(paths)) {
    for (const [method, op] of Object.entries(item ?? {})) {
      if (op && typeof op === 'object' && op['x-cli']) out.push(entryOf(path, method, op))
    }
  }
  return out.sort((a, b) => a.command.localeCompare(b.command))
}

/** 검색어의 낱말이 전부 맞는 항목만, 빈 검색어는 전부 */
export function matchesQuery(entry: ActionRefEntry, query: string): boolean {
  const qs = wordsOf(query)
  return qs.every((q) => entry.tokens.some((t) => tokenHits(q, t)))
}

/** 영역별로 묶는다, 영역 순서는 ACTION_AREAS, 빈 영역은 뺀다 */
export function groupActions(entries: readonly ActionRefEntry[], query = ''): ActionRefResult {
  const hit = entries.filter((e) => matchesQuery(e, query))
  const groups = ACTION_AREAS
    .map((area) => ({ area, label: ACTION_AREA_LABEL[area], entries: hit.filter((e) => e.area === area) }))
    .filter((g) => g.entries.length > 0)
  return { groups, count: hit.length }
}

/** 항목의 curl 예시, 주소 생성은 개발자센터 예시 SSOT(snippets.ts) 를 그대로 쓴다 */
export function curlExample(entry: ActionRefEntry, baseUrl: string): string {
  const curl = LANGUAGES.find((l) => l.id === 'curl')
  if (!curl) return ''
  const query: Record<string, string> = {}
  for (const p of entry.params) if (p.in === 'query' && p.required && p.name !== DRY_RUN) query[p.name] = `<${p.name}>`
  const body = entry.bodyExample ?? (entry.bodyFields === null
    ? {}
    : entry.bodyFields.length > 0
      ? Object.fromEntries(entry.bodyFields.filter((f) => f !== 'args').map((f) => [f, `<${f}>`]))
      : undefined)
  return curl.generate({
    method: entry.method as HttpMethod,
    path: placeholderPath(entry.path),
    query: Object.keys(query).length > 0 ? query : undefined,
    body,
  }, baseUrl)
}
