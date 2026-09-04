/**
 * 캘린더 표면 계약 — **홈이 캘린더고, 날짜를 누르면 거기서 시작한다**
 *
 * 사용자 지시(2026-08-27): *"지금 홈화면에 캘린더를 메인으로 두자는 거야 ... 캘린더에
 * 날짜를 누르면 할 수 있는 모든 펑션이 나오는거고, CRM에 접속은 뭔가를 세부 확인하고 할때 하는거고
 * ... 화면전환이 많이 안일어나길 바래"* + *"CRM관련된건 CRM에서, 개인 업무는 업무관리, CI는 CI쪽으로"*.
 *
 * 잠그는 것 넷 —
 *   ① **하나의 보드**: 홈과 /calendar 가 같은 부품을 쓴다(둘로 갈리면 한쪽만 고쳐진다)
 *   ② **URL이 진실**: 보기·기준일·열린 날짜가 주소에 남는다(§2-6)
 *   ③ **그 날의 작업대**: 날짜를 누르면 시작할 수 있는 일이 전부 있고, 표면이 밝혀진다
 *   ④ **말**: 라벨은 용어집에서 온다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dayActions, dayPosition, SURFACE_ORDER } from './day-actions.ts'
import { SURFACE_LABEL, MEETING_CAPTURE_LABEL, ENTITY } from '../terms/index.ts'

const BOARD = readFileSync(new URL('../../app/(member)/calendar/CalendarBoard.tsx', import.meta.url), 'utf8')
const CAL_PAGE = readFileSync(new URL('../../app/(member)/calendar/page.tsx', import.meta.url), 'utf8')
const HOME = readFileSync(new URL('../../app/(member)/home/page.tsx', import.meta.url), 'utf8')
const PANEL = readFileSync(new URL('../../app/(member)/calendar/DayDetailPanel.tsx', import.meta.url), 'utf8')
const WORKBENCH = readFileSync(new URL('../../components/calendar/DayWorkbench.tsx', import.meta.url), 'utf8')
const TASKS = readFileSync(new URL('../../app/(crm)/crm/tasks/TasksClient.tsx', import.meta.url), 'utf8')
const TASKS_PAGE = readFileSync(new URL('../../app/(crm)/crm/tasks/page.tsx', import.meta.url), 'utf8')

const TODAY = '2026-08-27'

/* ── ① 하나의 보드 ─────────────────────────────────────── */

test('★ 홈과 /calendar 가 같은 보드를 쓴다 — 두 벌이면 한쪽만 고쳐진다', () => {
  assert.match(CAL_PAGE, /CalendarBoard/, '/calendar 가 보드를 안 쓴다')
  assert.match(HOME, /CalendarBoard/, '홈이 보드를 안 쓴다')
  assert.ok(!/calendar-month-grid/.test(HOME), '홈이 달력을 다시 그리고 있다')
})

test('★ 홈에서 캘린더가 맨 위다 — 아래에 있으면 「메인」이 아니다', () => {
  const calAt = HOME.indexOf('<CalendarBoard')
  // 렌더 위치로 본다 — import 줄을 세면 항상 파일 맨 위라 순서 검사가 무의미해진다
  const drawerAt = HOME.indexOf('<HomeDrawer')
  assert.ok(calAt > 0, '홈에 보드가 없다')
  assert.ok(drawerAt > 0, '홈에 오늘 서랍이 없다')
  assert.ok(calAt < drawerAt, '캘린더가 서랍 아래에 있다')
})

test('읽기 전용 미니 달력이 되살아나지 않는다 — 눌러도 아무 일이 없던 자리다', () => {
  assert.ok(!/HomeMiniCalendar/.test(HOME))
})

test('★ 보드는 Suspense 경계 안에 있다 — 없으면 next build 가 그 화면에서 통째로 실패한다', () => {
  for (const [name, src] of [['/calendar', CAL_PAGE], ['홈', HOME]] as const) {
    const at = src.indexOf('<CalendarBoard')
    assert.ok(src.lastIndexOf('<Suspense', at) > 0, `${name}: Suspense 경계가 없다`)
  }
  assert.match(TASKS_PAGE, /<Suspense/, '할 일 화면도 ?due= 를 읽는다 — 경계가 필요하다')
})

/* ── ② URL이 진실 ──────────────────────────────────────── */

test('★ 보기·기준일·열린 날짜가 주소에 남는다 — 새로고침하면 이번 달로 돌아가던 자리', () => {
  for (const key of ['"view"', '"date"', '"day"']) {
    assert.ok(BOARD.includes(`params.get(${key})`), `${key} 를 주소에서 안 읽는다`)
  }
  assert.match(BOARD, /router\.replace\(/, '주소를 안 고친다')
  assert.match(BOARD, /scroll: false/, '날짜를 누를 때마다 화면이 맨 위로 튄다')
})

test('★ 홈에서 누른 날짜가 /calendar 주소에 적히지 않는다 — 뒤로가기가 엉뚱한 곳으로 간다', () => {
  assert.match(BOARD, /basePath: string/, '보드가 자기 주소를 모른다')
  assert.match(HOME, /basePath="\/home"/, '홈이 자기 주소를 안 넘긴다')
  assert.match(CAL_PAGE, /basePath="\/calendar"/, '/calendar 가 자기 주소를 안 넘긴다')
})

test('로컬 state 로 되돌아가지 않는다 — 그게 링크를 못 보내던 원인이다', () => {
  assert.ok(!/useState<"month" \| "week">/.test(BOARD), '보기가 로컬 state 로 되돌아갔다')
  assert.ok(!/setSelectedDate\] = useState/.test(BOARD), '열린 날짜가 로컬 state 로 되돌아갔다')
})

/* ── ③ 그 날의 작업대 ──────────────────────────────────── */

test('★ 날짜를 누르면 작업대가 열린다 — 예전엔 「일정」과 「작성」 둘뿐이었다', () => {
  assert.match(PANEL, /<DayWorkbench/, '날짜 패널에 작업대가 없다')
  assert.match(PANEL, /onNewEvent=\{\(\) => setShowModal\(true\)\}/,
    '「새 일정」이 화면을 옮긴다 — 이 자리에서 열어야 전환이 0회다')
})

test('★ 미팅을 그 자리에서 시작한다 — CRM 메뉴를 찾아 들어가는 것이 문제였다', () => {
  const a = dayActions(TODAY, TODAY)
  const meeting = a.find((x) => x.key === 'meeting')
  assert.ok(meeting, '미팅 시작이 없다')
  assert.equal(meeting!.kind, 'meeting')
  assert.equal(meeting!.surface, 'crm')
  assert.match(WORKBENCH, /startMeeting\(\{ dateKey: date \}\)/,
    '누른 날짜를 안 넘긴다 — 지난 회의가 오늘 일어난 것으로 기록된다')
})

test('★ 어느 시스템의 일인지 밝힌다 — 모른 채 누르면 어디에 뭘 남겼는지 잃는다', () => {
  for (const a of dayActions(TODAY, TODAY)) {
    assert.ok(SURFACE_LABEL[a.surface], `${a.key}: 표면이 없다`)
    assert.equal(a.surfaceLabel, SURFACE_LABEL[a.surface], `${a.key}: 표면 말이 SSOT 와 다르다`)
  }
  assert.match(WORKBENCH, /\{a\.surfaceLabel\}/, '화면이 표면 배지를 안 그린다')
})

test('★ 지난 날짜에 「일일업무 작성」을 띄우지 않는다 — 오늘 것을 지난 날에 적게 된다', () => {
  const past = dayActions('2026-08-01', TODAY)
  const daily = past.find((x) => x.key === 'daily')
  assert.equal(daily?.label, '일일업무 보기')
  assert.ok(!past.some((x) => x.key === 'crmTask'), '지난 날짜에 새 할 일을 만들라고 한다')
  assert.equal(dayPosition('2026-08-01', TODAY), 'past')
  assert.equal(dayPosition('2026-09-01', TODAY), 'future')
})

test('★ 할 일 마감일이 그 날로 채워진다 — 안 채우면 오늘 마감으로 만들어진다', () => {
  const a = dayActions('2026-09-01', TODAY).find((x) => x.key === 'crmTask')
  assert.equal(a?.href, '/crm/tasks?due=2026-09-01')
  assert.match(TASKS, /useSearchParams\(\)\.get\('due'\)/, '할 일 화면이 그 날짜를 안 읽는다')
  assert.match(TASKS, /\\d\{4\}-\\d\{2\}-\\d\{2\}/, '주소로 들어온 값을 검사 없이 쓴다')
})

test('행동 키가 겹치지 않는다 — 겹치면 리액트가 목록을 잘못 그린다', () => {
  for (const day of ['2026-08-01', TODAY, '2026-09-01']) {
    const keys = dayActions(day, TODAY).map((a) => a.key)
    assert.equal(new Set(keys).size, keys.length, `${day}: 키가 겹친다`)
  }
})

test('세 표면이 모두 닿는다 — 하나라도 빠지면 그 시스템은 캘린더에서 시작할 수 없다', () => {
  const surfaces = new Set(dayActions(TODAY, TODAY).map((a) => a.surface))
  for (const s of SURFACE_ORDER) assert.ok(surfaces.has(s), `${s}: 캘린더에서 시작할 길이 없다`)
})

/* ── ④ 말 ──────────────────────────────────────────────── */

test('라벨을 화면에서 새로 짓지 않는다 — 같은 행위가 화면마다 다른 이름을 갖게 된다', () => {
  const a = dayActions(TODAY, TODAY)
  assert.equal(a.find((x) => x.key === 'meeting')?.label, MEETING_CAPTURE_LABEL)
  assert.equal(a.find((x) => x.key === 'event')?.label, `새 ${ENTITY.event.label}`)
  assert.equal(a.find((x) => x.key === 'crmTask')?.label, `새 ${ENTITY.task.label}`)
})

/* ── 일간·주간·월간 + 커스터마이즈 ─────────────────────── */

test('★ 보기 셋이 다 있다 — 사용자 지시: "일간 주간 월간 이렇게 볼 수 있어야"', () => {
  for (const id of ['"day"', '"week"', '"month"']) {
    assert.ok(BOARD.includes(`{ id: ${id}, label:`), `${id} 보기가 없다`)
  }
})

test('★ 어떤 보기를 쓰는지 기억한다 — "사용자가 커스터마이즈도 할 수 있게"', () => {
  assert.match(BOARD, /api\/ui-preferences/, '보기 설정을 저장하지 않는다')
  assert.match(BOARD, /VIEW_SCOPE_KEY = "calendar\.board"/, '저장 자리가 없다')
})

test('★ 날짜는 저장하지 않는다 — 다음 방문에 지난달이 열려 있으면 "왜 데이터가 없지"가 된다', () => {
  const save = BOARD.slice(BOARD.indexOf('const save = useCallback'), BOARD.indexOf('return [saved, save]'))
  assert.match(save, /value: \{ view: v \}/, '보기 말고 다른 것도 저장한다')
  assert.ok(!/date|day/.test(save.replace(/\/\/[^\n]*/g, '')), '날짜를 저장한다')
})

test('주소가 저장된 설정을 이긴다 — 공유 링크가 남의 설정에 덮이면 안 된다(§2-6(3))', () => {
  assert.match(BOARD, /viewParam === "week" \|\| viewParam === "day" \? viewParam : \(savedView \?\? "month"\)/,
    '우선순위가 주소 > 저장 > 기본값이 아니다')
})

test('★ 일간에서도 그 날의 작업대가 먼저다 — 「무엇이 있었나」보다 「이제 뭘 하지」다', () => {
  const dayBlock = BOARD.slice(BOARD.indexOf('{viewMode === "day" && ('))
  const wb = dayBlock.indexOf('<DayWorkbench')
  const agenda = dayBlock.indexOf('<DayAgenda')
  assert.ok(wb > 0 && agenda > wb, '작업대가 목록 아래에 있다')
})

test('일간의 「새 일정」은 그 자리에서 연다 — 화면 전환 0회', () => {
  /*
    「그 자리에서 연다」가 이 가드의 뜻이다. 예전에는 `setDayModal(true)` 였고
    지금은 `setEventForm({ date })` 가 같은 일을 한다 — 둘 다 **화면을 안 옮기고**
    같은 화면에 모달을 띄운다(CalendarBoard 의 `{eventForm && <EventModal …>}`).
    구현 이름이 아니라 «이동이 없다»를 본다: 새 일정은 상태로 열려야 하고,
    `router.push`·`<Link` 로 다른 주소에 보내면 안 된다.
  */
  assert.match(BOARD, /onNewEvent=\{\(\) => setEventForm\(\{ date: dayStr \}\)\}/,
    '새 일정을 상태로 열지 않는다 — 다른 화면으로 보내면 그 자리에서 여는 게 아니다')
  assert.doesNotMatch(BOARD, /onNewEvent=\{\(\) => router\.push/, '다른 화면으로 보낸다')
  assert.match(BOARD, /startsWith\("\/api\/calendar\/events"\)/,
    '저장하고 나서 다시 안 읽는다 — 방금 만든 일정이 안 보인다')
})

test('월간에서 누른 날짜가 일간으로 그대로 이어진다', () => {
  assert.match(BOARD, /const dayStr = selectedDate \?\? toDateStr\(anchor\)/,
    '보기를 바꾸면 다른 날이 열린다')
})

test('★ 아직 안 온 것을 「없다」고 말하지 않는다 — 실화면에서 잡힌 결함(v0.7.614)', () => {
  const agenda = BOARD.slice(BOARD.indexOf('function DayAgenda'))
  const loadingAt = agenda.indexOf('if (evLoading || logLoading) return <SkelList />')
  // 렌더 위치로 본다 — 주석에도 같은 문구가 있어 그냥 찾으면 주석을 코드로 오인한다
  const emptyAt = agenda.indexOf('title="이 날은 아직 비어 있어요"')
  assert.ok(loadingAt > 0, '로딩 상태를 안 그린다 — 빈 상태를 먼저 보여 준다')
  assert.ok(loadingAt < emptyAt, '빈 상태 판정이 로딩 판정보다 먼저다')
})

/* ── ⑤ 첫 화면의 자리 — 위가 비면 아래가 안 보인다 ───────────────
 *
 * 사용자 지적(2026-08-27): *"여기 메인데 이미 화면 3분의 1이 쓸모없는 공간이네?
 * 그리고 부서업무나 주간업무나 일부만 보이게 해서 바로 누를 수 있게 한다고 했던거 같은데"*.
 *
 * 실측(v0.7.617 · 뷰포트 819px) — 고치기 전:
 *   그리드 시작 y334(화면의 40.8%) · 「2026년 8월」이 y184·y277 **두 번** ·
 *   부서업무 y848(뷰포트 밖) · 주간보고 y1376.
 * 고친 뒤: 그리드 y248 · 월 이름 한 번 · 위젯 줄 y705(부서업무·오늘업무·주간보고 제목 전부 화면 안).
 */

test('★ 기간 이름을 두 번 적지 않는다 — 제목과 네비 줄이 같은 글자였다', () => {
  assert.ok(!/calendar-period-label/.test(BOARD),
    '제목 아래 네비 줄이 되살아났다 — 이전/다음은 제목을 바꾸는 조작이라 제목 옆(titleAfter)이 제자리다')
  assert.match(BOARD, /titleAfter=\{periodNav\}/, '기간 이동이 제목 옆에 없다')
})

test('★ 한 칸이 담는 칩에 상한이 있다 — 회의가 몰린 날 그 행이 통째로 자랐다', () => {
  assert.match(BOARD, /const cellChipLimit = compact \? \d+ : \d+/, '칩 상한이 없다')
  assert.ok(!/\{dayEvents\?\.map\(/.test(BOARD),
    '일정 칩을 상한 없이 전부 그린다 — 달력이 화면을 다 먹는다(실측 8/24 칩 5개·행 145px)')
  assert.match(BOARD, /shownEvents\.map\(/, '상한이 걸린 목록을 안 쓴다')
})

test('★ 넘친 것은 버리지 않고 「+N건 더」에 합산한다 — 날짜를 누르면 전부 나온다', () => {
  assert.match(BOARD, /hiddenEventCount/, '못 그린 일정이 어디에도 안 세어진다')
  const more = BOARD.slice(BOARD.indexOf('const moreCount'), BOARD.indexOf('const moreCount') + 200)
  assert.match(more, /hiddenEventCount/, '「+N건 더」가 못 그린 일정을 빠뜨린다 — 사용자는 그 일정이 사라진 줄 안다')
})

/*
 * v0.7.624 부터 위젯 넷은 **한 줄이 아니라 한 장**이다(«오늘 서랍»).
 *
 * 한 줄로 세웠더니 넷의 높이가 제각각이었다 —
 * 실측(v0.7.617 · 뷰포트 819px) 부서 609 · 오늘 283 · 메모 245 · 주간보고 206, **최대/최소 2.96배**.
 * 넷이 동시에 다 보일 필요가 없다. 한 번에 하나만 보이면 높이가 하나로 정해진다.
 */
test('★ 홈의 위젯 넷은 «오늘 서랍» 한 장 안에 있다 — 나란히 세우면 높이가 제각각이 된다', () => {
  assert.ok(!/home-section-dept/.test(HOME),
    '부서업무가 다시 자기 줄을 통째로 쓴다 — 그러면 주간보고가 첫 화면 밖으로 밀린다(실측 y1376)')
  assert.ok(!/home-section-widgets/.test(HOME),
    '위젯이 다시 한 줄로 늘어섰다 — 넷의 바닥이 어긋나 화면이 어수선해진다')
  const drawerAt = HOME.indexOf('<HomeDrawer')
  assert.ok(drawerAt > 0, '오늘 서랍이 없다')
  for (const w of ['HomeDeptTaskWidget', 'HomeQuickEntry', 'UnreviewedMemoWidget', '주간보고']) {
    assert.ok(HOME.indexOf(w, drawerAt) > drawerAt, `${w} 가 서랍 밖에 있다`)
  }
})

test('★ 서랍 배지는 서버가 센다 — 클라이언트가 세면 접힌 탭이 「볼 것 없음」으로 읽힌다', () => {
  for (const v of ['deptOverdue', 'unreadMemos', 'todayOpen']) {
    assert.ok(HOME.includes(v), `${v} 를 서버에서 세지 않는다`)
  }
  // 뜻이 넷 다 같아야 한다 — 「아직 손대지 않은 것」. 그리고 그 뜻이 화면에 적혀 있어야 한다
  assert.ok(HOME.includes('badgeTitle'), '배지에 뜻이 안 붙었다 — 사용자가 「1 2 6이 뭐야」를 묻게 된다')
})

test('★ 홈 인사말은 compact — 가장 안 눌리는 자리가 가장 컸다', () => {
  const head = HOME.slice(HOME.indexOf('home-section-header'), HOME.indexOf('home-section-calendar'))
  assert.match(head, /page-header--compact/, '인사말이 다시 두 줄 밀도로 돌아갔다(실측 84px)')
})

/* ── ⑥ 「보기 기억」이 실제로 저장되는 자리에 간다 ─────────────────
 *
 * v0.7.613 이 일간/주간/월간 선택을 기억하겠다고 했지만 **한 번도 저장된 적이 없었다**
 * (실측 v0.7.617 콘솔: GET·POST 둘 다 400). 원인이 둘이었다 —
 *   ① ui-preferences 가 슬래시로 시작하는 라우트 경로만 받았는데 보드의 키는 `calendar.board` 다
 *      (홈과 /calendar 가 한 부품을 쓰므로 라우트를 키로 쓸 수 없다)
 *   ② 값 sanitizer 가 목록 전용이라 허용값이 table·card·compact 뿐 — month·week·day 를 통째로 버렸다
 * 클라이언트가 실패를 조용히 삼켜(.catch(() => {})) 아무도 몰랐다.
 */

const PREF_ROUTE = readFileSync(new URL('../../app/api/ui-preferences/route.ts', import.meta.url), 'utf8')

test('★ 보드의 저장 키를 ui-preferences 가 받아 준다 — 400 이면 「보기 기억」은 죽은 기능이다', () => {
  const key = BOARD.match(/const VIEW_SCOPE_KEY = "([^"]+)"/)?.[1]
  assert.ok(key, '보드에 저장 키가 없다')
  const route = /^\/[\w\-/[\]().]{0,120}$/
  const ns = /^[a-z][a-z0-9]*(\.[a-z0-9]+){1,3}$/
  assert.ok(route.test(key!) || ns.test(key!), `키 "${key}" 를 서버가 400 으로 튕긴다`)
  assert.match(PREF_ROUTE, /\^\[a-z\]\[a-z0-9\]\*\(\\\.\[a-z0-9\]\+\)\{1,3\}\$/,
    '서버가 점 네임스페이스를 다시 막았다 — 목록이 아닌 표면은 보기를 저장할 곳이 없어진다')
})

test('★ 캘린더 보기 값이 sanitizer 를 통과한다 — 목록 허용값은 table·card·compact 뿐이다', () => {
  assert.match(PREF_ROUTE, /NON_LIST_VIEWS/, '목록 아닌 보기를 따로 통과시키는 자리가 없다')
  for (const v of ['month', 'week', 'day']) {
    assert.ok(new RegExp(`'${v}'`).test(PREF_ROUTE.slice(PREF_ROUTE.indexOf('NON_LIST_VIEWS'), PREF_ROUTE.indexOf('NON_LIST_VIEWS') + 120)),
      `${v} 보기가 저장 중에 버려진다`)
  }
  assert.ok(!/value: sanitizeSavedPrefs\(value\)/.test(PREF_ROUTE),
    '저장이 목록 전용 sanitizer 로 되돌아갔다 — 캘린더 보기가 다시 빈 값으로 저장된다')
})
