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
