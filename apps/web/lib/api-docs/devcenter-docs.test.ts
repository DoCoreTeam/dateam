/**
 * 개발자센터 문서가 코드와 같은 말을 하는가 (P0164)
 *
 * 인증 절(lib/api-docs/auth-doc.ts)의 범위 표와 만료 표는 Scope 와 lib/terms 에서 파생된다
 * 손으로 옮겨 적은 줄이 생기면 범위나 기간이 바뀔 때 화면만 옛말을 한다, 그것을 여기서 막는다
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SCOPES } from '../actions/types.ts'
import { API_KEY_SCOPE, API_KEY_EXPIRY_OPTIONS, API_KEY_DEFAULT_EXPIRY_DAYS } from '../terms/api-key.ts'
import {
  AUTH_SCOPE_ROWS, AUTH_EXPIRY_ROWS, AUTH_ME_FIELDS, AUTH_ME_SAMPLE, AUTH_EXPIRED_MESSAGE, AUTH_SCOPE_403_SAMPLE, AUTH_DOC,
} from './auth-doc.ts'
import { PUBLIC_PREFIX, WRITE_LIMIT_PER_MINUTE, IDEMPOTENCY_KEY_MAX, HUMAN_ONLY_ACTIONS } from '../actions/dispatch-core.ts'
import { MOUNTED } from '../actions/generated/table.ts'
import { APPROVAL_SCOPES } from '../actions/types.ts'
import { API_APPROVAL_STATUS } from '../terms/api-key.ts'
import {
  GATEWAY_PREFIX, GATEWAY_WRITE_LIMIT, GATEWAY_IDEMPOTENCY_KEY_MAX, GATEWAY_HUMAN_ONLY, GATEWAY_REQUEST_ID_MAX,
  APPROVAL_EXPIRY_HOURS, IDEMPOTENCY_RETENTION_HOURS, GATEWAY_EXAMPLES, GATEWAY_HEADERS, GATEWAY_DOC, GATEWAY_STEPS,
  APPROVAL_202_SAMPLE, HUMAN_ONLY_SAMPLE, HUMAN_ONLY_MESSAGE, DRY_RUN_SAMPLE, APPROVAL_STATUS_ROWS,
} from './gateway-doc.ts'

import {
  CLI_EXIT_ROWS, CLI_SECRET_FLAGS, CLI_RATE_LIMIT_RETRIES, CLI_SERVER_RETRIES, CLI_WINDOWS_TARGET, CLI_BUN_MIN, CLI_DOC,
  CLI_COMMAND_ROWS, CLI_BUILD_SAMPLE, CLI_LOGIN_SAMPLE, CLI_SECRET_REFUSED_SAMPLE, CLI_USE_SAMPLE, CLI_ERROR_SAMPLE, cliConfigSample,
} from './cli-doc.ts'
import { EXIT, exitForStatus } from '../../../../packages/teamda-cli/src/exit.ts'
import { SECRET_FLAGS } from '../../../../packages/teamda-cli/src/args.ts'
import { CRM_ERROR_CODES, CRM_ERROR_HTTP } from '../crm/domain/errors.ts'
import {
  GATEWAY_ERROR_ROWS, CRM_ERROR_ROWS, CRM_ERROR_MEANING, CRM_ERROR_SAMPLE, IDEM_REUSED_ERROR, IDEM_INVALID_ERROR,
  IDEM_REUSED_SAMPLE, IDEM_INVALID_SAMPLE, HTTP_ERROR_ROWS, ERRORS_DOC,
} from './errors-doc.ts'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel: string): string => readFileSync(join(WEB, rel), 'utf8')

test('범위 표의 줄은 Scope 의 구성원과 같고 문구는 API_KEY_SCOPE 에서 온다', () => {
  assert.deepEqual(AUTH_SCOPE_ROWS.map((r) => r.scope), [...SCOPES])
  for (const r of AUTH_SCOPE_ROWS) assert.equal(r.label, API_KEY_SCOPE[r.scope], r.scope)
  // Scope 형 자체와 SCOPES 배열이 갈라지면 표가 형에 없는 범위를 보인다
  const src = read('lib/actions/types.ts')
  const union = /export type Scope = ([^\n]+)/.exec(src)?.[1] ?? ''
  const members = [...union.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
  assert.deepEqual(members, [...SCOPES])
})

test('만료 표는 API_KEY_EXPIRY_OPTIONS 와 같고 기본값은 하나뿐이다', () => {
  assert.deepEqual(AUTH_EXPIRY_ROWS.map((r) => [r.days, r.label]), API_KEY_EXPIRY_OPTIONS.map((o) => [o.days, o.label]))
  const defaults = AUTH_EXPIRY_ROWS.filter((r) => r.isDefault)
  assert.equal(defaults.length, 1)
  assert.equal(defaults[0].days, API_KEY_DEFAULT_EXPIRY_DAYS)
  // 키 만들기 창구의 기본값과 화면이 말하는 기본값이 같아야 한다
  const create = read('lib/public-api/key-create.ts')
  const serverDefault = Number(/KEY_EXPIRY_DEFAULT_DAYS = (\d+)/.exec(create)?.[1])
  assert.equal(serverDefault, API_KEY_DEFAULT_EXPIRY_DAYS)
})

test('GET /me 의 필드와 예시는 me 라우트가 실제로 내보내는 이름이다', () => {
  const route = read('app/api/public/v1/me/route.ts')
  const okBody = /return ok\(\{([\s\S]*?)\}, \{/.exec(route)?.[1] ?? ''
  const emitted = [...okBody.matchAll(/^\s*([a-zA-Z]+):/gm)].map((m) => m[1])
  assert.ok(emitted.includes('expiresAt') && emitted.includes('remainingThisMinute'), '라우트에 두 필드가 있어야 한다')
  assert.deepEqual(AUTH_ME_FIELDS.map((f) => f.name), emitted)
  const sample = JSON.parse(AUTH_ME_SAMPLE) as { success: boolean; data: Record<string, unknown> }
  assert.equal(sample.success, true)
  assert.deepEqual(Object.keys(sample.data), emitted)
})

test('403 예시는 게이트웨이가 보내는 몸통과 같은 모양이다', () => {
  const dispatch = read('lib/actions/dispatch.ts')
  assert.match(dispatch, /error: `이 작업에는 \$\{decision\.requiredScope\} 범위가 필요합니다\.`, requiredScope: decision\.requiredScope/)
  const body = JSON.parse(AUTH_SCOPE_403_SAMPLE.replace(/^\/\/.*\n/, '')) as Record<string, unknown>
  assert.deepEqual(Object.keys(body), ['success', 'error', 'requiredScope'])
  assert.equal(body.error, `이 작업에는 ${String(body.requiredScope)} 범위가 필요합니다.`)
  // 만료 문구는 인증 코드의 문구 그대로
  assert.ok(read('lib/publicApiAuth.ts').includes(`'${AUTH_EXPIRED_MESSAGE}'`))
})

test('인증 절은 실제 권한과 403 과 만료와 한 번만 보이는 키와 /me 를 말한다', () => {
  const text = Object.values(AUTH_DOC).map((v) => (typeof v === 'string' ? v : '')).join('\n')
  for (const word of ['교집합', 'requiredScope', '403', '/api-keys', '한 번만', 'GET /me']) {
    assert.ok(text.includes(word), word)
  }
  const page = read('app/develop/page.tsx')
  assert.match(page, /<KeyScopeSection onCopy=\{onCopy\} copiedId=\{copiedId\} \/>/)
})

/* ── 게이트웨이와 승인 요청 절 (P0164 I02) ───────────────────────────────── */

const gatewayText = (): string =>
  [...Object.values(GATEWAY_DOC).map((v) => (typeof v === 'string' ? v : '')), ...GATEWAY_STEPS,
    ...GATEWAY_HEADERS.map((h) => h.desc)].join('\n')
const unComment = (sample: string): Record<string, unknown> => JSON.parse(sample.replace(/^\/\/.*\n/, '')) as Record<string, unknown>

test('게이트웨이 절의 값은 dispatch-core 의 상수와 같고 화면 글에 그 값이 실린다', () => {
  assert.equal(GATEWAY_PREFIX, PUBLIC_PREFIX)
  assert.equal(GATEWAY_WRITE_LIMIT, WRITE_LIMIT_PER_MINUTE)
  assert.equal(GATEWAY_IDEMPOTENCY_KEY_MAX, IDEMPOTENCY_KEY_MAX)
  assert.deepEqual([...GATEWAY_HUMAN_ONLY], [...HUMAN_ONLY_ACTIONS])
  const text = gatewayText()
  assert.ok(text.includes(`${PUBLIC_PREFIX}/actions/`), '서버 액션 경로')
  assert.ok(text.includes(`분당 ${WRITE_LIMIT_PER_MINUTE}회`), '쓰기 한도')
  assert.ok(text.includes(`${IDEMPOTENCY_KEY_MAX}자`), '키 길이')
  for (const name of HUMAN_ONLY_ACTIONS) assert.ok(text.includes(name), name)
  // 받은 요청 id 를 자르는 길이는 상수가 없어 dispatch.ts 의 글자를 읽는다
  const dispatch = read('lib/actions/dispatch.ts')
  assert.equal(Number(/get\('x-request-id'\)\?\.slice\(0, (\d+)\)/.exec(dispatch)?.[1]), GATEWAY_REQUEST_ID_MAX)
})

test('승인 만료와 멱등 보관 시간은 마이그레이션 318 의 값과 같다', () => {
  const sql = read('../../supabase/migrations/318_api_key_scopes.sql')
  const expiry = /expires_at\s+timestamptz not null default now\(\) \+ interval '(\d+) hours'/.exec(sql)
  assert.ok(expiry, '승인 요청 만료 기본값')
  assert.equal(Number(expiry[1]), APPROVAL_EXPIRY_HOURS)
  const retention = /delete from public\.api_idempotency i where i\.created_at < now\(\) - interval '(\d+) hours'/.exec(sql)
  assert.ok(retention, '멱등 기록 정리')
  assert.equal(Number(retention[1]), IDEMPOTENCY_RETENTION_HOURS)
  const text = gatewayText()
  assert.ok(text.includes(`${APPROVAL_EXPIRY_HOURS}시간이 지나면 만료`))
  assert.ok(text.includes(`${IDEMPOTENCY_RETENTION_HOURS}시간 동안 기억`))
})

test('경로 예시는 정의 표의 실제 줄이고 경로 규칙을 따른다', () => {
  for (const e of GATEWAY_EXAMPLES) {
    const row = MOUNTED.find((o) => o.name === e.name)
    assert.ok(row, `${e.name} 가 table.ts 에 없다`)
    assert.deepEqual([e.method, e.mount, e.internal, e.scope, e.cli], [row.method, row.mount, row.internal, row.scope, row.cli], e.name)
    if (e.kind === 'route') assert.equal(e.mount, e.internal.replace(/^\/api/, ''))
    if (e.kind === 'web') assert.equal(e.mount, `/web${e.internal.replace(/^\/api/, '')}`)
    if (e.kind === 'action') assert.equal(e.mount, `/actions/${e.name.replace(/\./g, '/')}`)
    if (e.kind === 'approval') assert.ok(APPROVAL_SCOPES.includes(e.scope), e.name)
  }
  assert.deepEqual([...new Set(GATEWAY_EXAMPLES.map((e) => e.kind))].sort(), ['action', 'approval', 'route', 'web'])
})

test('202 와 human_only 와 dryRun 예시는 게이트웨이가 보내는 칸과 같다', () => {
  const dispatch = read('lib/actions/dispatch.ts')
  const approval = /success: true, status: 'PENDING',([\s\S]*?)\}, 202,/.exec(dispatch)?.[0] ?? ''
  assert.ok(approval, '202 응답')
  for (const k of Object.keys(unComment(APPROVAL_202_SAMPLE))) assert.ok(new RegExp(`\\b${k}\\b`).test(approval), k)
  assert.ok(dispatch.includes(`{ success: false, error: '${HUMAN_ONLY_MESSAGE}', code: 'human_only' }, 403`))
  assert.deepEqual(Object.keys(unComment(HUMAN_ONLY_SAMPLE)), ['success', 'error', 'code'])
  const dry = /\{ success: true, dryRun: true, ([^}]*)\}, 200/.exec(dispatch)?.[1] ?? ''
  const dryKeys = ['success', 'dryRun', ...dry.split(',').map((x) => x.trim().split(':')[0].trim()).filter(Boolean)]
  assert.deepEqual(Object.keys(unComment(DRY_RUN_SAMPLE)), dryKeys)
  assert.deepEqual(APPROVAL_STATUS_ROWS.map((r) => r.status), Object.keys(API_APPROVAL_STATUS))
  for (const r of APPROVAL_STATUS_ROWS) assert.ok(r.desc.length > 0, r.status)
})

test('게이트웨이 절이 말하는 헤더와 상태 코드는 게이트웨이 코드에 있다', () => {
  const src = ['lib/actions/dispatch.ts', 'lib/actions/dispatch-core.ts', 'lib/public-api/api-audit.ts'].map(read).join('\n').toLowerCase()
  for (const h of GATEWAY_HEADERS) assert.ok(src.includes(`'${h.name.toLowerCase()}'`), h.name)
  const dispatch = read('lib/actions/dispatch.ts')
  for (const code of ['idempotency_key_reused\' }, 409', 'invalid_idempotency_key\' }, 400', "'Idempotent-Replay': 'true'", "'Retry-After': '60'", "from('api_write_audit')"]) {
    assert.ok(dispatch.includes(code), code)
  }
  assert.ok(read('lib/actions/dispatch-core.ts').includes("searchParams.get('dryRun')"))
  const text = gatewayText()
  for (const word of ['202', 'approvalId', '/approvals/{id}', 'human_only', '409', '400', 'Idempotency-Key', 'dryRun', 'x-dry-run',
    'api_write_audit', '/crm/audit', '/api-keys']) {
    assert.ok(text.includes(word), word)
  }
  const page = read('app/develop/page.tsx')
  assert.match(page, /<GatewaySection onCopy=\{copy\} copiedId=\{copiedId\} \/>/)
})

/* ── CLI 절의 설치와 설정과 종료 코드 (P0164 I03) ─────────────────────────── */

const CLI = '../../packages/teamda-cli'
const cliText = (): string =>
  [...Object.values(CLI_DOC).map((v) => (typeof v === 'string' ? v : '')), ...CLI_COMMAND_ROWS.flatMap((r) => [r.cmd, r.desc])].join('\n')
const CLI_SAMPLES = (): string[] =>
  [CLI_BUILD_SAMPLE, cliConfigSample('https://example.test'), CLI_LOGIN_SAMPLE, CLI_USE_SAMPLE, ...CLI_COMMAND_ROWS.map((r) => r.cmd)]

test('종료 코드 표는 teamda-cli 의 EXIT 와 이름과 숫자가 같다, 양쪽 모두', () => {
  assert.deepEqual(CLI_EXIT_ROWS.map((r) => [r.name, r.code]), Object.entries(EXIT))
  for (const [name, code] of Object.entries(EXIT)) {
    assert.equal(CLI_EXIT_ROWS.find((r) => r.name === name)?.code, code, name)
  }
  assert.equal(new Set(CLI_EXIT_ROWS.map((r) => r.code)).size, CLI_EXIT_ROWS.length)
  // 뜻 칸이 말하는 HTTP 상태는 exitForStatus 가 실제로 그 코드로 바꾸는 상태다
  for (const r of CLI_EXIT_ROWS) {
    assert.ok(r.desc.length > 0, r.name)
    const statuses = [...r.desc.matchAll(/\b([1-5])(\d\d|xx)\b/g)].map((m) => Number(`${m[1]}${m[2] === 'xx' ? '00' : m[2]}`))
    for (const st of statuses) {
      assert.equal(exitForStatus(st), r.code, `${r.name} 의 ${st}`)
    }
  }
})

test('키는 --key-file 로만 넘기고 거절하는 인자와 문구는 args.ts 와 같다', () => {
  assert.deepEqual([...CLI_SECRET_FLAGS], [...SECRET_FLAGS])
  for (const sample of CLI_SAMPLES()) {
    for (const flag of SECRET_FLAGS) {
      assert.ok(!new RegExp(`(^|\\s)--${flag}(=|\\s|$)`, 'm').test(sample), `예시가 --${flag} 로 키를 넘긴다: ${sample}`)
    }
  }
  assert.ok(CLI_LOGIN_SAMPLE.includes('auth login --key-file '), '파일로 넘기는 예시')
  assert.ok(CLI_LOGIN_SAMPLE.includes('--key-file -'), '표준 입력으로 넘기는 예시')
  assert.ok(!/(sk|tk|key)_[A-Za-z0-9]{16,}/.test(CLI_SAMPLES().join('\n')), '예시에 키처럼 생긴 값이 없다')
  const args = read(`${CLI}/src/args.ts`)
  const body = JSON.parse(CLI_SECRET_REFUSED_SAMPLE.replace(/^\/\/.*\n/, '')) as { error: { code: string; message: string } }
  assert.ok(args.includes(`usage('${body.error.code}', `), '거절 코드')
  const tmpl = /usage\('secret_on_argv', `([^`]+)`\)/.exec(args)?.[1] ?? ''
  assert.equal(body.error.message, tmpl.replace('${name}', 'token'))
  assert.equal(EXIT.USAGE, 2)
  assert.ok(CLI_DOC.loginRefused.includes(`종료 코드 ${EXIT.USAGE}(secret_on_argv)`))
})

test('빌드 명령과 Windows 대상과 다시 시도 횟수는 teamda-cli 의 값과 같다', () => {
  const pkg = JSON.parse(read(`${CLI}/package.json`)) as { scripts: Record<string, string>; engines: { bun: string } }
  assert.ok(pkg.scripts.build.includes('--compile') && !pkg.scripts.build.includes('--target'), 'build 는 빌드하는 기계용')
  assert.equal(/--target=(\S+)/.exec(pkg.scripts['build:win'])?.[1], CLI_WINDOWS_TARGET, 'build:win 대상')
  assert.equal(pkg.engines.bun, `>=${CLI_BUN_MIN}`)
  for (const s of ['build', 'build:win']) assert.ok(CLI_BUILD_SAMPLE.includes(`pnpm ${s} `), s)
  const http = read(`${CLI}/src/http.ts`)
  assert.equal(Number(/export const RATE_LIMIT_RETRIES = (\d+)/.exec(http)?.[1]), CLI_RATE_LIMIT_RETRIES)
  assert.equal(Number(/export const SERVER_RETRIES = (\d+)/.exec(http)?.[1]), CLI_SERVER_RETRIES)
  const text = cliText()
  for (const word of [CLI_WINDOWS_TARGET, 'AVX', 'ARM', `${CLI_RATE_LIMIT_RETRIES}번까지`, `${CLI_SERVER_RETRIES}번 다시`]) assert.ok(text.includes(word), word)
})

test('명령 예시는 run.ts 의 내장 명령이거나 OpenAPI 의 실제 명령이다', () => {
  const run = read(`${CLI}/src/run.ts`)
  const builtins = [...run.matchAll(/first === '([a-z]+)'/g)].map((m) => m[1])
  for (const b of ['help', 'sync', 'auth', 'config', 'api']) assert.ok(builtins.includes(b), b)
  const admin = read(`${CLI}/src/commands/admin.ts`)
  assert.ok(admin.includes("name !== 'base-url'"), 'config set base-url')
  for (const sub of ['login', 'status', 'logout']) assert.ok(admin.includes(`'auth ${sub}'`), sub)
  const spec = JSON.parse(read('lib/actions/generated/openapi.json')) as { paths: Record<string, Record<string, { 'x-cli'?: string }>> }
  const cliNames = new Set(Object.values(spec.paths).flatMap((item) => Object.values(item).map((op) => op['x-cli']).filter(Boolean)))
  for (const line of CLI_USE_SAMPLE.split('\n')) {
    const words = line.replace(/^teamda /, '').split(' ').filter((w) => !w.startsWith('-'))
    if (builtins.includes(words[0])) continue
    const hit = [3, 2].map((n) => words.slice(0, n).join(' ')).find((w) => cliNames.has(w))
    assert.ok(hit, `OpenAPI 에 없는 명령: ${line}`)
  }
})

test('base-url 예시는 화면의 origin 을 쓰고 출력 약속은 run.ts 와 exit.ts 와 같다', () => {
  assert.equal(cliConfigSample('https://a.example').split('\n')[0], 'teamda config set base-url https://a.example')
  const run = read(`${CLI}/src/run.ts`)
  assert.ok(run.includes('ctx.err(`${redact(JSON.stringify({ error: body }), key)}\\n`)'), '실패는 표준 오류에 봉투')
  assert.ok(run.includes('ctx.out(`${redact(JSON.stringify(value ?? null), key)}\\n`)'), '성공은 표준 출력에 JSON 하나')
  const exitSrc = read(`${CLI}/src/exit.ts`)
  const errorBody = /export interface ErrorBody \{([\s\S]*?)\n\}/.exec(exitSrc)?.[1] ?? ''
  const fields = [...errorBody.matchAll(/^\s*([a-zA-Z]+)\??:/gm)].map((m) => m[1])
  const env = JSON.parse(CLI_ERROR_SAMPLE.replace(/^\/\/.*\n/, '')) as { error: Record<string, unknown> }
  for (const k of Object.keys(env.error)) assert.ok(fields.includes(k), k)
  assert.equal(exitForStatus(Number(env.error.status)), Number(/종료 코드 (\d+)/.exec(CLI_ERROR_SAMPLE)?.[1]))
  assert.ok(read(`${CLI}/src/file-out.ts`).includes('out_required'))
  const text = cliText()
  for (const word of ['표준 출력', '표준 오류', 'JSON 값 하나', 'out_required', 'TEAMDA_BASE_URL', 'TEAMDA_API_KEY', 'teamda help', 'teamda sync', 'teamda api']) {
    assert.ok(text.includes(word), word)
  }
  const page = read('app/develop/page.tsx')
  assert.match(page, /<CliGuideSection origin=\{origin\} onCopy=\{copy\} copiedId=\{copiedId\} \/>/)
  assert.match(page, /activeSection === 'cli' && <CliSection \/>/, '명령 검색 목록은 그대로')
})

/* ── 오류 코드 절의 게이트웨이 응답과 CRM 오류 (P0164 I05) ─────────────────── */

test('CRM 오류 표는 CRM_ERROR_CODES 와 CRM_ERROR_HTTP 에서 오고 뜻은 코드마다 하나씩, 양쪽 모두', () => {
  assert.deepEqual(CRM_ERROR_ROWS.map((r) => r.code), [...CRM_ERROR_CODES])
  for (const r of CRM_ERROR_ROWS) assert.equal(r.status, CRM_ERROR_HTTP[r.code], r.code)
  assert.deepEqual(Object.keys(CRM_ERROR_MEANING).sort(), [...CRM_ERROR_CODES].sort(), '뜻 표의 키')
  assert.deepEqual(Object.keys(CRM_ERROR_HTTP).sort(), [...CRM_ERROR_CODES].sort(), '상태 표의 키')
  for (const r of CRM_ERROR_ROWS) assert.ok(r.meaning.length > 0, r.code)
  assert.equal(CRM_ERROR_ROWS.find((r) => r.code === 'INTERNAL')?.status, 500)
  // 화면은 줄을 손으로 적지 않고 CRM_ERROR_ROWS 를 돈다
  assert.ok(read('app/develop/ErrorCodeTable.tsx').includes('CRM_ERROR_ROWS.map('))
})

test('CRM 실패 몸통 예시는 CrmError.toResponseBody 의 모양과 기본 문장 그대로다', () => {
  const src = read('lib/crm/domain/errors.ts')
  assert.ok(src.includes('return { error: { code: this.code, message: this.message, details: this.details } }'))
  const body = JSON.parse(CRM_ERROR_SAMPLE.replace(/^\/\/.*\n/, '')) as { error: { code: string; message: string } }
  assert.deepEqual(Object.keys(body.error), ['code', 'message', 'details'])
  const code = body.error.code as keyof typeof CRM_ERROR_HTTP
  assert.ok(src.includes(`${code}: '${body.error.message}'`), '기본 문장')
  assert.equal(Number(/HTTP (\d+)/.exec(CRM_ERROR_SAMPLE)?.[1]), CRM_ERROR_HTTP[code])
})

test('게이트웨이 응답 줄은 202 와 403 셋과 409 와 400 이고 몸통은 게이트웨이와 인증 코드가 보내는 것이다', () => {
  assert.deepEqual(GATEWAY_ERROR_ROWS.map((r) => r.status), [202, 403, 403, 403, 409, 400])
  for (const r of GATEWAY_ERROR_ROWS) {
    assert.equal(Number(/^\/\/ HTTP (\d+)/.exec(r.sample)?.[1]), r.status, r.id)
    const mark = r.mark.replace(/^code: /, '')
    if (r.id !== 'expired') assert.ok(r.sample.includes(`"${mark}"`), r.id)
  }
  // 앞 넷은 인증 절과 게이트웨이 절의 예시를 그대로 쓴다
  assert.equal(GATEWAY_ERROR_ROWS[0].sample, APPROVAL_202_SAMPLE)
  assert.equal(GATEWAY_ERROR_ROWS[1].sample, AUTH_SCOPE_403_SAMPLE)
  assert.equal(GATEWAY_ERROR_ROWS[2].sample, HUMAN_ONLY_SAMPLE)
  assert.ok(GATEWAY_ERROR_ROWS[3].sample.includes(AUTH_EXPIRED_MESSAGE))
  assert.ok(!GATEWAY_ERROR_ROWS[3].sample.includes('requiredScope'), '만료 키는 범위를 알려 주지 않는다')
  const dispatch = read('lib/actions/dispatch.ts')
  assert.ok(dispatch.includes(`{ success: false, error: '${IDEM_REUSED_ERROR}' }, 409`))
  assert.ok(dispatch.includes(`{ success: false, error: '${IDEM_INVALID_ERROR}' }, 400`))
  assert.ok(dispatch.includes('idemKey.length > IDEMPOTENCY_KEY_MAX'))
  assert.deepEqual(Object.keys(unComment(IDEM_REUSED_SAMPLE)), ['success', 'error'])
  assert.deepEqual(Object.keys(unComment(IDEM_INVALID_SAMPLE)), ['success', 'error'])
})

test('오류 코드 절은 화면에 걸리고 설명에 내부 구조를 싣지 않는다', () => {
  const page = read('app/develop/page.tsx')
  assert.match(page, /<ErrorCodeTable onCopy=\{onCopy\} copiedId=\{copiedId\} \/>/)
  assert.ok(!/const ERRORS\b/.test(page), '공통 표는 errors-doc.ts 로 옮겼다')
  const texts = [
    ...Object.values(ERRORS_DOC).flatMap((v) => (typeof v === 'string' ? [v] : Object.values(v))),
    ...GATEWAY_ERROR_ROWS.flatMap((r) => [r.when, r.fix]),
    ...CRM_ERROR_ROWS.map((r) => r.meaning),
    ...HTTP_ERROR_ROWS.flatMap((r) => [r.cause, r.fix]),
  ]
  for (const t of texts) {
    assert.ok(!/\.tsx?\b|lib\/|node_modules|stack|at [A-Za-z]+ \(/.test(t), t)
    assert.ok(!t.includes('\u2014'), t)
  }
})

/* ── 시작하기 절의 빠른 시작과 응답 문장 (P0168) ─────────────────────────────── */

test('빠른 시작의 첫 요청은 GET /me 이고 둘째는 계정 권한으로 고른 목록이다', async () => {
  const { STABLE_ENDPOINTS, REQUIRES_LABEL } = await import('./registry.ts')
  const page = read('app/develop/page.tsx')
  const start = page.slice(page.indexOf('function StartSection'), page.indexOf('/* ── 오류'))
  const tabs = [...start.matchAll(/<CodeTabs id="([^"]+)"[^>]*spec=\{requestSpecOf\((\w+(?:\[0\])?)\)\}/g)]
  assert.deepEqual(tabs.map((m) => m[1]), ['quickstart-me', 'quickstart-list'], '시작하기 절의 코드 예시는 둘이고 순서는 /me, 목록')
  assert.equal(tabs[0][2], 'QUICK_ME')
  assert.equal(tabs[1][2], 'QUICK_LISTS[0]')
  // 상수가 가리키는 줄을 같은 식으로 다시 뽑아 본다
  assert.match(page, /const QUICK_ME = STABLE_ENDPOINTS\.find\(\(e\) => e\.id === 'ref\.me'\)!/)
  const me = STABLE_ENDPOINTS.find((e) => e.id === 'ref.me')!
  assert.equal(me.path, '/me')
  assert.equal(me.requires, undefined, '/me 는 권한 없이 부를 수 있어야 첫 요청이 된다')
  const order = /const QUICK_LIST_REQUIRES = \[([^\]]+)\] as const/.exec(page)?.[1] ?? ''
  const requires = [...order.matchAll(/'([a-z-]+)'/g)].map((m) => m[1])
  assert.deepEqual(requires, ['crm-member', 'ci-member', 'member'])
  const lists = requires.map((r) =>
    STABLE_ENDPOINTS.find((e) => e.method === 'GET' && e.requires === r && !e.path.includes('{')))
  for (const [i, e] of lists.entries()) {
    assert.ok(e, `${requires[i]} 권한으로 읽는 목록이 registry 에 있어야 한다`)
    assert.ok(e.requires && REQUIRES_LABEL[e.requires], e.id)
  }
  // 예시 목록은 GPU(임직원 키) 목록이 아니다, CRM 만 쓰는 계정이 첫 줄부터 403 을 받던 자리
  assert.equal(lists[0]!.path, '/crm/companies')
  assert.notEqual(lists[0]!.requires, 'member')
  assert.doesNotMatch(start, /path: '\/products'/)
})

test('시작하기 절에 범위와 모순되는 「별도의 권한 체계」 문장이 없다', () => {
  const page = read('app/develop/page.tsx')
  assert.ok(!page.includes('별도의 권한 체계'))
  assert.match(page, /\{AUTH_DOC\.inheritBody\}/, '상속 안내는 범위를 말하는 인증 절 문장을 쓴다')
  assert.match(AUTH_DOC.inheritBody, /범위/)
})

test('한도 헤더 문장은 인증 코드와 같다, 키 확인에서 거절되면 헤더가 없고 그 뒤 403 에는 있다', async () => {
  const { DEVCENTER_START, DEVCENTER_DEFAULT_RATE_LIMIT } = await import('../terms/devcenter.ts')
  const auth = read('lib/publicApiAuth.ts')
  assert.equal(Number(/const DEFAULT_RATE_LIMIT = (\d+)/.exec(auth)?.[1]), DEVCENTER_DEFAULT_RATE_LIMIT)
  // 인증 함수 안의 지역 fail 은 CORS 와 넘긴 extra 만 싣는다, 한도 헤더를 스스로 붙이지 않는다
  const localFail = /function fail\([\s\S]*?\n\}/.exec(auth)?.[0] ?? ''
  assert.match(localFail, /headers: \{ \.\.\.corsHeaders\(request\), \.\.\.\(extra \?\? \{\}\) \}/)
  assert.doesNotMatch(localFail, /rateLimitHeaders/)
  // 401 과 키 확인 403 은 한도를 세기(record_api_key_hit) 전에 extra 없이 돌아간다
  const body = auth.slice(auth.indexOf('export async function authenticatePublicApi'))
  const hitAt = body.indexOf("rpc('record_api_key_hit'")
  assert.ok(hitAt > 0)
  const beforeHit = body.slice(0, hitAt)
  const early = [...beforeHit.matchAll(/return fail\((\d{3}), '[^']*', request(, [^)]*)?\)/g)]
  assert.deepEqual([...new Set(early.map((m) => m[1]))].sort(), ['401', '403'])
  for (const m of early) assert.equal(m[2], undefined, `키 확인 ${m[1]} 에 extra 헤더가 붙었다`)
  // 범위 403 도 corsHeaders 만 싣는다
  assert.match(beforeHit, /requiredScope: required \},\s*\{ status: 403, headers: corsHeaders\(request\) \}/)
  // 키 확인 뒤의 권한 403 (requireMemberKey) 은 한도 헤더를 싣는다
  const member = /export function requireMemberKey[\s\S]*?\n\}/.exec(auth)?.[0] ?? ''
  assert.match(member, /status: 403, headers: \{ \.\.\.corsHeaders\(request\), \.\.\.rateLimitHeaders\(ctx\) \}/)
  const t = DEVCENTER_START.rateNoHeaderBody
  assert.match(t, /401/)
  assert.match(t, /403/)
  assert.match(t, /한도 헤더가 없고/)
  assert.match(t, /한도 헤더가 실립니다/)
  // 예전 문장 「모든 응답에 남은 횟수」는 401 403 에서 틀렸다
  assert.ok(!read('app/develop/page.tsx').includes('모든 응답에 남은 횟수'))
})

test('최상위 nextCursor total 문장은 okList 의 동작과 같고 GPU 목록은 meta 에만 싣는다', async () => {
  const { DEVCENTER_START } = await import('../terms/devcenter.ts')
  const respond = read('lib/public-api/respond.ts')
  const okList = /export function okList[\s\S]*?\n\}/.exec(respond)?.[0] ?? ''
  const lifted = [...okList.matchAll(/if \(meta\.(\w+) !== undefined\) body\.(\w+) = meta\.(\w+)/g)]
  for (const m of lifted) assert.ok(m[1] === m[2] && m[2] === m[3], m[0])
  const fields = lifted.map((m) => m[1])
  assert.deepEqual(fields.slice().sort(), ['capped', 'hasMore', 'nextCursor', 'total'])
  const t = DEVCENTER_START.topLevelBody
  for (const f of fields) assert.ok(t.includes(f), `문장에 ${f} 가 없다`)
  // okList 를 지나는 곳은 CRM 다리, CI 다리, 구 CRM 셋이다, 문장이 그 셋을 말한다
  assert.match(read('lib/public-api/crm-bridge.ts'), /return okList\(/)
  assert.match(read('lib/public-api/ci-bridge.ts'), /okList\(/)
  for (const legacy of ['accounts', 'contacts', 'deals']) {
    assert.match(read(`app/api/public/v1/${legacy}/route.ts`), /okList\(/, legacy)
  }
  // GPU 목록은 봉투를 손으로 만들고 okList 를 안 지난다, 문장도 meta 에만 싣는다고 말한다
  for (const gpu of ['products', 'fx', 'suppliers', 'inventory', 'pool-stock']) {
    assert.doesNotMatch(read(`app/api/public/v1/${gpu}/route.ts`), /okList/, gpu)
  }
  assert.match(t, /GPU 가격 목록은 meta 에만/)
  assert.ok(!read('app/develop/page.tsx').includes('예전 최상위 필드는 당분간'))
})

/* ── 화면에 닿는 문구 (P0168) ─────────────────────────────────────────────── */

/** registry 가 내보내는 값 가운데 문자열을 경로와 함께 모두 모은다 (함수는 건너뜀) */
async function registryStrings(): Promise<{ path: string; key: string; value: string }[]> {
  const reg = (await import('./registry.ts')) as Record<string, unknown>
  const out: { path: string; key: string; value: string }[] = []
  const seen = new Set<unknown>()
  const walk = (v: unknown, path: string, key: string): void => {
    if (typeof v === 'string') { out.push({ path, key, value: v }); return }
    if (!v || typeof v !== 'object' || seen.has(v)) return
    seen.add(v)
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, `${path}.${k}`, k)
  }
  for (const [k, v] of Object.entries(reg)) if (typeof v !== 'function') walk(v, k, k)
  return out
}

test('registry 의 화면 문구에 「—」가 없다', async () => {
  const dashes = (await registryStrings()).filter((s) => s.value.includes('—'))
  assert.ok((await registryStrings()).length > 500, '훑은 문자열이 너무 적다, 걷기가 망가졌다')
  assert.deepEqual(dashes.map((s) => `${s.path}: ${s.value.slice(0, 60)}`), [])
})

test('registry 의 화면 문구에 구현 이름(함수, 파일 경로)이 없다, 사용자가 쓰는 API 칸 이름만 허용', async () => {
  const strings = await registryStrings()
  // 허용 목록은 손으로 적지 않는다: 요청과 응답 칸 이름, 예시 본문과 응답 예시의 키가 곧 사용자가 쓰는 말이다
  const allowed = new Set<string>()
  for (const s of strings) {
    if (s.key === 'name') allowed.add(s.value)
    if (s.key === 'sample') for (const m of s.value.matchAll(/"([A-Za-z_]\w*)"\s*:/g)) allowed.add(m[1])
  }
  const { ENDPOINTS } = await import('./registry.ts')
  const keysOf = (o: unknown): void => {
    if (!o || typeof o !== 'object') return
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) { allowed.add(k); keysOf(v) }
  }
  for (const e of ENDPOINTS) { keysOf(e.bodyExample); keysOf(e.queryExample) }
  assert.ok(allowed.has('nextCursor') && allowed.has('rateLimitPerMinute'), '허용 목록 파생이 망가졌다')

  const SKIP_KEYS = new Set(['id', 'name', 'path', 'sample', 'method', 'group', 'requires', 'scope', 'status', 'type', 'section', 'key'])
  const impl: string[] = []
  for (const s of strings) {
    if (SKIP_KEYS.has(s.key)) continue
    for (const m of s.value.matchAll(/\b[a-z]+[A-Z][A-Za-z]*\b/g)) if (!allowed.has(m[0])) impl.push(`${s.path}: ${m[0]}`)
    for (const m of s.value.matchAll(/\b[\w/.-]+\.tsx?\b/g)) impl.push(`${s.path}: ${m[0]}`)
  }
  assert.deepEqual(impl, [])
})

test('개발자센터 화면 파일에 한글 문자열을 직접 적지 않는다, 말은 lib/terms/devcenter.ts 에서 온다', () => {
  const code = read('app/develop/page.tsx')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1')
  const lines = code.split('\n').filter((l) => /[가-힣]/.test(l)).map((l) => l.trim().slice(0, 80))
  assert.deepEqual(lines, [])
})

test('복사 단추는 클립보드 쓰기가 끝난 뒤에만 「복사됨」을 띄우고 실패는 알림 줄로 말한다', async () => {
  const { DEVCENTER_COPY } = await import('../terms/devcenter.ts')
  const page = read('app/develop/page.tsx')
  assert.match(page, /await navigator\.clipboard\.writeText\(text\)/, 'writeText 의 약속을 기다려야 거절을 안다')
  const copy = page.slice(page.indexOf('const copy = useCallback'), page.indexOf('}, [])', page.indexOf('const copy = useCallback')))
  assert.ok(copy.indexOf('await writeClipboard') >= 0 && copy.indexOf('await writeClipboard') < copy.indexOf('setCopiedId('), '쓰기 전에 「복사됨」을 켜면 실패해도 복사됨이 뜬다')
  assert.match(copy, /setCopiedId\(ok \? id : null\)/)
  assert.match(page, /role="status" aria-live="polite"/)
  assert.match(page, /\{copyFailed \? DEVCENTER_COPY\.failed : ''\}/)
  assert.ok(DEVCENTER_COPY.failed.length > 0)
  assert.doesNotMatch(page, /\balert\(/, '브라우저 기본 대화상자를 쓰지 않는다')
})
