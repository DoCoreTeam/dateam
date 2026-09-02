import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { CALENDAR_SCOPE, calendarDayOr, calendarRangeOr, isRealDate } from './calendar-scope.ts'

/**
 * 달력 칸과 날짜 패널이 **같은 판정**으로 하루를 읽는지 잠근다.
 *
 * 사고(2026-09-02): 9/30 칸에는 부서업무 「시티큐브 용인」이 1건 떠 있는데
 * 날짜를 누르면 「이 날 기록이 없어요」가 떴다. 칸은 `/api/calendar/month`,
 * 패널은 `/api/daily/logs` 를 쓰는데 **후자만 개인 업무로 좁혀 읽고 있었다.**
 * 전수 6일이 같은 상태였고 그중 2일은 패널이 통째로 비었다.
 */

const APP_ROOT = fileURLToPath(new URL('../../', import.meta.url)) // apps/web/
const read = (rel: string) => readFileSync(APP_ROOT + rel, 'utf8')

const MONTH_ROUTE = 'app/api/calendar/month/route.ts'
const LOGS_ROUTE = 'app/api/daily/logs/route.ts'
const PANEL = 'app/(member)/calendar/DayDetailPanel.tsx'

test('하루 판정은 세 갈래를 모두 본다 — 마감일·기간 밴드를 빠뜨리면 칸에만 뜬다', () => {
  const or = calendarDayOr('2026-09-30')
  assert.match(or, /log_date\.eq\.2026-09-30/)
  assert.match(or, /target_date\.eq\.2026-09-30/)
  assert.match(or, /and\(target_date\.lte\.2026-09-30,target_end_date\.gte\.2026-09-30\)/)
})

test('범위 판정도 같은 세 갈래다 — 하루판과 달라지면 칸과 패널이 어긋난다', () => {
  const or = calendarRangeOr('2026-09-01', '2026-09-30')
  assert.match(or, /and\(log_date\.gte\.2026-09-01,log_date\.lte\.2026-09-30\)/)
  assert.match(or, /and\(target_date\.gte\.2026-09-01,target_date\.lte\.2026-09-30\)/)
  assert.match(or, /and\(target_date\.lte\.2026-09-30,target_end_date\.gte\.2026-09-01\)/)
})

test('형식이 아닌 날짜는 조용히 통과시키지 않는다 — 깨진 절이 전건 조회가 된다', () => {
  assert.throws(() => calendarDayOr('2026/09/30'))
  assert.throws(() => calendarRangeOr('2026-09-01', ''))
})

test('★ 칸과 패널이 같은 SSOT 를 쓴다 — 한쪽만 고쳐지던 것이 이 사고의 구조다', () => {
  for (const rel of [MONTH_ROUTE, LOGS_ROUTE]) {
    assert.match(
      read(rel),
      /from '@\/lib\/daily\/calendar-scope'/,
      `${rel} 가 캘린더 판정 SSOT 를 쓰지 않는다`,
    )
  }
})

test('★ 패널이 캘린더 판정으로 조회한다 — scope 가 빠지면 부서업무가 다시 사라진다', () => {
  const src = read(PANEL)
  assert.match(src, /\/api\/daily\/logs\?date=\$\{date\}&scope=\$\{CALENDAR_SCOPE\}/)
  assert.equal(CALENDAR_SCOPE, 'calendar')
})

test('★ 캘린더 판정은 task_kind 로 좁히지 않는다 — 부서업무 마감일이 달력의 쓸모다', () => {
  const src = read('lib/daily/calendar-scope.ts')
  const fn = src.slice(src.indexOf('export function applyCalendarScopeFilters'))
  assert.doesNotMatch(fn, /task_kind/, '캘린더 공통 필터가 task_kind 로 좁히면 안 된다')
})

test('★ 소프트삭제 필터는 조회 지점에 보인다 — 헬퍼에 숨기면 정적 가드가 못 본다', () => {
  const src = read('lib/daily/calendar-scope.ts')
  const fn = src.slice(src.indexOf('export function applyCalendarScopeFilters'))
  assert.doesNotMatch(fn, /\.is\('deleted_at'/, 'deleted_at 은 호출부에 남긴다')
  for (const rel of [MONTH_ROUTE, LOGS_ROUTE]) {
    assert.match(read(rel), /\.is\('deleted_at', null\)/, `${rel} 에 소프트삭제 필터가 없다`)
  }
})

test('★ 부서업무 행은 부서업무 화면으로 간다 — /daily 로 보내면 거기서 또 「없다」가 된다', () => {
  const src = read(PANEL)
  assert.match(src, /dept_task/, '패널이 부서업무를 구분하지 않는다')
  assert.match(src, /\/dept-tasks\?task=\$\{log\.id\}/, '부서업무 행의 이동 경로가 없다')
  assert.match(src, /부서업무<\/span>/, '어느 화면의 일인지 화면이 밝히지 않는다')
})

test('기본 조회는 예전 그대로다 — 일일 화면에 부서업무가 역류하면 안 된다', () => {
  const src = read(LOGS_ROUTE)
  assert.match(src, /\.eq\('task_kind', 'personal'\)/, '기본 갈래의 개인 업무 한정이 사라졌다')
})

test('★ 실재하지 않는 날짜를 통과시키지 않는다 — 형식만 보면 DB 에서 터져 500 이 된다 (지시 외 발견)', () => {
  assert.equal(isRealDate('2026-02-30'), false)
  assert.equal(isRealDate('2026-04-31'), false)
  assert.equal(isRealDate('2026-13-01'), false)
  assert.equal(isRealDate('2026-99-99'), false)
  assert.equal(isRealDate('2026-00-10'), false)
  assert.equal(isRealDate('2026-01-00'), false)
  // 실재하는 경계는 통과시킨다 — 과차단하면 정상 날짜를 못 연다
  assert.equal(isRealDate('2026-02-28'), true)
  assert.equal(isRealDate('2024-02-29'), true, '윤년 2/29 는 실재한다')
  assert.equal(isRealDate('2026-12-31'), true)
  assert.throws(() => calendarDayOr('2026-02-30'))
})

test('★ 라우트가 없는 날짜를 400 으로 답한다 — 「데이터 조회 실패」(500)는 사실이 아니다', () => {
  const src = read(LOGS_ROUTE)
  assert.match(src, /isRealDate\(date\)/, '라우트가 실재 날짜 검사를 하지 않는다')
  assert.doesNotMatch(
    src.slice(0, src.indexOf('const supabase')),
    /\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\//,
    '형식만 보는 옛 검사가 남아 있다',
  )
})
