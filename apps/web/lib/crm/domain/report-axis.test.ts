/**
 * 리포트 기간 축: **두 탭이 같은 어휘를 쓴다**
 *
 * 왜 생겼나 (실측 2026-10-02): 리포트 화면의 두 탭이 서로 다른 기간 어휘를 썼다.
 *   · 지표 탭: `domain/target.ts` 의 `PeriodKind` 넷 (연간·반기·분기·월간)
 *   · 현황 탭: 이 파일의 `PeriodKey` 넷: 이번 달·이번 분기·올해·최근 12개월
 * 겹치는 값이 **하나도 없었다.** 그래서 현황 탭은 반기를 몰랐고, 둘 다 **지난 기간을
 * 볼 길이 없었다.** 분기 보고에서 가장 먼저 묻는 것이 지난 분기인데 답할 자리가 없었다.
 *
 * 이제 달력 경계는 `target.ts` 한 곳이 세고, 이 파일은 거기에 「최근 12개월」과
 * 「앞뒤로 가는 길」만 더한다. 그 둘이 어긋나지 않는 것을 여기서 본다.
 *
 * 세 줄(분기·이번 달·최근 12개월)은 `services/business-report.test.ts` 에 있던 것을
 * 옮겨 온 것이다. 기간 경계는 집계 서비스가 아니라 축 모듈의 일이다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseReportPeriod,
  formatReportPeriod,
  reportPeriodRange,
  reportPeriodLabel,
  shiftReportPeriod,
  PERIOD_KIND_ORDER,
  ROLLING_12M,
  PERIOD_KIND_LABEL,
  periodIndexLabel,
  type ReportPeriod,
} from './report-axis.ts'
import { periodLabel, formatPeriodKey, type Period } from './target.ts'
import { periodUnitLabel } from '../../terms/report.ts'
import { timeBucketOf } from './metric-agg.ts'

const cal = (kind: 'YEAR' | 'HALF' | 'QUARTER' | 'MONTH', year: number, index?: number): ReportPeriod =>
  ({ rolling: false, period: { kind, year, ...(index === undefined ? {} : { index }) } })

// ------------------------------------------------------------
// 경계: 달력이 정한다
// ------------------------------------------------------------

test('기간 축: 분기는 달력 분기다', () => {
  assert.deepEqual(reportPeriodRange(cal('QUARTER', 2026, 3), '2026-08-28'),
    { from: '2026-07-01', to: '2026-09-30', label: '2026년 3분기' })
  assert.deepEqual(reportPeriodRange(cal('QUARTER', 2026, 1), '2026-01-15'),
    { from: '2026-01-01', to: '2026-03-31', label: '2026년 1분기' })
})

test('기간 축: 월은 말일까지, 윤년도 맞는다', () => {
  assert.deepEqual(reportPeriodRange(cal('MONTH', 2026, 2), '2026-02-10'),
    { from: '2026-02-01', to: '2026-02-28', label: '2026년 2월' })
  assert.deepEqual(reportPeriodRange(cal('MONTH', 2028, 2), '2028-02-10'),
    { from: '2028-02-01', to: '2028-02-29', label: '2028년 2월' })
})

test('기간 축: 최근 12개월은 해를 넘어간다', () => {
  assert.deepEqual(reportPeriodRange({ rolling: true }, '2026-08-28'),
    { from: '2025-09-01', to: '2026-08-31', label: '최근 12개월' })
})

test('기간 축: 반기가 있다, 상반기는 6월 30일에 끝나고 하반기는 7월 1일에 시작한다', () => {
  // 현황 탭에 없던 종류다. 「상반기 실적」을 물을 자리가 아예 없었다
  assert.deepEqual(reportPeriodRange(cal('HALF', 2026, 1), '2026-10-02'),
    { from: '2026-01-01', to: '2026-06-30', label: '2026년 상반기' })
  assert.deepEqual(reportPeriodRange(cal('HALF', 2026, 2), '2026-10-02'),
    { from: '2026-07-01', to: '2026-12-31', label: '2026년 하반기' })
})

test('기간 축: 연은 1월 1일부터 12월 31일까지다', () => {
  assert.deepEqual(reportPeriodRange(cal('YEAR', 2025), '2026-10-02'),
    { from: '2025-01-01', to: '2025-12-31', label: '2025년' })
})

test('기간 축: 지난 기간의 경계는 오늘과 무관하다', () => {
  /*
    **오늘을 안 본다.** 「이번 분기」만 있던 시절에는 범위가 오늘에 매여 있었고,
    그래서 지난 분기를 물을 방법이 없었다. 이제 기간이 스스로 경계를 안다.
  */
  const q2 = reportPeriodRange(cal('QUARTER', 2025, 2), '2026-10-02')
  assert.deepEqual(q2, { from: '2025-04-01', to: '2025-06-30', label: '2025년 2분기' })
  assert.deepEqual(reportPeriodRange(cal('QUARTER', 2025, 2), '2029-01-01'), q2,
    '오늘이 달라졌다고 지난 분기의 경계가 움직이면 어제 뽑은 보고와 숫자가 달라진다')
})

// ------------------------------------------------------------
// 앞뒤로 가는 길
// ------------------------------------------------------------

test('기간 이동: 해를 넘어가도 한 칸씩이다', () => {
  assert.deepEqual(shiftReportPeriod(cal('QUARTER', 2026, 1), -1), cal('QUARTER', 2025, 4))
  assert.deepEqual(shiftReportPeriod(cal('QUARTER', 2025, 4), 1), cal('QUARTER', 2026, 1))
  assert.deepEqual(shiftReportPeriod(cal('MONTH', 2026, 1), -1), cal('MONTH', 2025, 12))
  assert.deepEqual(shiftReportPeriod(cal('MONTH', 2026, 12), 1), cal('MONTH', 2027, 1))
  assert.deepEqual(shiftReportPeriod(cal('HALF', 2026, 1), -1), cal('HALF', 2025, 2))
  assert.deepEqual(shiftReportPeriod(cal('YEAR', 2026), -1), cal('YEAR', 2025))
})

test('기간 이동: 한 칸 갔다 돌아오면 제자리다', () => {
  for (const kind of PERIOD_KIND_ORDER) {
    const start = kind === 'YEAR' ? cal(kind, 2026) : cal(kind, 2026, 1)
    assert.deepEqual(shiftReportPeriod(shiftReportPeriod(start, -1), 1), start, `${kind} 가 제자리로 안 온다`)
  }
})

test('기간 이동: 최근 12개월은 안 움직인다', () => {
  // 굴러가는 기간의 「이전」은 뜻이 없다. 움직이면 사람은 그것을 달력 기간으로 읽는다
  assert.deepEqual(shiftReportPeriod({ rolling: true }, -1), { rolling: true })
})

// ------------------------------------------------------------
// 주소: 쓴 대로 되읽는다
// ------------------------------------------------------------

test('주소: 쓴 값을 그대로 되읽는다', () => {
  for (const p of [cal('YEAR', 2026), cal('HALF', 2026, 2), cal('QUARTER', 2025, 3), cal('MONTH', 2026, 11), { rolling: true } as ReportPeriod]) {
    assert.deepEqual(parseReportPeriod(formatReportPeriod(p), '2026-10-02'), p,
      `${formatReportPeriod(p)} 가 되읽히지 않는다. 링크를 보내면 받는 쪽이 다른 기간을 본다`)
  }
})

test('주소: 옛 주소가 안 깨진다', () => {
  /*
    보낸 링크와 북마크가 살아 있어야 한다. 지우면 어제 보낸 링크가 **조용히 다른 기간**을
    연다. 깨진 링크보다 나쁘다. 어제의 「이번 분기」는 오늘 열어도 오늘의 분기다.
  */
  assert.deepEqual(parseReportPeriod('THIS_YEAR', '2026-10-02'), cal('YEAR', 2026))
  assert.deepEqual(parseReportPeriod('THIS_QUARTER', '2026-10-02'), cal('QUARTER', 2026, 4))
  assert.deepEqual(parseReportPeriod('THIS_MONTH', '2026-10-02'), cal('MONTH', 2026, 10))
  assert.deepEqual(parseReportPeriod(ROLLING_12M, '2026-10-02'), { rolling: true })
})

test('주소: 모르는 값은 기본값이지 오류가 아니다', () => {
  // 주소를 손으로 고친 사람에게 500 을 주면 자기가 뭘 잘못했는지 영영 모른다
  for (const bad of ['', null, undefined, 'WEEK:2026:3', 'QUARTER:2026:9', 'QUARTER:abc:1', '../../etc']) {
    assert.deepEqual(parseReportPeriod(bad, '2026-10-02'), cal('YEAR', 2026), `${String(bad)} 가 기본값으로 안 간다`)
  }
})

test('이름: 사람이 읽는 말이 맨숫자가 아니다', () => {
  assert.equal(reportPeriodLabel(cal('HALF', 2026, 1)), '2026년 상반기')
  assert.equal(reportPeriodLabel(cal('HALF', 2026, 2)), '2026년 하반기')
  assert.equal(reportPeriodLabel(cal('QUARTER', 2026, 3)), '2026년 3분기')
  assert.equal(reportPeriodLabel({ rolling: true }), '최근 12개월')
})

test('★ 두 탭이 같은 기간을 같은 글자로 쓴다', () => {
  /*
    **같은 어휘를 쓴다는 것은 뜻이 같은 것이 아니라 글자가 같은 것이다.**

    실측 2026-10-03: 같은 2026년 3분기를 지표 탭(`target.periodLabel`)은 「2026 3분기」로,
    현황 탭(`reportPeriodLabel`)은 「2026년 3분기」로 적고 있었다. 뜻은 같고 글자가 달랐다.
    읽는 쪽은 두 탭의 숫자가 같은 기간의 것인지 알 길이 없고, 보고서에 옮겨 적는 사람은
    매번 다른 말로 바꿔 쓴다. 그래서 글자로 단정한다.

    교차표 머리(`metric-agg.timeBucketOf`)도 같은 글자를 쓴다. 표가 보고 있는 기간과
    표 머리가 다른 말을 하면 그 표는 자기가 무엇을 센 것인지 말하지 못한다.
  */
  const sameOnBothTabs: Period[] = [
    { kind: 'YEAR', year: 2026 },
    { kind: 'HALF', year: 2026, index: 1 },
    { kind: 'HALF', year: 2026, index: 2 },
    { kind: 'QUARTER', year: 2026, index: 3 },
    { kind: 'MONTH', year: 2026, index: 9 },
  ]
  for (const period of sameOnBothTabs) {
    assert.equal(reportPeriodLabel({ rolling: false, period }), periodLabel(period),
      `${formatPeriodKey(period)} 를 두 탭이 다른 글자로 적는다`)
  }

  assert.equal(timeBucketOf('2026-08-28', 'QUARTER').label, reportPeriodLabel(cal('QUARTER', 2026, 3)))
  assert.equal(timeBucketOf('2026-02-10', 'HALF').label, reportPeriodLabel(cal('HALF', 2026, 1)))
  assert.equal(timeBucketOf('2026-02-10', 'YEAR').label, reportPeriodLabel(cal('YEAR', 2026)))
})

test('★ 종류 이름과 칸 이름은 한 곳에서 온다', () => {
  /*
    실측 2026-10-03: 네 종류의 이름이 세 화면에 따로 적혀 있었고 두 글자가 갈렸다.
    `target.ts` 는 월을 「월」로, 지표 탭은 「월간」으로 불렀다. 순서 목록도 셋이었다.
  */
  assert.deepEqual([...PERIOD_KIND_ORDER], ['YEAR', 'HALF', 'QUARTER', 'MONTH'], '긴 것부터여야 한다')
  for (const k of PERIOD_KIND_ORDER) {
    assert.ok(PERIOD_KIND_LABEL[k].length > 0, `${k} 에 이름이 없으면 고르는 칸에 undefined 가 뜬다`)
  }
  // 칸 이름은 종류 이름과 다른 말이다. 「월간」 단위로 보지만 묻는 것은 「몇 월」이다
  assert.equal(periodUnitLabel('MONTH'), '월')
  assert.equal(PERIOD_KIND_LABEL.MONTH, '월간')
  assert.equal(periodUnitLabel('YEAR'), '', '연간은 고를 칸이 없다')
  // 반기 칸에 「1반기」가 뜨던 자리 (목표 모달)
  assert.equal(periodIndexLabel('HALF', 1), '상반기')
  assert.equal(periodIndexLabel('HALF', 2), '하반기')
  assert.equal(periodIndexLabel('QUARTER', 3), '3분기')
  assert.equal(periodIndexLabel('MONTH', 9), '9월')
})
