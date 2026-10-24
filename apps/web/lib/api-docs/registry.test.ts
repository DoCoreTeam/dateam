// lib/api-docs/registry.test.ts — 문서와 코드가 어긋나면 여기서 막힌다
//
// 배경: `/develop` 이 손으로 쓴 940줄이라 엔드포인트를 추가해도 문서가 안 늘었다.
//   664커밋 동안 `app/api` 에 라우트 167개가 생기는 사이 `app/api/public` 은 0건이었고,
//   문서는 2026-05-31 문장 그대로 「분당 60회」처럼 없는 기능을 약속했다.
//   그 어긋남이 **아무 신호도 내지 않았다는 것**이 진짜 결함이다. 이 파일이 그 신호다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ENDPOINTS, API_GROUPS, toRoutePath } from './registry.ts'
import { MOUNTED } from '../actions/generated/table.ts'
import { QUOTE_EXPORT_FORMATS } from '../quote-export/quote-export.ts'
import { QUOTE_PUBLIC_HIDDEN } from '../crm/services/quote-pricing-fields.ts'
import { CRM_ERROR_HTTP } from '../crm/domain/errors.ts'
import { API_APPROVAL_STATUS } from '../terms/api-key.ts'

const ROOT = 'app/api/public/v1'

/** 라우트 파일에서 실제로 export 된 메서드 */
function methodsOf(file: string): string[] {
  const src = readFileSync(file, 'utf8')
  return [...src.matchAll(/export async function (GET|POST|PATCH|PUT|DELETE)\b/g)].map((m) => m[1])
}

/** `app/api/public/v1/crm/companies/[id]/route.ts` → `/crm/companies/:id` */
function urlOf(file: string): string {
  return file.replace(new RegExp(`^${ROOT}`), '').replace(/\/route\.ts$/, '')
    .replace(/\[(\w+)\]/g, ':$1') || '/'
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (entry === 'route.ts') out.push(p)
  }
  return out
}

/** 코드에 실재하는 (경로, 메서드) 전부 */
function actualPairs(): Set<string> {
  const set = new Set<string>()
  for (const file of walk(ROOT)) {
    for (const m of methodsOf(file)) set.add(`${m} ${urlOf(file)}`)
  }
  return set
}

const registered = new Set(ENDPOINTS.map((e) => `${e.method} ${toRoutePath(e.path)}`))

test('★ 라우트를 만들고 등재를 잊으면 막힌다 — 이게 문서가 썩던 자리다', () => {
  const missing = [...actualPairs()].filter((p) => !registered.has(p)).sort()
  assert.deepEqual(missing, [],
    '이 엔드포인트가 코드에는 있는데 lib/api-docs/registry.ts 에 없다.\n' +
    '등재하지 않으면 /develop 과 openapi.json 에 나타나지 않아 아무도 못 쓴다:\n  ' + missing.join('\n  '))
})

/** 관문([...path])이 정의 표로 여는 (경로, 메서드). 따로 된 라우트 파일이 없어도 부르면 답한다 */
const mountedPairs = new Set(MOUNTED.map((op) => `${op.method} ${toRoutePath(op.mount)}`))

test('★ 등재해 놓고 만들지 않은 엔드포인트가 없다 — 문서가 없는 기능을 약속하면 안 된다', () => {
  const actual = new Set([...actualPairs(), ...mountedPairs])
  const ghost = [...registered].filter((p) => !actual.has(p)).sort()
  assert.deepEqual(ghost, [],
    '이 엔드포인트가 문서에는 있는데 코드에 없다. 부르면 404 다:\n  ' + ghost.join('\n  '))
})

test('식별자가 겹치지 않는다 — OpenAPI operationId 이자 화면 앵커다', () => {
  const ids = ENDPOINTS.map((e) => e.id)
  assert.equal(new Set(ids).size, ids.length, `중복 id: ${ids.filter((v, i) => ids.indexOf(v) !== i).join(', ')}`)
})

test('모든 엔드포인트가 실재하는 묶음에 속한다', () => {
  const keys = new Set(API_GROUPS.map((g) => g.key))
  const orphan = ENDPOINTS.filter((e) => !keys.has(e.group)).map((e) => e.id)
  assert.deepEqual(orphan, [], `묶음이 없는 엔드포인트: ${orphan.join(', ')}`)
})

test('★ 이관 중이라고 표시했으면 어디로 옮기라는지 함께 적는다', () => {
  const silent = ENDPOINTS.filter((e) => e.status === 'deprecated' && !e.deprecatedNote).map((e) => e.id)
  assert.deepEqual(silent, [],
    `이관 중인데 대안을 안 알려 준다 — 사용자는 계속 쓸 수밖에 없다: ${silent.join(', ')}`)
})

test('★ 경로는 v1 기준 상대다 — /api/public/v1 을 또 적으면 주소가 두 번 들어간다', () => {
  const wrong = ENDPOINTS.filter((e) => !e.path.startsWith('/') || e.path.includes('/api/')).map((e) => e.id)
  assert.deepEqual(wrong, [], `경로 형식이 틀렸다: ${wrong.join(', ')}`)
})

test('설명이 비어 있지 않다 — 이름만 있는 목록은 문서가 아니다', () => {
  const empty = ENDPOINTS.filter((e) => !e.title.trim() || !e.desc.trim()).map((e) => e.id)
  assert.deepEqual(empty, [], `제목·설명이 빈 엔드포인트: ${empty.join(', ')}`)
})

/* ── P0164 I04: 등록부가 싣는 칸이 코드가 실제로 읽고 싣는 것과 같다 ───────────────── */

const byId = (id: string) => {
  const e = ENDPOINTS.find((x) => x.id === id)
  assert.ok(e, `등록부에 ${id} 가 없다`)
  return e
}

/** 라우트의 ok({ ... }) 안 최상위 키. 주석은 빼고 센다, 주석에 적힌 이름은 응답에 없다 */
function okKeys(file: string): string[] {
  const src = readFileSync(file, 'utf8').replace(/\/\/.*$/gm, '')
  const m = /return ok\(\{([\s\S]*?)\}, \{/.exec(src)
  assert.ok(m, `${file} 에서 ok({ ... }) 를 못 찾았다`)
  return [...m[1].matchAll(/(\w+):/g)].map((x) => x[1]).sort()
}

const fieldNames = (id: string) => (byId(id).response?.fields ?? []).map((f) => f.name).sort()

test('★ 견적서 내려받기의 쿼리가 라우트가 실제로 읽는 이름과 같다', () => {
  const e = byId('crm.quotes.export')
  // 공개 경로는 관문이 정의 표로 연다, read 범위로
  const op = MOUNTED.find((o) => o.method === 'GET' && o.mount === e.path)
  assert.ok(op, '정의 표에 이 경로가 없다, 부르면 404 다')
  assert.equal(op.scope, 'read')
  const src = readFileSync('lib/quote-export/quote-export.ts', 'utf8')
  const body = /export function parseQuoteExportRequest[\s\S]*?\n\}/.exec(src)?.[0] ?? ''
  const read = [...body.matchAll(/params\.get\('(\w+)'\)/g)].map((m) => m[1]).sort()
  assert.ok(read.length > 0, 'parseQuoteExportRequest 에서 읽는 쿼리를 못 찾았다')
  assert.deepEqual((e.query ?? []).map((q) => q.name).sort(), read)
  const format = e.query!.find((q) => q.name === 'format')!
  for (const f of QUOTE_EXPORT_FORMATS) assert.ok(format.type.includes(`"${f}"`), `format 에 ${f} 가 빠졌다`)
  assert.ok(e.response?.file, '파일 응답이라고 적지 않았다')
})

test('★ 보안: 견적서 내려받기는 2단계 인증 키 소유자 거절을 라우트와 같은 상태로 적는다', () => {
  const route = readFileSync('app/api/crm/quotes/[id]/export/route.ts', 'utf8')
  assert.match(route, /throw new CrmError\('FORBIDDEN', QUOTE_EXPORT\.keyOwnerSecondFactor\)/)
  const e = byId('crm.quotes.export')
  assert.ok(e.desc.includes('2단계 인증'), '2단계 인증 거절을 안 적었다')
  assert.ok(e.desc.includes(String(CRM_ERROR_HTTP.FORBIDDEN)), '거절 상태 코드를 안 적었다')
})

test('★ /me 응답 필드 표가 라우트가 싣는 키와 같다 (expiresAt, remainingThisMinute 포함)', () => {
  const keys = okKeys('app/api/public/v1/me/route.ts')
  assert.ok(keys.includes('expiresAt') && keys.includes('remainingThisMinute'))
  assert.deepEqual(fieldNames('ref.me'), keys)
})

test('★ 승인 요청 응답 필드 표가 라우트가 싣는 키와 같고, 상태 값이 DB 제약과 같다', () => {
  assert.deepEqual(fieldNames('ref.approval'), okKeys('app/api/public/v1/approvals/[id]/route.ts'))
  const sql = readFileSync('../../supabase/migrations/318_api_key_scopes.sql', 'utf8')
  const check = /status in \(([^)]*)\)/.exec(sql)?.[1] ?? ''
  const dbStatus = [...check.matchAll(/'(\w+)'/g)].map((m) => m[1]).sort()
  assert.deepEqual(Object.keys(API_APPROVAL_STATUS).sort(), dbStatus)
  const status = byId('ref.approval').response!.fields!.find((f) => f.name === 'status')!
  for (const v of dbStatus) assert.ok(status.type.includes(`"${v}"`), `status 에 ${v} 가 빠졌다`)
})

test('★ 견적 목록이 공개로 내는 supplyRoundingUnit 을 문서도 적는다', () => {
  const quote = readFileSync('lib/crm/services/quote.ts', 'utf8')
  const select = /\nconst SELECT = \{[\s\S]*?\n\}/.exec(quote)?.[0] ?? ''
  const exposed = /\bsupplyRoundingUnit: true/.test(select)
    && !(QUOTE_PUBLIC_HIDDEN as readonly string[]).includes('supplyRoundingUnit')
  assert.equal(fieldNames('crm.quotes.list').includes('supplyRoundingUnit'), exposed)
})

/* ── P0164 I04a: 문서의 본문 필드와 권한이 라우트가 실제로 읽고 부르는 것과 같다 ───────── */

/** 주석을 뺀 소스, 주석에 적힌 이름(requireAdminApi 등)은 실행되지 않는다 */
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '')

/** `/crm/companies/{id}` → `app/api/public/v1/crm/companies/[id]/route.ts` */
const routeFileOf = (path: string) => `${ROOT}${path.replace(/\{(\w+)\}/g, '[$1]')}/route.ts`

/** 그 메서드의 처리기 몸통. 따로 된 처리기가 없으면(관문이 정의 표로 여는 것) null */
function handlerOf(path: string, method: string): { file: string; whole: string; body: string } | null {
  const file = routeFileOf(path)
  let raw: string
  try { raw = readFileSync(file, 'utf8') } catch { return null }
  const whole = stripComments(raw)
  const start = whole.search(new RegExp(`export async function ${method}\\(`))
  if (start < 0) return null
  const next = whole.indexOf('\nexport ', start + 1)
  return { file, whole, body: whole.slice(start, next < 0 ? undefined : next) }
}

/** 처리기가 부르는 인증 함수 → 등록부 requires 값. 관리자 게이트가 가장 좁으므로 먼저 본다 */
function requiresOf(body: string): string | undefined {
  if (/\brequireAdminKey\(/.test(body)) return 'admin'
  if (/\bwithPublicCrmApi\(/.test(body)) return 'crm-member'
  if (/\bwithPublicCi(List|Api)\(/.test(body)) return 'ci-member'
  if (/\brequireMemberKey\(/.test(body)) return 'member'
  return undefined
}

test('★ 보안: 등록부의 권한 설명이 라우트 처리기가 부르는 인증 함수와 같다', () => {
  const checked: string[] = []
  const wrong: string[] = []
  for (const e of ENDPOINTS) {
    const h = handlerOf(e.path, e.method)
    if (!h) continue
    checked.push(e.id)
    const actual = requiresOf(h.body)
    if (actual !== e.requires) wrong.push(`${e.id}: 문서 ${e.requires ?? '(없음)'} / 코드 ${actual ?? '(없음)'}`)
  }
  assert.ok(checked.length >= 30, `처리기를 찾은 엔드포인트가 너무 적다(${checked.length}), 경로 대조가 깨졌다`)
  assert.deepEqual(wrong, [], '권한 설명이 코드와 다르다. 문서가 더 느슨하면 사용자가 403 을 맞고, 더 좁으면 쓸 수 있는 것을 못 쓴다:\n  ' + wrong.join('\n  '))
})

/** 라우트가 읽는 본문 칸: zod 스키마의 키와 body.X 접근 */
function bodyKeysOf(h: { whole: string; body: string }): Set<string> {
  const zod = [...h.whole.matchAll(/(\w+):\s*z\./g)].map((m) => m[1])
  const direct = [...h.body.matchAll(/\bbody\.(\w+)/g)].map((m) => m[1])
  return new Set([...zod, ...direct])
}

test('★ 문서의 본문 필드 이름이 라우트가 실제로 읽는 칸 안에 있다', () => {
  const checked: string[] = []
  const ghost: string[] = []
  for (const e of ENDPOINTS) {
    if (!e.body?.length) continue
    const h = handlerOf(e.path, e.method)
    if (!h) continue
    const keys = bodyKeysOf(h)
    assert.ok(keys.size > 0, `${h.file} ${e.method} 에서 읽는 본문 칸을 못 찾았다`)
    checked.push(e.id)
    for (const b of e.body) if (!keys.has(b.name)) ghost.push(`${e.id}: ${b.name} (코드: ${[...keys].join(', ')})`)
  }
  assert.ok(checked.length >= 4, `대조한 엔드포인트가 너무 적다(${checked.length})`)
  assert.deepEqual(ghost, [], '문서에 적힌 본문 필드를 라우트가 안 읽는다, 보내도 버려진다:\n  ' + ghost.join('\n  '))
})

test('★ 견적 계산은 줄의 칸과 통화 기본값을 zod 스키마와 같게 적는다', () => {
  const src = stripComments(readFileSync(`${ROOT}/quote/route.ts`, 'utf8'))
  const inner = /items:\s*z\.array\(\s*z\.object\(\{([\s\S]*?)\}\)/.exec(src)?.[1] ?? ''
  const itemKeys = [...inner.matchAll(/(\w+):\s*z\./g)].map((m) => m[1])
  assert.ok(itemKeys.length > 0, 'items 스키마를 못 찾았다')
  const e = byId('gpu.quote.create')
  const items = e.body!.find((b) => b.name === 'items')!
  // 설명 첫머리의 { ... } 가 줄 모양이다, 문장 뒤쪽에서 이름을 언급한 것은 세지 않는다
  const shape = (/^\{([^}]*)\}/.exec(items.desc)?.[1] ?? '').split(',').map((x) => x.trim()).filter(Boolean)
  assert.deepEqual(shape.sort(), [...itemKeys].sort(), 'items 설명의 { ... } 가 스키마의 줄 칸과 다르다')
  const def = /currency:\s*z\.enum\([^)]*\)\.default\('(\w+)'\)/.exec(src)?.[1]
  assert.ok(def, 'currency 기본값을 못 찾았다')
  assert.ok(e.body!.find((b) => b.name === 'currency')!.desc.includes(`기본 ${def}`), `currency 기본값은 ${def} 다`)
})

test('★ 채널 목록의 ownership 값이 도메인 타입과 같다', () => {
  const types = readFileSync('lib/ci/types.ts', 'utf8')
  const values = [...(/type CiChannelOwnership = ([^\n]*)/.exec(types)?.[1] ?? '').matchAll(/'(\w+)'/g)].map((m) => m[1])
  assert.ok(values.length > 0)
  const ownership = byId('ci.channels.list').query!.find((q) => q.name === 'ownership')!
  assert.deepEqual([...ownership.type.matchAll(/"(\w+)"/g)].map((m) => m[1]).sort(), values.sort())
})

test('★ 커서를 읽는 목록만 커서를 적는다 (GPU 목록은 고정 목록, 게시물 목록은 커서)', () => {
  const products = stripComments(readFileSync(`${ROOT}/products/route.ts`, 'utf8'))
  const p = byId('gpu.products.list')
  const productsHasCursor = /cursor/i.test(products)
  assert.equal((p.query ?? []).some((q) => q.name === 'cursor'), productsHasCursor)
  assert.equal((p.sample ?? '').includes('nextCursor'), productsHasCursor)
  const contents = stripComments(readFileSync(`${ROOT}/ci/contents/route.ts`, 'utf8'))
  assert.match(contents, /readCiListCursor\(/)
  assert.ok((byId('ci.contents.list').query ?? []).some((q) => q.name === 'cursor'), '게시물 목록이 cursor 를 읽는데 문서에 없다')
})
