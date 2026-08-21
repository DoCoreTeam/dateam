// lib/system-log/narrate.test.ts — 시스템 로그의 **사실 문장** 계약
//
// 이 층이 깨지면 관리자는 "무슨 일이 있었는지"를 영영 못 읽는다.
// 특히 마지막 두 묶음(비밀 마스킹 · 숫자 지어내기 금지)은 사고 재발 방지다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { headlineOf, detailOf, occurrenceLine, truncateRaw, maskSecrets, RAW_MAX } from './narrate.ts'
import { classifySystemReason, severityOf, normalizeMessage, fingerprintOf } from './reason.ts'
import { featureLabel, sourceLabel, reasonLabel } from './labels.ts'
import { read } from '../ui/component-scan.ts'

const at = (iso: string) => iso.slice(11, 16)

// ── 사실 문장 ────────────────────────────────────────────────

test('첫 줄은 사용자가 부르는 기능 이름으로 말한다 — 코드 이름이 아니다', () => {
  const h = headlineOf({ source: 'crm_ai', reason: 'quota', feature: 'enrich-web' })
  assert.ok(h.includes('회사 정보 AI 보강'), h)
  assert.ok(!h.includes('enrich-web'), '코드 이름이 새어 나오면 관리자는 무슨 기능인지 모른다')
})

test('기능을 모르면 어디서 났는지라도 말한다 — 빈 문장은 안 만든다', () => {
  const h = headlineOf({ source: 'cron', reason: 'timeout' })
  assert.ok(h.includes('정기 작업'), h)
})

test('둘째 줄은 사유마다 다른 말을 한다 — "오류가 발생했습니다"는 아무것도 안 알려 준다', () => {
  const reasons = ['quota', 'auth', 'config', 'db', 'timeout', 'network', 'server', 'bad_json', 'unknown'] as const
  const said = new Set<string>()
  for (const r of reasons) {
    const d = detailOf({ source: 'host_ai', reason: r })
    assert.ok(d.length > 20, `${r}: 너무 짧다`)
    assert.ok(!said.has(d), `${r}: 다른 사유와 같은 말을 한다`)
    said.add(d)
  }
})

test('둘째 줄에는 관리자가 다음에 할 일이 들어 있다', () => {
  assert.match(detailOf({ source: 'host_ai', reason: 'quota' }), /설정|모델|기다/)
  assert.match(detailOf({ source: 'crm_api', reason: 'db' }), /마이그레이션/)
  assert.match(detailOf({ source: 'host_ai', reason: 'config' }), /환경변수|설정/)
})

test('단서가 있으면 괄호로 덧붙이고, 없으면 빈 괄호를 만들지 않는다', () => {
  assert.ok(detailOf({ source: 'host_ai', reason: 'quota', hint: 'Gemini' }).includes('(Gemini)'))
  assert.ok(!detailOf({ source: 'host_ai', reason: 'quota' }).includes('()'))
  assert.ok(!detailOf({ source: 'host_ai', reason: 'quota', hint: '   ' }).includes('()'))
})

// ── 묶어서 센다 ──────────────────────────────────────────────

test('여러 번이면 "언제부터 몇 번" — 500건이 500줄이 되지 않게', () => {
  const line = occurrenceLine({
    count: 12, firstAt: '2026-08-22T21:34:00Z', lastAt: '2026-08-22T22:10:00Z',
    actorCount: 4, actorSample: '김도현', route: '/crm/companies', formatTime: at,
  })
  assert.ok(line.includes('12번'), line)
  assert.ok(line.includes('외 3명'), line)
  assert.ok(line.includes('/crm/companies'), line)
})

test('한 번이면 횟수를 말하지 않는다 — "1번"은 사람이 안 쓰는 말이다', () => {
  const line = occurrenceLine({ count: 1, firstAt: '2026-08-22T21:34:00Z', lastAt: '2026-08-22T21:34:00Z', formatTime: at })
  assert.ok(!line.includes('번'), line)
})

test('영향 인원을 모르면 그 자리를 아예 비운다 — "0명"은 틀린 사실이다', () => {
  const line = occurrenceLine({ count: 3, firstAt: '2026-08-22T21:34:00Z', lastAt: '2026-08-22T21:40:00Z', formatTime: at })
  assert.ok(!line.includes('명'), line)
  assert.ok(!line.includes('0'), `지어낸 숫자가 들어갔다: ${line}`)
})

// ── 원문은 감추지 않는다 ─────────────────────────────────────

test('긴 원문은 자르되 몇 자가 더 있는지 밝힌다 — 조용히 버리지 않는다', () => {
  const long = 'x'.repeat(RAW_MAX + 500)
  const out = truncateRaw(long)
  assert.ok(out.length < long.length)
  assert.match(out, /500자 더 있음/)
})

test('짧은 원문은 손대지 않는다', () => {
  assert.equal(truncateRaw('짧다'), '짧다')
})

// ── 비밀은 로그에 남지 않는다 ────────────────────────────────

test('URL 쿼리의 키를 지운다 — 어댑터 오류 본문에 ?key= 가 그대로 들어 있었다(실측)', () => {
  const masked = maskSecrets('Gemini API 오류: https://x.googleapis.com/v1/models?key=AIzaSyABCDEFGH12345')
  assert.ok(!masked.includes('AIzaSyABCDEFGH12345'), masked)
  assert.ok(masked.includes('key=***'), masked)
})

test('DB 접속 문자열의 비밀번호를 지운다', () => {
  const masked = maskSecrets('connect failed: postgresql://user:s3cr3tPass@host:5432/db')
  assert.ok(!masked.includes('s3cr3tPass'), masked)
  assert.ok(masked.includes('user:***@'), masked)
})

test('JSON 안의 api_key·token·password 를 지운다', () => {
  const masked = maskSecrets('{"api_key":"abcdef123456","token":"zzzzzzzzzz"}')
  assert.ok(!masked.includes('abcdef123456'), masked)
  assert.ok(!masked.includes('zzzzzzzzzz'), masked)
})

test('비밀이 없는 문장은 그대로 둔다 — 과잉 마스킹은 원문을 못 읽게 만든다', () => {
  const s = '회사 372곳 중 1곳만 산업이 적혀 있습니다'
  assert.equal(maskSecrets(s), s)
})

// ── 사유 판정 ────────────────────────────────────────────────

test('Gemini SSOT 의 사유를 그대로 옮긴다 — 뜻이 같은 것을 다른 말로 부르지 않는다', () => {
  assert.equal(classifySystemReason({ geminiReason: 'quota' }), 'quota')
  assert.equal(classifySystemReason({ geminiReason: 'no_model' }), 'config')
  assert.equal(classifySystemReason({ geminiReason: 'truncated' }), 'bad_json')
})

test('Prisma 코드가 문자열 패턴보다 먼저다 — 429 를 담은 DB 오류를 한도로 오판하지 않게', () => {
  assert.equal(classifySystemReason({ prismaCode: 'P2021', message: 'something 429 here' }), 'db')
})

test('표가 없다는 오류는 db 로 접는다 — 마이그레이션이 안 갔다는 뜻이다', () => {
  assert.equal(classifySystemReason({ message: "relation 'public.crm_company' does not exist" }), 'db')
})

test('한도·키·설정 누락을 문장에서 알아본다', () => {
  assert.equal(classifySystemReason({ message: 'You exceeded your current quota (429)' }), 'quota')
  assert.equal(classifySystemReason({ message: 'Invalid API key provided' }), 'auth')
  assert.equal(classifySystemReason({ message: 'DATABASE_URL is not defined' }), 'config')
})

test('모르면 모른다고 한다 — 아무 사유나 붙이지 않는다', () => {
  assert.equal(classifySystemReason({ message: '무슨 말인지 모를 문장' }), 'unknown')
  assert.equal(reasonLabel('unknown'), '원인 미상')
})

test('고칠 때까지 계속 안 되는 것은 critical — 기다린다고 나아지지 않는다', () => {
  for (const r of ['config', 'db', 'auth'] as const) assert.equal(severityOf(r), 'critical', r)
  // 한도는 지나가기도 하므로 기본은 warn.
  // 다만 **지금 사용자가 막혀 있다면** 지나갈 일이 아니라 지금 알아야 할 일이다 —
  // 이 화면이 필요해진 이유가 정확히 "AI 한도가 없으면 그런 걸 체크"였다.
  assert.equal(severityOf('quota'), 'warn')
  assert.equal(severityOf('quota', { blocksUser: true }), 'error')
  assert.equal(severityOf('unknown', { blocksUser: true }), 'error')
})

// ── 지문 ─────────────────────────────────────────────────────

test('id·숫자·따옴표 값이 달라도 같은 지문이다 — 안 묶으면 500줄이 된다', () => {
  const a = fingerprintOf('crm_api', 'db', "relation 'crm_company' does not exist (id: 550e8400-e29b-41d4-a716-446655440000, 12 rows)")
  const b = fingerprintOf('crm_api', 'db', "relation 'crm_deal' does not exist (id: 660e8400-e29b-41d4-a716-446655440111, 87 rows)")
  assert.equal(a, b, `묶이지 않았다:\n${a}\n${b}`)
})

test('cuid 도 정규화한다 — Prisma 기본 id 라 오류 문장에 자주 섞인다', () => {
  assert.equal(
    normalizeMessage('company cmt37g46o001dz910btawl40r not found'),
    normalizeMessage('company cmt385lu0001xz910yeoh95tr not found'),
  )
})

test('사유가 다르면 다른 지문이다 — 원인이 다른 것을 한 줄로 접으면 안 된다', () => {
  assert.notEqual(fingerprintOf('host_ai', 'quota', 'x'), fingerprintOf('host_ai', 'auth', 'x'))
})

test('지문은 사람이 읽을 수 있다 — 해시면 DB 에서 눈으로 대조할 수 없다', () => {
  const fp = fingerprintOf('host_ai', 'quota', 'You exceeded your current quota')
  assert.ok(fp.startsWith('host_ai|quota|'), fp)
})

// ── 라벨 ─────────────────────────────────────────────────────

test('모르는 기능 키는 코드 이름을 그대로 보여 준다 — 지어내지 않는다', () => {
  assert.equal(featureLabel('some-new-thing'), 'some-new-thing')
  assert.equal(featureLabel(''), '알 수 없는 기능')
  assert.equal(sourceLabel('crm_api'), 'CRM 화면')
})

// ── 침묵 금지 (v0.7.584 실측 사고) ───────────────────────────
//
// 시스템 로그는 **침묵을 없애려고** 만든 것이다. 그런데 그 자신이 조용히 실패했다:
// `workspace_id` 칼럼이 uuid 인데 CRM 워크스페이스 id 는 `ws_dataalliance` 라
// 모든 insert 가 거절당했다. supabase-js 는 오류를 **던지지 않고 반환**하는데
// 코드가 그 값을 안 봐서, 화면에는 0건이 쌓였고 아무도 몰랐다.

test('insert 의 반환 오류를 반드시 본다 — supabase-js 는 실패를 던지지 않는다', () => {
  const src = read('lib/system-log/record.ts')
  assert.match(src, /if \(raced\?\.error\) throw new Error/,
    '반환된 { error } 를 안 보면 저장 실패가 조용히 지나간다')
  assert.match(src, /console\.error\('\[system-log\] 기록 실패/,
    '실패는 console.error 로 남긴다 — warn 은 로그에서 묻힌다')
})

test('기록은 기다린다 — fire-and-forget 은 응답과 함께 사라진다', () => {
  const src = read('lib/system-log/record.ts')
  // 실측: `void recordSystemEvent(...)` 였을 때 AI 한도 실패가 한 건도 안 남았다
  assert.ok(!/^\s*void recordSystemEvent\(/m.test(src), 'fire-and-forget 으로 되돌아갔다')
  assert.match(src, /export async function recordSystemEventAsync/)
  assert.match(src, /await recordSystemEvent\(input\)/)
})

test('길목 넷은 전부 await 한다 — 하나라도 빠지면 그 경로만 조용해진다', () => {
  const funnels = [
    'lib/crm/api/handler.ts',
    'lib/crm/ai/runner.ts',
    'lib/ai/gemini-call.ts',
    'lib/ci/jobs/queue.ts',
  ]
  for (const f of funnels) {
    const src = read(f)
    assert.match(src, /await recordSystemEventAsync\(/, `${f}: 기다리지 않는다`)
    assert.ok(!/(?<!await )\brecordSystemEventAsync\(\{/.test(src), `${f}: await 없는 호출이 남아 있다`)
  }
})

test('워크스페이스 id 는 text 다 — UUID 가 아니다(ws_dataalliance)', () => {
  const sql = read('../../supabase/migrations/219_system_events_workspace_text.sql')
  assert.match(sql, /ALTER COLUMN workspace_id TYPE text/)
})
