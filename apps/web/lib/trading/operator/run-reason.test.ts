/**
 * 실행 사유를 사람 말로 읽는 규칙 — **버리지 않는지**를 먼저 묻는다
 *
 * 이 시험이 지키는 것 셋
 *   ① 실측 사유가 사람 말이 된다
 *   ② 못 알아본 표식과 원문이 안 사라진다
 *   ③ 운영 화면이 이 함수를 **실제로 부르고** 긴 글자를 줄바꿈한다
 *     (단위 시험이 초록이어도 화면이 안 부르면 사용자에게는 아무 일도 안 일어난다)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readEnvelope } from '../broker/kis-request.ts'
import { readRunReason, runStatusLabel, runStatusTone } from './run-reason.ts'
import { DIRECTION_LABEL } from '../signal-labels.ts'
import { stripComments } from '../../ui/component-scan.ts'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/** 실측 2026-09-28 운영 화면에 그대로 찍히던 줄 */
const REAL = 'bar_not_ready|bar_retry=2/2,still_missing|fills_failed:kis:kis_APAC0071|broker=failed'

// ─────────────────────────────────────────────────────────────
// ① 실측 사유가 사람 말이 된다
// ─────────────────────────────────────────────────────────────

test('실측 사유 네 토막이 전부 사람 말이 된다', () => {
  const view = readRunReason(REAL)

  assert.equal(view.unknown.length, 0, `못 알아본 표식: ${view.unknown.join(' · ')}`)
  assert.equal(view.lines.length, 4, '네 토막이면 네 줄이다')
  for (const l of view.lines) {
    assert.ok(/[가-힣]/.test(l.text), `사람 말이 아니다: ${l.text}`)
    assert.ok(!/[a-z]_[a-z]/.test(l.text), `기계 표식이 그대로 샜다: ${l.text}`)
  }
})

test('가장 심각한 줄이 앞에 선다 — 매분 뜨는 대기 줄이 고장을 덮지 않는다', () => {
  const view = readRunReason(REAL)
  assert.equal(view.headline?.tone, 'blocked')
  // 첫 토막 bar_not_ready 는 waiting 이라 머리줄이 아니다
  assert.notEqual(view.headline?.text, readRunReason('bar_not_ready').headline?.text)
  // 같은 blocked 끼리는 **나온 순서**를 지킨다 (판의 진행 순서가 뜻이다)
  assert.equal(view.headline?.text, '봉을 2번까지 다시 물었지만 안 들어왔습니다')
})

test('심각도가 없는 판은 정상 줄이 머리줄이 된다', () => {
  const view = readRunReason('not_continuous_trading|watch=off')
  assert.equal(view.headline?.tone, 'waiting', '기다리면 풀리는 것이 정상보다 앞이다')
  assert.equal(readRunReason('day_config_frozen').headline?.tone, 'ok')
})

// ─────────────────────────────────────────────────────────────
// ② 버리지 않는다
// ─────────────────────────────────────────────────────────────

test('모르는 표식은 버리지 않고 접어 둔다', () => {
  const view = readRunReason('bar_not_ready|totally_new_marker=7')
  assert.deepEqual(view.unknown, ['totally_new_marker=7'])
  assert.equal(view.lines.length, 1, '아는 것만 문장이 된다')
  assert.equal(view.raw, 'bar_not_ready|totally_new_marker=7', '원문은 통째로 남는다')
})

test('하나도 못 알아봐도 사실을 지우지 않는다', () => {
  const view = readRunReason('zzz_unknown|qqq_unknown')
  assert.deepEqual(view.unknown, ['zzz_unknown', 'qqq_unknown'])
  assert.equal(view.headline?.text, '사유를 사람 말로 못 읽었습니다')
  assert.equal(view.raw, 'zzz_unknown|qqq_unknown')
})

test('사유가 비면 머리줄도 없다 — 빈 칸을 지어내지 않는다', () => {
  for (const empty of [null, undefined, '', '   ']) {
    const view = readRunReason(empty)
    assert.equal(view.headline, null)
    assert.deepEqual(view.lines, [])
    assert.deepEqual(view.unknown, [])
    assert.equal(view.raw, '')
  }
})

// ─────────────────────────────────────────────────────────────
// ③ 나누는 규칙
// ─────────────────────────────────────────────────────────────

test('괄호 안의 쉼표로는 안 쪼갠다 — 관문 한 덩어리는 한 줄이다', () => {
  const gate = 'gate(broker_fail=0,since_run=1,calib=true,spec=true,margin_tight=false,ai_budget_out=false)'
  const view = readRunReason(gate)
  assert.equal(view.unknown.length, 0)
  assert.equal(view.lines.length, 1)
  assert.equal(view.lines[0].text, '관문 점검에 걸린 것이 없습니다')
})

test('관문은 걸린 것만 말한다', () => {
  const view = readRunReason('gate(broker_fail=3,since_run=unknown,calib=false,spec=true)')
  assert.equal(view.lines.length, 1)
  assert.match(view.lines[0].text, /연속 3번 실패/)
  assert.match(view.lines[0].text, /보정 모델 없음/)
  assert.ok(!view.lines[0].text.includes('spec'), '안 걸린 것은 안 적는다')
  assert.equal(view.lines[0].tone, 'blocked')
})

test('쉼표 한 덩어리를 통째로 아는 꼴은 안 쪼갠다', () => {
  assert.equal(
    readRunReason('bar_retry=2/2,still_missing').lines[0].text,
    '봉을 2번까지 다시 물었지만 안 들어왔습니다',
  )
  assert.equal(
    readRunReason('operator=checked:9,attention:2').lines[0].text,
    '점검 9가지 중 손볼 것이 2개입니다',
  )
})

test('통째로 모르는 꼴만 쉼표로 한 번 더 쪼갠다', () => {
  const view = readRunReason('position=flat,closed=0')
  assert.deepEqual(view.lines.map((l) => l.text), ['들고 있는 포지션이 없습니다', '오늘 닫은 거래가 없습니다'])
})

// ─────────────────────────────────────────────────────────────
// ④ 표식마다의 말
// ─────────────────────────────────────────────────────────────

test('증권사 응답 번호를 번호대로 가른다', () => {
  assert.match(readRunReason('http_500').lines[0].text, /증권사 서버가 오류/)
  assert.match(readRunReason('http_500:no_body').lines[0].text, /증권사 서버가 오류/)
  assert.match(readRunReason('http_429').lines[0].text, /횟수 제한/)
  assert.match(readRunReason('http_401').lines[0].text, /거절/)
  assert.equal(readRunReason('http_500').headline?.tone, 'blocked')
})

test('포지션 방향은 화면이 쓰는 이름 그대로 쓴다 — 여기서 새 말을 짓지 않는다', () => {
  assert.equal(readRunReason('position=longx2').lines[0].text, `${DIRECTION_LABEL.long} 2계약을 들고 있습니다`)
  assert.equal(readRunReason('position=shortx1').lines[0].text, `${DIRECTION_LABEL.short} 1계약을 들고 있습니다`)
  // 신호 표와 같은 말이어야 한다 (같은 것을 두 이름으로 부르면 사람은 둘로 읽는다)
  assert.equal(DIRECTION_LABEL.long, '매수')
})

test('신호 발행이 멈춘 단계를 말한다', () => {
  const view = readRunReason('emit:calibrate:no_model')
  assert.equal(view.unknown.length, 0)
  assert.match(view.lines[0].text, /6단계 중 5단계에서 멈췄습니다/)
})

test('일정 표식이 신호 단계 뒤에 붙어도 둘 다 펴진다', () => {
  const view = readRunReason('emit:judge:gate_not_passed,event=만기일')
  assert.equal(view.lines.length, 2, '통째로 받아 일정 표식을 원문에만 남기지 않는다')
  assert.match(view.lines[1].text, /만기일/)
})

test('지식 일감은 이름과 결과를 말한다', () => {
  assert.equal(readRunReason('knowledge=analyze_source:done:kept=3,dropped=1').lines[0].text, '자료 분석을 마쳤습니다')
  assert.equal(readRunReason('knowledge=knowledge_card:no_source').lines[0].text, '지식 카드를 못 했습니다')
})

// ─────────────────────────────────────────────────────────────
// ④a 장이 안 열린 시간
// ─────────────────────────────────────────────────────────────

/**
 * **장이 안 열린 것을 고장으로 말하면 빨간색이 값을 잃는다.**
 *
 * 실측 2026-09-28: 08:00~08:19 기록이 전부 「봉을 2번까지 다시 물었지만 안 들어왔습니다」
 * 였다. 접속매매는 08:45 에 시작하므로 그 시간에 봉이 없는 것은 정상이다.
 * 매일 아침 45분씩 빨간 줄이 뜨면 사람은 빨간색을 안 믿게 되고,
 * 정작 진짜 고장이 난 날 그 줄도 같이 흘려보낸다.
 */
test('★ 장이 안 열린 시간은 고장이 아니다', () => {
  const cases: [string, string][] = [
    ['market_closed=before_open', '장이 아직 안 열렸습니다'],
    ['market_closed=after_close', '오늘 장이 끝났습니다'],
    ['market_closed=auction', '단일가 구간이라 판단을 안 했습니다'],
  ]
  for (const [mark, text] of cases) {
    const view = readRunReason(`${mark}|position=flat,closed=0|broker=ok`)
    assert.equal(view.unknown.length, 0, `못 알아본 표식: ${view.unknown.join(' · ')}`)
    assert.equal(view.lines[0].text, text)
    assert.equal(view.lines[0].tone, 'ok', `${mark} 을 고장으로 말한다`)
    assert.notEqual(view.headline?.tone, 'blocked', `${mark} 인데 머리줄이 빨갛다`)
  }
})

test('★ 모르는 국면 이름도 장 시간이 아니라고는 말한다 — 표식을 안 버린다', () => {
  const view = readRunReason('market_closed=brand_new_phase')
  assert.deepEqual(view.unknown, [])
  assert.equal(view.lines[0].tone, 'ok')
})

test('★ 단일가 구간에 봉이 없는 것도 그 사실과 함께 뜬다', () => {
  const view = readRunReason('bar_not_ready|market=auction|bar_retry=2/2,still_missing')
  assert.equal(view.unknown.length, 0)
  assert.ok(view.lines.some((l) => l.text.includes('단일가 구간')), '단일가라는 사실이 안 뜬다')
})

// ─────────────────────────────────────────────────────────────
// ④b 증권사가 거절한 이유
// ─────────────────────────────────────────────────────────────

/**
 * **사용자 지적 2026-09-28** 「에러인듯?」 — 운영 화면에
 * `체결 조회가 실패했습니다: kis:kis_APAC0071` 이 매분 빨갛게 떠 있었다.
 * 코드만으로는 무엇이 문제인지도 어디서 고치는지도 모른다.
 */
test('★ 뜻을 아는 증권사 코드는 뜻과 할 일을 말한다', () => {
  const view = readRunReason('fills_failed:kis:kis_APAC0071|broker=failed')
  assert.equal(view.unknown.length, 0)
  const said = view.lines[0].text
  assert.match(said, /계좌번호가 없습니다/, '무엇이 문제인지 안 말한다')
  assert.match(said, /증권사 자격증명/, '어디서 고치는지 안 말한다')
  assert.equal(/kis_|APAC/.test(said), false, `기계 글자가 샜다: ${said}`)
  assert.equal(view.lines[0].tone, 'blocked')
})

test('★ 모르는 증권사 코드는 지어내지 않고 접어 둔다', () => {
  const view = readRunReason('fills_failed:kis:kis_ZZZZ9999')
  // 뜻을 모르면 옛 꼴로 떨어져 원문을 남긴다 — 버리지도 지어내지도 않는다
  assert.equal(view.unknown.length, 0)
  assert.match(view.lines[0].text, /ZZZZ9999/, '모르는 코드를 통째로 버렸다')
  assert.match(view.lines[0].text, /거절/, '무슨 일이 났는지는 말해야 한다')
})

test('★ 코드 표가 실측 근거를 들고 있다 — 짐작으로 적은 뜻이 없게', () => {
  const src = readFileSync(join(WEB, 'lib', 'trading', 'broker', 'kis-codes.ts'), 'utf8')
  assert.match(src, /source:/, '근거 칸이 없다')
  assert.match(src, /실측 2026-09-28/, '언제 무엇을 보고 적었는지가 없다')
  // 증권사 원문을 화면 말로 그대로 쓰지 않는다 — 계좌·내부 구조가 섞여 나올 수 있다 (S3)
  assert.equal(/why: '계좌번호가 존재하지 않습니다\.'/.test(src), false, '증권사 원문을 화면 말로 썼다')
})

// ─────────────────────────────────────────────────────────────
// ⑤ 실행 상태
// ─────────────────────────────────────────────────────────────

test('실행 상태도 사람 말이다', () => {
  assert.equal(runStatusLabel('done'), '정상')
  assert.equal(runStatusLabel('failed'), '실패')
  assert.equal(runStatusLabel('skipped'), '건너뜀')
  assert.equal(runStatusLabel('running'), '도는 중')
  // 모르는 상태를 지어내지 않는다
  assert.equal(runStatusLabel('brand_new'), 'brand_new')
  assert.equal(runStatusTone('failed'), 'blocked')
  assert.equal(runStatusTone('done'), 'ok')
})

// ─────────────────────────────────────────────────────────────
// ⑥ 화면이 실제로 부른다 (배선)
// ─────────────────────────────────────────────────────────────

const RECENT_RUNS = join(WEB, 'app', '(trading)', 'trading', 'RecentRuns.tsx')

test('최근 실행 카드가 이 함수를 실제로 부른다', () => {
  const src = stripComments(readFileSync(RECENT_RUNS, 'utf-8'))
  assert.match(src, /\breadRunReason\s*\(/, '읽는 함수를 안 부르면 화면은 그대로 기계 말이다')
  assert.match(src, /\brunStatusLabel\s*\(/, '상태도 사람 말로 바꾼다')
})

test('최근 실행 카드가 기계 사유를 접지 않고 그대로 찍지 않는다', () => {
  const src = stripComments(readFileSync(RECENT_RUNS, 'utf-8'))
  // 원문은 접힌 자리(details) 안에서만 보인다
  assert.match(src, /<details/, '원문을 볼 길은 있어야 한다')
  const outsideDetails = src.slice(0, src.indexOf('<details'))
  assert.ok(
    !/\{\s*(?:run|view)\.(?:reason|raw)\s*\}/.test(outsideDetails),
    '접기 밖에서 원문을 그대로 찍고 있다',
  )
})

test('긴 글자가 카드를 가로로 터뜨리지 않는다', () => {
  const src = stripComments(readFileSync(RECENT_RUNS, 'utf-8'))
  // 사유 한 줄은 띄어쓰기가 없어 기본 줄바꿈 규칙으로는 안 꺾인다
  assert.match(src, /overflowWrap:\s*'anywhere'/, '원문 자리가 아무 데서나 꺾여야 한다')
  assert.match(src, /whiteSpace:\s*'pre-wrap'/, '원문 줄바꿈은 살리되 넘치지는 않게')
  assert.match(src, /minWidth:\s*0/, 'grid·flex 칸은 minWidth 0 이 없으면 안 줄어든다')
})


/* ── 사유를 만드는 쪽과 읽는 쪽이 같은 글자를 본다 ── */

/**
 * **가드가 손으로 적은 글자를 보면 안 된다.**
 *
 * 실측 2026-09-29: 번역 규칙은 `^fills_failed:kis:kis_([A-Z0-9]+)$` 였고 가드도 꼬리 없는
 * 글자를 넣어 초록이었다. 그런데 실제 사유에는 조회 이름이 붙어 `…:fills` 였고
 * (v0.10.683 이 붙였다), 화면에는 사흘 내내 `kis:kis_APAC0071:fills` 가 떴다.
 * 만들어 배포한 번역이 아무에게도 안 보인 채 꺼져 있었던 것이다.
 *
 * 그래서 이 가드는 **`readEnvelope` 이 실제로 만든 글자**를 그대로 읽힌다.
 */
test('★ 증권사가 만든 사유를 그대로 읽어도 번역된다 — 손으로 적은 글자가 아니라', () => {
  const failure = readEnvelope(
    { rt_cd: '7', msg_cd: 'APAC0071', msg1: '계좌번호가 존재하지 않습니다.' },
    200,
    'fills',
  )
  assert.ok(failure, '거절을 실패로 안 본다')
  // tick 이 사유를 적는 꼴 그대로 (`fills_failed:kis:` + readEnvelope 의 reason)
  const view = readRunReason(`fills_failed:kis:${failure.reason}|broker=failed`)
  const said = view.lines[0].text
  assert.match(said, /계좌번호가 없습니다/, `번역이 안 걸린다: ${said}`)
  assert.match(said, /증권사 자격증명/, '어디서 고치는지 안 말한다')
  assert.equal(/kis_|APAC/.test(said), false, `기계 글자가 샜다: ${said}`)
})

test('★ 500 뒤에 증권사 코드가 있으면 코드를 먼저 말한다', () => {
  const failure = readEnvelope(
    { rt_cd: '1', msg_cd: 'EGW00201', msg1: '초당 거래건수를 초과하였습니다.' },
    500,
    'minuteChart',
  )
  assert.ok(failure)
  const said = readRunReason(failure.reason).lines[0]
  // 「500」은 우리 쪽 잘못처럼 읽힌다. 실제 뜻은 속도 제한이고 할 일이 완전히 다르다
  assert.match(said.text, /너무 빨리/, `속도 제한을 안 말한다: ${said.text}`)
  assert.match(said.text, /분봉/, '어느 조회였는지 안 말한다')
  // 기다리면 풀리는 것을 사람이 손대야 하는 것으로 적지 않는다
  assert.equal(said.tone, 'waiting')
  assert.equal(/kis_|EGW|http_/.test(said.text), false, `기계 글자가 샜다: ${said.text}`)
})

test('★ 조회 이름이 없던 옛 사유도 그대로 읽힌다 — 쌓인 기록이 안 깨진다', () => {
  const said = readRunReason('fills_failed:kis:kis_APAC0071').lines[0].text
  assert.match(said, /계좌번호가 없습니다/)
  assert.match(readRunReason('http_503').lines[0].text, /503/)
})

// ── 월물 교체 ───────────────────────────────────────────

/**
 * 10-05 자정에 10월물에서 11월물로 갈아탔다. 그 사실은 기록에 안 남았고(I02 가 고쳤다),
 * 남았어도 화면은 `contract_roll=...` 를 그대로 찍었을 것이다.
 * 사람이 읽는 자리에서 **어디서 어디로 갔는지**가 나와야 「왜 차트가 어제와 안 이어지나」에 답한다
 */
test('★ 월물을 갈아탄 줄이 어디서 어디로 갔는지를 말한다', () => {
  const said = readRunReason('market_closed=before_open|contract_roll=next_volume_exceeded:A05610->A05611').lines
  const roll = said.find((l) => l.text.includes('A05611'))
  assert.ok(roll, `교체 줄을 못 읽는다: ${JSON.stringify(said)}`)
  assert.match(roll.text, /A05610/, '어디서 왔는지 안 말한다')
  assert.match(roll.text, /거래량/, '왜 갈아탔는지 안 말한다')
  assert.equal(/contract_roll|next_volume_exceeded/.test(roll.text), false, `기계 글자가 샜다: ${roll.text}`)
})

test('★ 얇은 채로 갈아탄 날은 다른 색으로 말한다 — 기다리면 풀리지만 알고는 있어야 한다', () => {
  const said = readRunReason('contract_roll=deadline_reached_while_thin:A05610->A05611').lines[0]
  assert.match(said.text, /최종거래일/, '왜 갈아탔는지 안 말한다')
  assert.match(said.text, /절반/, '차월물이 아직 얇다는 사실을 안 말한다')
  // 만기가 지나면 풀린다. 사람이 손대야 하는 것으로 적으면 blocked 색이 닳는다
  assert.equal(said.tone, 'waiting')
})

test('기한으로 갈아탔지만 얇지 않은 날은 조용하다 — 평범한 교체를 경고로 적지 않는다', () => {
  const said = readRunReason('contract_roll=deadline_reached:A05610->A05611').lines[0]
  assert.equal(said.tone, 'ok')
  assert.equal(/절반/.test(said.text), false, '얇지 않은데 얇다고 적는다')
})

test('★ 안 갈아탄 사유도 사람 말이 된다 — 「왜 그대로인가」도 답이 있어야 한다', () => {
  assert.match(readRunReason('contract_roll_no=front_still_heavier').lines[0].text, /근월물이 아직 무거워/)
  assert.match(readRunReason('contract_roll_no=weekend').lines[0].text, /주말/)
  assert.equal(readRunReason('contract_roll_no=unknown_volume').lines[0].tone, 'waiting')
  assert.equal(readRunReason('contract_roll_no=no_next').lines[0].tone, 'blocked')
})

/**
 * 신호 쪽 `roll=` 은 「만기 이월 중이라 신호를 안 냈다」는 전혀 다른 말이다.
 * 둘이 같은 규칙에 걸리면 월물을 갈아탄 줄이 신호 이야기로 읽힌다
 */
test('★ 신호 쪽 roll= 과 교체 쪽 contract_roll= 이 다른 말로 읽힌다', () => {
  const signal = readRunReason('roll=rolled_today').lines[0].text
  const contract = readRunReason('contract_roll=deadline_reached:A05610->A05611').lines[0].text
  assert.match(signal, /신호/, `신호 쪽 말이 바뀌었다: ${signal}`)
  assert.notEqual(signal, contract)
  assert.equal(/신호/.test(contract), false, `교체 줄이 신호 이야기로 읽힌다: ${contract}`)
})
