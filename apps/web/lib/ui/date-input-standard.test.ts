// lib/ui/date-input-standard.test.ts — 날짜 입력 표준 가드
//
// 왜: raw `<input type="date">`는 연도 칸의 자릿수를 막지 않는다. 사용자가 날짜를 연속으로
//   타이핑하면 `202609`년이 그대로 유효한 값으로 받아들여지고, 저장되면 정렬·범위필터·
//   만료판정이 전부 어긋난다. (실측: 견적 유효기간 칸에서 6자리 연도 통과.
//   당시 판은 "브라우저 기본 동작이라 우리 코드 문제 아님"으로 넘겼지만,
//   브라우저가 안 막는다는 것은 우리가 막아야 한다는 뜻이다.)
//
//   화면마다 min/max를 손으로 붙이는 방식은 안 붙인 화면만 조용히 뚫린다 —
//   그래서 부품 한 벌(`components/ui/DateField`)로 모으고, 여기서 재유입을 막는다.
//
// 이 가드는 위반 0에서 잠갔다. PENDING이 없다 — 새로 생기면 그게 곧 위반이다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { walkFiles, read, stripComments } from './component-scan.ts'

const SSOT = 'components/ui/DateField.tsx'

function rawDateInputs(): string[] {
  const hits: string[] = []
  for (const file of [...walkFiles('app', ['.tsx']), ...walkFiles('components', ['.tsx'])]) {
    if (file === SSOT) continue // 부품 자신은 raw input을 쓴다 — 그게 이 부품의 일이다
    // **주석은 벗기고 센다.** 안 그러면 «raw <input type="date"> 를 쓰지 마라»고
    // 이유를 적은 주석까지 위반으로 잡혀, 왜 안 되는지 적을 수 없게 된다
    // (실제로 그렇게 잡혔다 — 다른 가드는 전부 stripComments 를 쓴다).
    if (/type=["']date["']/.test(stripComments(read(file)))) hits.push(file)
  }
  return hits
}

test('화면은 날짜 입력을 직접 짜지 않는다 — DateField를 쓴다', () => {
  assert.deepEqual(rawDateInputs(), [],
    'raw <input type="date">는 6자리 연도를 그대로 받는다. ' +
    "@/components/ui/DateField 를 쓰면 min/max와 범위검사가 함께 온다.")
})

test('DateField는 연도 범위를 잠근다 — 6자리 연도가 통과하지 못한다', async () => {
  const { isInRange, DATE_MIN, dateMax, today, todayPlus } = await import("./date-range.ts")

  const max = dateMax()
  // 사고 그 자체 — 연속 타이핑으로 들어오던 값
  assert.equal(isInRange('202609-08-17', DATE_MIN, max), false, '6자리 연도는 거부해야 한다')
  assert.equal(isInRange('0202-08-17', DATE_MIN, max), false, '하한 이전도 거부해야 한다')
  assert.equal(isInRange('2999-01-01', DATE_MIN, max), false, '상한 이후도 거부해야 한다')

  // 정상 경로
  assert.equal(isInRange('', DATE_MIN, max), true, '빈 값(미지정)은 허용한다')
  assert.equal(isInRange(today(), DATE_MIN, max), true, '오늘은 허용한다')
  assert.equal(isInRange(todayPlus(30), DATE_MIN, max), true, '30일 뒤는 허용한다')
  assert.equal(isInRange(DATE_MIN, DATE_MIN, max), true, '하한 경계는 포함한다')
  assert.equal(isInRange(max, DATE_MIN, max), true, '상한 경계는 포함한다')
})

// 아래 두 사고는 **서로 반대 방향**이라 한쪽만 막으면 다른 쪽이 열린다.
// 실제로 v0.7.542에서 ①이 나고, 그걸 막은 v0.7.547에서 ②가 났다. 둘을 같이 잠근다.
test('치는 중의 빈 값은 안 싣는다 — 이미 있던 날짜가 통째로 날아가면 안 된다(v0.7.542 사고)', async () => {
  const { shouldCommit, DATE_MIN, dateMax } = await import('./date-range.ts')
  const o = { min: DATE_MIN, max: dateMax() }

  // 연도를 이어 치는 동안: 값은 비었고 칸에는 해석 불가능한 입력이 남아 있다
  assert.equal(shouldCommit('', { ...o, deleting: false, badInput: true }), false)
})

test('지우는 중의 빈 값은 싣는다 — 마감 없음으로 되돌릴 길이 막히면 안 된다(v0.7.547 회귀)', async () => {
  const { shouldCommit, DATE_MIN, dateMax } = await import('./date-range.ts')
  const o = { min: DATE_MIN, max: dateMax() }

  // Backspace 는 세그먼트를 하나씩 지운다 — 지우는 도중에도 badInput 은 참이다.
  // 여기서 막으면 '전부 빈 상태'에 영영 도달하지 못한다.
  assert.equal(shouldCommit('', { ...o, deleting: true, badInput: true }), true)
  // 다 지워져 칸이 완전히 빈 뒤(badInput=false)도 당연히 통과한다
  assert.equal(shouldCommit('', { ...o, deleting: true, badInput: false }), true)
  // 달력 위젯의 '지우기'처럼 키 입력 없이 비는 경우도 통과한다
  assert.equal(shouldCommit('', { ...o, deleting: false, badInput: false }), true)
})

test('지우기 중이라도 범위 밖 값은 안 싣는다 — 예외가 구멍이 되면 안 된다', async () => {
  const { shouldCommit, DATE_MIN, dateMax } = await import('./date-range.ts')
  const o = { min: DATE_MIN, max: dateMax() }

  assert.equal(shouldCommit('202609-08-17', { ...o, deleting: true, badInput: false }), false)
  assert.equal(shouldCommit('2026-08-17', { ...o, deleting: true, badInput: false }), true)
})

test('오늘·오늘+N은 KST SSOT를 거친다 — UTC 절단으로 하루가 밀리지 않는다', async () => {
  const { today, todayPlus } = await import("./date-range.ts")
  const { kstTodayKey, addKstDays } = await import('../datetime/kst.ts')

  assert.equal(today(), kstTodayKey())
  assert.equal(todayPlus(30), addKstDays(kstTodayKey(), 30))
  // KST 09시 이전에 toISOString().slice(0,10)을 쓰면 어제가 나온다 — 그 경로를 안 쓴다는 확인
  assert.match(today(), /^\d{4}-\d{2}-\d{2}$/)
})
