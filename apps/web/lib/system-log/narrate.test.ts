// lib/system-log/narrate.test.ts — 시스템 로그의 **사실 문장** 계약
//
// 이 층이 깨지면 관리자는 "무슨 일이 있었는지"를 영영 못 읽는다.
// 특히 마지막 두 묶음(비밀 마스킹 · 숫자 지어내기 금지)은 사고 재발 방지다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { headlineOf, detailOf, occurrenceLine, truncateRaw, maskSecrets, humanSentenceOf, RAW_MAX } from './narrate.ts'
import { classifySystemReason, severityOf, normalizeMessage, fingerprintOf } from './reason.ts'
import { featureLabel, sourceLabel, reasonLabel } from './labels.ts'
import { read, stripComments } from '../ui/component-scan.ts'
import { readdirSync, readFileSync } from 'node:fs'

const at = (iso: string) => iso.slice(11, 16)

// ── 사실 문장 ────────────────────────────────────────────────

/**
 * `recordSystemEvent…(…)` 의 **인자만** 잘라 낸다 — 괄호 균형으로 센다.
 *
 * 파일 어딘가에 `webSearch` 가 있는지로 보면 안 된다. 실제로 그렇게 짰다가
 * 어댑터를 만드는 줄(`hostAdapter(…, { webSearch: true })`)에 걸려, 기록에서 값을
 * 빼도 가드가 초록이었다. **값이 어디로 가는지**를 봐야 가드다.
 */
function recordCallArgs(src: string): string[] {
  const out: string[] = []
  const re = /recordSystemEvent(?:Async)?\s*\(/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    let depth = 1
    let i = m.index + m[0].length
    const start = i
    while (i < src.length && depth > 0) {
      if (src[i] === '(') depth += 1
      else if (src[i] === ')') depth -= 1
      i += 1
    }
    out.push(src.slice(start, i - 1))
  }
  return out
}

/**
 * 시스템 로그를 남기는 파일들. **손목록이 아니라 훑어서 얻는다** —
 * 손으로 적으면 새 파일이 생길 때 그 자리가 조용히 빠진다.
 */
function recorderFiles(): string[] {
  const roots = ['lib', 'app']
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue
      const full = `${dir}/${e.name}`
      if (e.isDirectory()) { walk(full); continue }
      if (!/\.tsx?$/.test(e.name) || /\.test\.tsx?$/.test(e.name)) continue
      if (full.includes('lib/system-log/')) continue
      if (/recordSystemEvent/.test(readFileSync(full, 'utf8'))) out.push(full)
    }
  }
  for (const r of roots) walk(r)
  return out
}

test('첫 줄은 사용자가 부르는 기능 이름으로 말한다 — 코드 이름이 아니다', () => {
  const h = headlineOf({ source: 'crm_ai', reason: 'quota', feature: 'enrich-web' })
  assert.ok(h.includes('회사 정보 AI 보강'), h)
  assert.ok(!h.includes('enrich-web'), '코드 이름이 새어 나오면 관리자는 무슨 기능인지 모른다')
})

test('★ 영문 약어로 끝나는 이름에도 조사를 제대로 붙인다 — 병기가 새면 기계가 쓴 티가 난다', () => {
  // 실측 사고(2026-08-24 /admin/system-log): 화면이 21건 내내
  // **"CRM 화면·API이(가) 실패했습니다"**를 그대로 띄웠다. 이 파일 위 주석이 막으려던 그 모양이다.
  // 원인은 조사 SSOT(lib/ui/josa.ts)가 대문자 약어를 '읽는 법 모름'으로 두고 병기한 것이었다.
  const h = headlineOf({ source: 'crm_api', reason: 'db', feature: 'crm-api' })
  assert.equal(h, 'CRM 화면·API가 실패했습니다', h)
  assert.ok(!h.includes('(가)'), '두 형태 병기가 사용자 화면에 남으면 안 된다')
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
  // 단정을 `!line.includes('0')` 으로 두면 **시각의 0**('21:40')까지 잡는다.
  // 그때 실패는 결함이 아니라 단정이 틀린 것이다 — 잡으려던 것만 정확히 잡는다.
  assert.ok(!/\d+\s*명/.test(line), `지어낸 인원이 들어갔다: ${line}`)
  assert.ok(!line.includes('명'), line)
})

test('★ 여러 번 난 사건은 마지막 발생을 먼저 말한다 — "아직도 나고 있나"가 첫 질문이다', () => {
  // 예전엔 '처음 시각부터 N번'만 적어서, 3시간 전에 끝난 일과 방금까지 나던 일이 똑같이 생겼다
  // (사용자 지적 2026-08-24: "시간이 완전 핵심인데 시간이 정확한 시간으로 안 나오네").
  const line = occurrenceLine({
    count: 13,
    firstAt: '2026-08-24T05:15:03Z',
    lastAt: '2026-08-24T06:57:52Z',
    formatTime: (iso) => iso.replace('T', ' ').replace('Z', ''),
    formatTimeOnly: (iso) => iso.slice(11, 19),
    formatAgo: () => '3시간 전',
  })
  assert.ok(line.startsWith('마지막 '), line)
  assert.ok(line.includes('06:57:52'), `마지막 발생 시각이 빠졌다: ${line}`)
  assert.ok(line.includes('(3시간 전)'), `경과가 빠졌다: ${line}`)
  assert.ok(line.includes('처음 05:15:03'), `처음 시각은 같은 날이면 시각만 적는다: ${line}`)
  assert.ok(line.endsWith('13번'), line)
})

test('처음과 마지막이 다른 날이면 처음에도 날짜를 적는다', () => {
  const line = occurrenceLine({
    count: 4,
    firstAt: '2026-08-23T05:15:03Z',
    lastAt: '2026-08-24T06:57:52Z',
    formatTime: (iso) => iso.replace('T', ' ').replace('Z', ''),
    formatTimeOnly: (iso) => iso.slice(11, 19),
  })
  assert.ok(line.includes('처음 2026-08-23'), `날짜가 다르면 생략하면 안 된다: ${line}`)
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

// ── 우리말로 쓴 문장도 사유로 읽는다 (2026-09-20 실측) ────────────
//
// 분류기의 패턴 여덟 줄이 전부 영어였다. 우리가 던지는 문장은 우리말이라
// 하나도 안 걸렸고, `ci_job` 사건 267건이 전부 「원인 미상」으로 쌓였다.
// 그중 246건은 원문 첫 줄에 「한도를 다 썼습니다」라고 적혀 있었다.
//
// 아래 문장은 지어낸 것이 아니라 **운영 DB 의 system_events.raw 첫 줄 그대로**다.

test('★ 우리말 한도 문장을 한도로 읽는다 — 원문에 적혀 있는데 「원인 미상」이었다', () => {
  const real = [
    'AI 웹 검색 한도를 다 썼습니다. 이건 모델을 바꿔도 풀리지 않습니다 — 한도가 초기화될 때까지 기다리거나 요금제를 올려야 합니다.',
    '등록된 AI 공급자가 전부 사용량 한도에 걸렸습니다. 한도가 풀릴 때까지 기다리거나 시스템 설정 → 통합에서 다른 공급자 키를 추가해 주세요.',
    '호출 한도를 넘었습니다. 잠시 뒤 다시 시도해 주세요',
    '할당량 초과',
    '쿼터 초과',
  ]
  for (const message of real) {
    assert.equal(classifySystemReason({ message }), 'quota', message)
  }
})

test('★ 한도를 뜻하지 않는 「초과」는 한도가 아니다 — 장사 이야기가 시스템 한도로 둔갑한다', () => {
  // 실측 원문. 사람이 넣은 값이 규칙을 넘은 것이지 우리 한도가 찬 것이 아니다.
  // 맨 「초과」로 잡으면 관리자는 있지도 않은 한도를 풀러 간다.
  const r = classifySystemReason({ message: '[I9] 현물 합계가 수주 매출을 넘습니다 — 960,000,000원 초과' })
  assert.notEqual(r, 'quota', '「초과」 두 글자만 보고 한도라고 하면 안 된다')
})

test('★ 우리말 권한·설정·형식 문장도 사유를 얻는다 — 같은 구멍이 갈래마다 열려 있었다', () => {
  const cases: [string, string][] = [
    ['관리자 권한이 필요합니다', 'auth'],
    ['권한 없음', 'auth'],
    ['인증이 만료되었습니다. [변경]으로 Google 계정을 다시 연결해주세요', 'auth'],
    ['AI 키 인증에 문제가 있습니다. 관리자에게 문의하세요.', 'auth'],
    ['Gemini 키가 설정되지 않았습니다', 'config'],
    ['지금 쓸 수 있는 AI 모델이 없습니다', 'config'],
    ['Gemini 응답 형식이 올바르지 않습니다', 'bad_json'],
    ['AI 응답을 파싱할 수 없습니다. 다시 시도해 주세요.', 'bad_json'],
  ]
  for (const [message, want] of cases) {
    assert.equal(classifySystemReason({ message }), want, message)
  }
})

test('★ 우리말 줄은 영어 판정 **뒤에** 있어야 한다 — 앞에 두면 섞인 문장에서 이겨 버린다', () => {
  // 429 를 담은 Prisma 오류는 여전히 db 다(이 파일 분류기 주석이 지키려던 순서).
  assert.equal(classifySystemReason({ prismaCode: 'P2021', message: '429 한도' }), 'db')
  // 숫자를 든 벤더 오류는 우리말 꼬리가 붙어도 영어 신호가 이긴다
  assert.equal(classifySystemReason({ message: 'Gemini API 오류 (429): 한도' }), 'quota')
  assert.equal(classifySystemReason({ message: '사내 모델 응답 503 · 권한이 없습니다' }), 'server')
})

test('★ 사유를 못 붙일 문장은 그대로 unknown 이다 — 아무 말에나 이름을 붙이지 않는다', () => {
  // 원인이 우리 사유 아홉 가지 중 어디에도 없는 것은 솔직히 모른다고 한다.
  // (이 문장은 I03 에서 화면이 원문을 그대로 보여 주는 것으로 답한다)
  assert.equal(
    classifySystemReason({ message: '이 영상의 정보를 가져오지 못했습니다. 비공개이거나 삭제되었을 수 있습니다' }),
    'unknown',
  )
})

// ── 잡이 아는 코드는 분류기까지 간다 (2026-09-20 실측) ────────────
//
// `ci_jobs.error_code` 에는 `AI_FAILED` 가 또렷이 적혀 있는데, 로그로 투영할 때
// `new Error(메시지)` 로 다시 싸면서 코드를 버렸다. 코드는 `context` 에만 남았고
// 그 자리는 분류기가 안 보는 자리였다 — ci_job 사건 267건이 전부 「원인 미상」.

test('★ 잡 실패를 로그로 옮길 때 코드를 버리지 않는다 — 이름이 아니라 값이 가야 한다', () => {
  // 주석에 적어 두면 통과하는 가드는 가드가 아니다(이 저장소가 CSP 에서 한 번 겪었다).
  const src = stripComments(read('lib/ci/jobs/queue.ts'))
  assert.match(src, /code:\s*input\.errorCode/, '코드를 오류 객체에 실어 보내야 한다')
  assert.ok(
    !/error:\s*new Error\(/.test(src),
    '오류를 맨 new Error 로 다시 싸면 잡이 아는 코드가 그 자리에서 사라진다',
  )
})

test('★ 코드가 붙어도 더 구체적인 문장을 가로채지 않는다 — AI_FAILED 는 「왜」를 말하지 않는다', () => {
  const quotaSentence = '등록된 AI 공급자가 전부 사용량 한도에 걸렸습니다. 한도가 풀릴 때까지 기다리거나 시스템 설정 → 통합에서 다른 공급자 키를 추가해 주세요.'
  assert.equal(classifySystemReason({ crmCode: 'AI_FAILED', message: quotaSentence }), 'quota')
  assert.equal(classifySystemReason({ crmCode: 'PROVIDER_QUOTA', message: '무슨 말인지 모를 문장' }), 'quota')
})

test('★ 커넥터 실패는 우리 고장이 아니다 — 없는 사유를 지어 붙이지 않는다', () => {
  const r = classifySystemReason({
    crmCode: 'CONNECTOR_FAILED',
    message: '이 영상의 정보를 가져오지 못했습니다. 비공개이거나 삭제되었을 수 있습니다',
  })
  assert.equal(r, 'unknown')
})

// ── 회수하다 죽은 잡도 화면에 올린다 (2026-09-20 실측) ────────────
//
// 회수(recoverStalledJobs)는 «판정은 정상 실패와 같은 함수를 쓴다»로 규약을 맞췄는데
// **투영은 안 맞췄다.** 그래서 잠금 만료로 죽은 322건이 관리자 화면에 한 건도 안 떴다.
// 화면에 보이던 267건보다 많은 실패가, 안 보이는 자리에 쌓여 있었다.

/** recoverStalledJobs 함수 몸통만 잘라 본다 — 파일 어딘가에 있다는 것은 근거가 못 된다 */
function reclaimBody(): string {
  const src = stripComments(read('lib/ci/jobs/queue.ts'))
  const start = src.indexOf('export async function recoverStalledJobs')
  assert.ok(start >= 0, 'recoverStalledJobs 를 못 찾았다 — 이름이 바뀌었으면 이 가드부터 고친다')
  const rest = src.slice(start + 1)
  const end = rest.indexOf('\nexport ')
  return end >= 0 ? rest.slice(0, end) : rest
}

test('★ 잠금 만료로 죽은 잡을 관리자 로그에 올린다 — 안 올리면 실패가 통째로 안 보인다', () => {
  const body = reclaimBody()
  assert.match(body, /recordSystemEventAsync\(/, '회수하다 죽은 잡을 투영하지 않고 있다')
  assert.match(body, /status === 'dead'/, '무엇이 죽었는지 실제 갱신 결과로 골라야 한다')
})

test('★ 재시도로 회수한 것은 안 올린다 — 올리면 진짜 죽은 잡이 그 안에 묻힌다', () => {
  const body = reclaimBody()
  // 투영은 dead 로 모인 목록에만 걸린다. 'failed' 쪽으로는 한 건도 새지 않아야 한다.
  assert.ok(
    !/status === 'failed'[\s\S]{0,200}?recordSystemEventAsync/.test(body),
    '재시도 대기(failed)까지 올리면 로그가 재시도 횟수만큼 부푼다',
  )
  assert.match(body, /buried\.length > 0/, '실제로 묻힌 것이 있을 때만 올려야 한다')
})

// ── 아는 것을 모른다고 말하지 않는다 (2026-09-20 실측) ────────────
//
// 사유를 못 붙였다고 원문이 이미 하고 있는 말까지 감췄다.
// 화면: 「원인을 자동으로 알아내지 못했습니다」 / 원문: 「비공개이거나 삭제되었을 수 있습니다」

test('★ 사유를 못 붙여도 우리가 쓴 문장은 그대로 올린다', () => {
  const d = detailOf({
    source: 'ci_job', reason: 'unknown', feature: 'ci-collect',
    message: '이 영상의 정보를 가져오지 못했습니다. 비공개이거나 삭제되었을 수 있습니다',
  })
  assert.match(d, /비공개이거나 삭제/, '원문이 말하고 있는 것을 화면이 감추면 안 된다')
  assert.ok(!d.includes('원인을 자동으로 알아내지 못했습니다'), '아는 것을 모른다고 말하지 않는다')
})

test('★ 사람 문장이 아니면 예전 문구가 정직하다 — 화면이 개발자 콘솔이 되면 안 된다', () => {
  for (const message of [
    "Cannot read properties of undefined (reading 'findMany')",
    'Minified React error #310; visit https://react.dev/errors/310 for the full message',
    'ChunkLoadError',
  ]) {
    const d = detailOf({ source: 'client', reason: 'unknown', message })
    assert.match(d, /원인을 자동으로 알아내지 못했습니다/, message)
  }
  // 메시지가 아예 없을 때도 예전 그대로다
  assert.match(detailOf({ source: 'client', reason: 'unknown' }), /원인을 자동으로 알아내지 못했습니다/)
})

test('★ 사유가 붙은 자리는 안 건드린다 — 그 사유 전용 문장이 더 낫다', () => {
  const d = detailOf({ source: 'host_ai', reason: 'quota', message: '한도를 다 썼습니다' })
  assert.match(d, /한도가 풀리기를 기다리거나/, '사유별 조언을 원문으로 덮으면 안 된다')
})

test('★ 첫 줄만 본다 — 스택이 화면 첫 줄로 새면 안 된다', () => {
  const withStack = '이 영상의 정보를 가져오지 못했습니다\n    at n (/var/task/apps/web/.next/server/chunks/65312.js:1:4642)'
  const said = humanSentenceOf(withStack)
  assert.equal(said, '이 영상의 정보를 가져오지 못했습니다')
  assert.ok(!said!.includes('/var/task'), '내부 경로가 화면 첫 줄에 실리면 안 된다')
  // 던진 쪽 이름표는 관리자에게 아무 뜻이 없다
  assert.equal(humanSentenceOf('CrmError: 권한이 없습니다'), '권한이 없습니다')
  // 한 줄에 안 들어가는 길이는 자르고, 원문은 접힌 채로 그대로 남는다
  assert.ok((humanSentenceOf('가'.repeat(400)) ?? '').length <= 161)
})

test('★ 화면 첫 줄로 가는 값은 가린 뒤의 것이어야 한다 — 로그가 유출 경로가 되면 안 된다', () => {
  // record.ts 는 rawMessage 가 아니라 maskSecrets 를 지난 message 를 넘겨야 한다.
  // 이름이 아니라 **어느 값이 가는지**를 본다(주석에 적어 두면 통과하는 가드는 가드가 아니다).
  const src = stripComments(read('lib/system-log/record.ts'))
  assert.match(src, /const message = maskSecrets\(rawMessage\)/)
  const narrateBlock = src.slice(src.indexOf('const narrate = {'), src.indexOf('const stack ='))
  assert.match(narrateBlock, /(^|[\s{,])message,/m, 'narrate 에 가린 message 를 넘겨야 한다')
  assert.ok(!/rawMessage/.test(narrateBlock), '가리기 전 값이 화면 문장으로 가면 안 된다')
  // 실제로 가려지는지도 확인한다 — 규칙만 보고 넘어가지 않는다
  assert.ok(!humanSentenceOf(maskSecrets('키가 틀렸습니다 ?key=AIzaSyABCDEFGHIJKL'))!.includes('AIzaSy'))
})

// ── 웹 검색 한도 조언은 자리마다 새지 않아야 한다 (2026-09-20 실측) ────────────
//
// `narrate.ts` 에는 웹 검색용 갈래가 **이미 있었다.** 그런데 `signals-server.ts` 가
// 97줄에서 webSearch 를 켜 놓고 기록에는 안 실었다. 그래서 갈래가 한 번도 안 골라졌고,
// 92건 내내 화면은 「모델을 바꾸면 됩니다」, 원문은 「모델을 바꿔도 안 풀립니다」였다.
//
// 자리를 손으로 세 개 적어 두면 네 번째가 생길 때 그대로 샌다.
// 그래서 **파생 목록**으로 본다 — 기록을 남기면서 webSearch 를 아는 파일이면 전부 걸린다.

test('★ 기록을 남기면서 webSearch 를 아는 파일은 그 값을 기록에 실어야 한다 (파생 목록)', () => {
  const files = recorderFiles().filter((f) => /webSearch/.test(stripComments(read(f))))
  assert.ok(files.length >= 2, `webSearch 를 아는 기록 파일이 ${files.length}개뿐이다 — 탐색이 깨졌다`)
  for (const f of files) {
    const args = recordCallArgs(stripComments(read(f)))
    assert.ok(args.length > 0, `${f}: 기록 호출을 못 잘랐다`)
    assert.ok(
      args.some((a) => /webSearch/.test(a)),
      `${f}: webSearch 를 알면서 **기록 인자에는** 안 싣고 있다 — 화면이 반대 조언을 한다`,
    )
  }
})

test('★ 웹 검색 한도와 일반 한도는 화면에서 다른 말을 한다 — 같은 말이면 갈래를 둔 뜻이 없다', () => {
  const web = detailOf({ source: 'host_ai', reason: 'quota', webSearch: true })
  const plain = detailOf({ source: 'host_ai', reason: 'quota', webSearch: false })
  assert.notEqual(web, plain)
  assert.ok(!/다른 모델로 바꾸면 됩니다/.test(web), '웹 검색 한도에 모델 교체는 틀린 답이다')
  assert.match(web, /모델을 바꿔도 풀리지 않습니다/)
})

// ── 웹 검색 한도는 다른 바구니다 (2026-08-24 실측) ────────────
//
// 같은 키로 일반 호출은 65초 뒤 200 으로 회복되는데(분당 한도),
// `google_search` 를 켠 호출은 기다려도 계속 429였다.
// 그래서 일반 한도용 조언("다른 모델로 바꾸세요")을 그대로 주면 **틀린 답**이 된다 —
// 모든 모델이 같은 그라운딩 한도를 나눠 쓰기 때문이다.

test('웹 검색 실패에는 웹 검색용 답을 준다 — 모델 교체 조언은 여기서 안 먹힌다', async () => {
  const { playbookFor } = await import('./playbook.ts')
  const web = playbookFor('quota', { webSearch: true })
  const plain = playbookFor('quota', { webSearch: false })
  assert.ok(web && plain)
  assert.notEqual(web!.diagnosis, plain!.diagnosis, '두 한도를 같은 말로 설명하면 안 된다')
  assert.match(web!.diagnosis, /웹 검색/)
  const webActions = web!.actions.map((a) => a.what).join(' ')
  assert.ok(!/다른 모델/.test(webActions), '웹 검색 한도에는 모델 교체가 답이 아니다')
  assert.match(plain!.actions.map((a) => a.what).join(' '), /다른 모델/)
})

test('맥락이 없으면 일반 한도 답으로 돌아간다 — 없는 정보를 지어내지 않는다', async () => {
  const { playbookFor } = await import('./playbook.ts')
  assert.equal(playbookFor('quota')?.diagnosis, playbookFor('quota', null)?.diagnosis)
  assert.match(playbookFor('quota')!.diagnosis, /키 하나를 여러 기능이/)
})

/*
  **한도는 키 단위다.** 그래서 같은 공급자의 다른 모델로 걷는 것은 낭비지만,
  **다른 공급자로 넘어가는 것은 낭비가 아니다** — 키가 다르면 바구니도 다르다.
  예전 판은 웹 검색 한도에서 통째로 멈췄는데, 그때 OpenAI 키가 멀쩡히 있었다(실측 2026-09-19).
  지금은 `pruneChain(scope='provider')` 이 그 공급자만 걷어내고 다음 공급자로 간다.
*/
test('한도면 그 공급자를 통째로 건너뛴다 — 같은 키를 다시 때리지 않는다', () => {
  const src = read('lib/crm/ai/adapters/host.ts')
  assert.match(src, /rest = pruneChain\(rest, cand, scope\)/,
    '같은 공급자 안에서 계속 걸으면 사용자만 4배 더 기다린다')
  assert.match(src, /등록된 AI 공급자가 전부 사용량 한도에 걸렸습니다/,
    '전부 막혔을 때 무엇이 막힌 것인지 말해야 한다')
})

test('실패 기록에 webSearch 를 실어 보낸다 — 안 실으면 해결책을 고를 수 없다', () => {
  const runner = read('lib/crm/ai/runner.ts')
  assert.match(runner, /webSearch: adapter\.webSearch === true/)
  assert.match(read('lib/crm/ai/adapters/host.ts'), /^\s+webSearch,$/m, '어댑터가 값을 채워야 한다')
  const route = read('app/api/admin/system-log/remedy/route.ts')
  assert.match(route, /playbookFor\(sample\.reason, sample\.context\)/, '해결책이 맥락을 봐야 한다')
})

// ── 사유는 코드로 안다, 잡음은 안 남긴다 (2026-08-24 실측) ────

test('CrmError 코드가 문장 추측보다 먼저다 — 우리말 메시지는 영어 패턴에 안 걸린다', () => {
  // 실측: `CrmError('PROVIDER_QUOTA', 'AI 웹 검색 한도를 다 썼습니다…')` 가 unknown 으로 잡혔다
  assert.equal(classifySystemReason({
    crmCode: 'PROVIDER_QUOTA',
    message: 'AI 웹 검색 한도를 다 썼습니다. 이건 모델을 바꿔도 풀리지 않습니다',
  }), 'quota')
  assert.equal(classifySystemReason({ crmCode: 'UNAUTHORIZED', message: '권한이 없습니다' }), 'auth')
  // 사용자 입력 문제는 장애가 아니다
  assert.equal(classifySystemReason({ crmCode: 'VALIDATION_FAILED', message: '값이 올바르지 않습니다' }), 'unknown')
})

test('Gemini 사유가 CrmError 코드보다 먼저다 — 더 구체적인 신호가 이긴다', () => {
  assert.equal(classifySystemReason({ geminiReason: 'bad_json', crmCode: 'PROVIDER_QUOTA' }), 'bad_json')
})

test('프레임워크가 자기에게 던지는 신호는 로그가 아니다 — 진짜 실패가 묻힌다', () => {
  const src = read('lib/system-log/record.ts')
  assert.match(src, /Dynamic server usage/, 'Next 의 동적 렌더 신호를 걸러야 한다')
  assert.match(src, /NEXT_\(REDIRECT\|NOT_FOUND\)/, 'redirect·notFound 도 제어 흐름이지 실패가 아니다')
  // 거르는 자리가 저장 **전**이어야 한다 — 뒤에 두면 이미 한 줄 쌓인 뒤다
  const filterAt = src.indexOf('NOT_A_FAILURE.some')
  const insertAt = src.indexOf("from('system_events').insert")
  assert.ok(filterAt > 0 && filterAt < insertAt, '거르기가 저장보다 먼저여야 한다')
})

test('사실 문장과 해결책이 같은 말을 한다 — 웹 검색 한도에 "모델을 바꾸라"고 하지 않는다', () => {
  const web = detailOf({ source: 'crm_ai', reason: 'quota', webSearch: true })
  const plain = detailOf({ source: 'crm_ai', reason: 'quota' })
  assert.ok(!/다른 모델로 바꾸면/.test(web), `화면이 자기 말을 뒤집는다: ${web}`)
  assert.match(web, /웹 검색/)
  assert.match(plain, /다른 모델로 바꾸면/)
})

test('기록이 webSearch 를 문장 조립까지 넘긴다 — 안 넘기면 위 규칙이 무의미하다', () => {
  assert.match(read('lib/system-log/record.ts'), /webSearch: input\.context\?\.webSearch === true/)
})

test('플레이북 문장에 마크다운 표시를 넣지 않는다 — 화면이 그대로 별표를 보여 준다', () => {
  // 실측(2026-08-24): "**다른 한도**"가 화면에 별표째 떴다. 이 문장들은 plain text 로 렌더된다.
  // 주석을 먼저 걷어낸다 — 안 그러면 주석 양옆의 따옴표가 짝지어져 없는 위반을 만든다(실측)
  const src = stripComments(read('lib/system-log/playbook.ts'))
  const inStrings = src.match(/'[^'\n]*\*\*[^'\n]*'/g) ?? []
  assert.deepEqual(inStrings, [], `문장 안에 마크다운 강조가 남아 있다:\n  ${inStrings.join('\n  ')}`)
})
