/**
 * 개인정보가 가림 없이 나가는 것을 막는다
 *
 * **왜**: 가림 부품은 예전부터 있었는데 **부르는 앱 코드가 0곳**이었다(실측 2026-09-16).
 *   명함과 리드와 딜 메모와 일일업무와 주간보고와 회의 전사가 전부 안 가리고 나갔고
 *   전송 기록도 없었다. 만들어 둔 것과 지나는 것은 다른 명제다.
 *
 *   그 여덟을 한 겹 안으로 옮긴 뒤 이 가드를 둔다. 안 두면 아홉 번째가 생기는 날
 *   그것만 다시 맨몸으로 나가고, 그때는 실패가 아니라 **아무 신호도 없는 상태**라
 *   화면에서 정상과 구분되지 않는다.
 *
 * 검사 셋:
 *   1) 등재된 길이 전부 한 겹을 지난다
 *   2) 한 겹을 지나는 코드는 원장을 반드시 넘긴다 (창구 없이 부르는 길이 없다)
 *   3) 규칙이 도는 대상이 실제로 있다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * 개인정보가 지나는 길과, 그 길이 지나야 하는 한 겹.
 *
 * 파일을 여기 적는 것은 「이 길로 사람 정보가 나간다」는 선언이다.
 * 새 길이 생기면 여기 더하고, 더하는 순간 한 겹을 지나야 통과한다.
 */
const PII_PATHS: { file: string; through: 'guardedText' | 'guardedMedia' | 'guardedGeminiText'; carries: string }[] = [
  { file: 'lib/crm/services/card-read.ts', through: 'guardedMedia', carries: '명함 사진 (이름 직함 연락처 회사)' },
  { file: 'lib/gemini-lead.ts', through: 'guardedText', carries: '담당자 이름 연락처 이메일' },
  { file: 'app/api/deals/ai-parse/route.ts', through: 'guardedGeminiText', carries: '딜 메모 원문' },
  { file: 'app/api/deals/activities/route.ts', through: 'guardedGeminiText', carries: '딜 활동 메모' },
  { file: 'lib/daily/analyze-work-core.ts', through: 'guardedGeminiText', carries: '누가 누구와 무엇을 했는지' },
  { file: 'app/api/daily/memos/clusters/route.ts', through: 'guardedGeminiText', carries: '거래처와 사람 이름' },
  { file: 'lib/gemini-daily-to-weekly.ts', through: 'guardedGeminiText', carries: '일일업무를 모은 것' },
  { file: 'lib/meeting/transcribe-parts.ts', through: 'guardedMedia', carries: '회의 녹음과 말한 사람 이름' },
]

/** 한 겹 자체. 이 셋만이 가림과 기록을 붙인다 */
const WRAPPERS = ['lib/ai/guarded-call.ts', 'lib/ai/guarded-gemini.ts']

function read(rel: string): string {
  const p = join(WEB, rel)
  return existsSync(p) ? readFileSync(p, 'utf8') : ''
}

/** import 줄만 있고 안 부르는 것을 통과시키지 않는다 */
function callsIt(src: string, name: string): boolean {
  return src.split('\n')
    .filter((l) => !l.trim().startsWith('import'))
    .some((l) => l.includes(`${name}(`))
}

test('★ 개인정보가 지나는 길은 전부 한 겹을 지난다', () => {
  const offenders: string[] = []
  for (const p of PII_PATHS) {
    const src = read(p.file)
    if (!src) { offenders.push(`${p.file} 파일이 없다 (이름이 바뀌었는지 확인)`); continue }
    if (!callsIt(src, p.through)) {
      offenders.push(`${p.file} 가 ${p.through} 를 안 지난다 — 여기로 ${p.carries} 가 맨몸으로 나간다`)
    }
  }
  assert.deepEqual(offenders, [], [
    '개인정보가 가림도 기록도 없이 밖으로 나간다.',
    '실패가 아니라 아무 신호도 없는 상태라 화면에서 정상과 구분되지 않는다:',
    ...offenders.map((o) => `  ${o}`),
  ].join('\n'))
})

test('★ 한 겹은 원장을 반드시 받는다, 창구 없이 부르는 길이 없다', () => {
  const offenders: string[] = []
  for (const rel of WRAPPERS) {
    const src = read(rel)
    assert.ok(src, `${rel} 이 없다`)
    // 선택 인자로 만들면 안 준 길이 조용히 0건이 된다
    if (/ledger\?\s*:/.test(src)) offenders.push(`${rel} 이 원장을 선택 인자로 받는다`)
    if (!/ledger:\s*AiLedger/.test(src)) offenders.push(`${rel} 이 원장을 필수로 안 받는다`)
  }
  assert.deepEqual(offenders, [], [
    '원장을 선택으로 두면 안 준 길이 조용히 0건이 된다:',
    ...offenders.map((o) => `  ${o}`),
  ].join('\n'))
})

test('규칙이 도는 대상이 실제로 있다', () => {
  // 목록이 비거나 경로가 깨지면 위 검사는 «위반 없음»으로 통과해 버린다
  assert.ok(PII_PATHS.length >= 8, `등재된 길이 ${PII_PATHS.length}개뿐이다`)
  for (const p of PII_PATHS) {
    assert.ok(read(p.file).length > 0, `${p.file} 을 못 읽는다`)
    assert.ok(p.carries.length > 0, `${p.file} 이 무엇을 싣는지 안 적혀 있다`)
  }
})

test('★ 이름이 개인정보 종류에 들어 있다', async () => {
  // 이름은 개인정보다. 기준은 이미 서 있었고 규칙만 이름을 안 잡고 있었다
  const mask = readFileSync(join(WEB, '..', '..', 'packages/ai-gateway/src/mask.ts'), 'utf8')
  assert.match(mask, /PiiKind[^\n]*'name'/, 'PiiKind 에 name 이 없다')
  assert.match(mask, /knownNames/, '아는 이름을 받는 자리가 없다')
})

test('★ 이름을 추측으로 찾지 않는다', () => {
  /*
    정규식으로 이름을 찾으면 틀렸을 때 두 방향으로 다 나쁘다 —
    놓친 이름은 그대로 나가고, 엉뚱하게 잡은 낱말은 문장을 부순다.
    둘 다 출력을 사람이 읽을 때까지 안 보인다.

    그런데 추측할 필요가 없다. 이름은 이미 우리 것이다.
    그래서 이 파일에 «이름을 알아내는 규칙» 이 생기면 실패한다.
  */
  const mask = readFileSync(join(WEB, '..', '..', 'packages/ai-gateway/src/mask.ts'), 'utf8')
  const guessing = [
    /kind:\s*'name'[^}]*re:/,
    /\{\s*kind:\s*'name',\s*re:/,
    /NAME_PATTERN|NAME_RE|nameRegex/,
  ]
  const offenders = guessing.filter((re) => re.test(mask)).map((re) => re.source)
  assert.deepEqual(offenders, [], [
    '이름을 규칙으로 알아내려 한다. 틀리면 새거나 문장을 부수고 둘 다 늦게 보인다:',
    ...offenders.map((o) => `  ${o}`),
    '아는 이름 목록으로 맞춘다 — 그것은 정확하고 오탐이 없다',
  ].join('\n'))
})

test('★ 이름을 아는 길은 목록을 실제로 넘긴다', () => {
  // 목록을 받을 자리만 만들고 안 넘기면 이름은 그대로 나간다
  const wired = [
    'lib/meeting/transcribe-parts.ts',
    'app/api/deals/ai-parse/route.ts',
    'app/api/deals/activities/route.ts',
    'lib/daily/analyze-work-core.ts',
    'app/api/daily/memos/clusters/route.ts',
    'lib/weekly-report/draft-server.ts',
  ]
  const offenders = wired.filter((rel) => !read(rel).includes('knownNames')
    && !read(rel).includes('namesForNote') && !read(rel).includes('namesFromDirectory'))
  assert.deepEqual(offenders, [], [
    '이름이 나올 수 있는 길인데 목록을 안 넘긴다:',
    ...offenders.map((o) => `  ${o}`),
  ].join('\n'))
})
