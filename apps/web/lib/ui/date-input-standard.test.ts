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
import { walkFiles, read } from './component-scan.ts'

const SSOT = 'components/ui/DateField.tsx'

function rawDateInputs(): string[] {
  const hits: string[] = []
  for (const file of [...walkFiles('app', ['.tsx']), ...walkFiles('components', ['.tsx'])]) {
    if (file === SSOT) continue // 부품 자신은 raw input을 쓴다 — 그게 이 부품의 일이다
    if (/type=["']date["']/.test(read(file))) hits.push(file)
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

test('오늘·오늘+N은 KST SSOT를 거친다 — UTC 절단으로 하루가 밀리지 않는다', async () => {
  const { today, todayPlus } = await import("./date-range.ts")
  const { kstTodayKey, addKstDays } = await import('../datetime/kst.ts')

  assert.equal(today(), kstTodayKey())
  assert.equal(todayPlus(30), addKstDays(kstTodayKey(), 30))
  // KST 09시 이전에 toISOString().slice(0,10)을 쓰면 어제가 나온다 — 그 경로를 안 쓴다는 확인
  assert.match(today(), /^\d{4}-\d{2}-\d{2}$/)
})
