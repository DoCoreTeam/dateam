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
