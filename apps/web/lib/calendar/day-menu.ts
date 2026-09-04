/**
 * 「우클릭하면 나오는 것」 — SSOT
 *
 * 사용자 지시(2026-09-02): *"캘린더 칸에서는 우측 버튼이 우리 위주로, 수정이 없으면
 * 수정이 있어야지, 휴대폰 태블릿은 길게 누르는게 있어, **달력은 다 동일한 동작이라면 동일하게**"*.
 *
 * **왜 별도 파일인가**: 달력이 네 곳이다(캘린더 · 홈 · 회의노트 · 어드민 모니터링).
 * 각 화면이 자기 메뉴를 적으면 그 순간 네 벌이 되고, 하나를 고치면 셋이 남는다.
 * 그래서 **항목은 여기서만 만든다** — 화면은 실행 방법만 안다.
 *
 * **날짜 칸의 항목은 `day-actions.ts` 를 그대로 읽는다.** 거기가 이미 "이 날 할 수 있는 것"의
 * SSOT 이고, 작업대(`DayWorkbench`)가 그것을 그린다. 메뉴가 목록을 새로 적으면
 * **같은 날짜인데 작업대와 메뉴가 서로 다른 말을 하게 된다.**
 *
 * **말은 용어집이 정한다**(`lib/terms`). 여기서 한글 라벨을 새로 짓지 않는다.
 */

import { ACTION, ENTITY, SURFACE_LABEL, createLabel } from '../terms/index.ts'
import { dayActions, dayPosition } from './day-actions.ts'

/** 눌렀을 때 실제로 무엇이 일어나는가 — 화면이 분기할 유일한 축 */
export type CalMenuRun =
  /** 그 날의 상세를 연다(가운데 모달) */
  | { kind: 'openDay'; dateKey: string }
  /** 다른 화면으로 간다 */
  | { kind: 'link'; href: string }
  /** 미팅을 만들고 작업대로 간다 */
  | { kind: 'meeting'; dateKey: string }
  /** 이 자리에서 일정 폼을 연다 — 화면 전환 0회 */
  | { kind: 'newEvent'; dateKey: string }
  /** 이 자리에서 일정 폼을 **채워서** 연다 */
  | { kind: 'editEvent'; eventId: string }
  /** 되돌릴 수 없다 — 화면이 확인을 받는다 */
  | { kind: 'deleteEvent'; eventId: string; title: string }

/** 아이콘은 문자열 키로만 정한다 — 이 파일은 React 를 모른다(그래야 단위 테스트가 된다) */
export type CalMenuIcon =
  | 'open' | 'meeting' | 'event' | 'daily' | 'crmTask' | 'ci' | 'edit' | 'delete' | 'source'

export interface CalMenuItem {
  key: string
  label: string
  /** 어느 시스템의 일인가 — 누르기 전에 알아야 한다(day-actions 와 같은 뜻) */
  surfaceLabel?: string
  icon: CalMenuIcon
  /** 되돌릴 수 없는 것 — 화면이 빨갛게 그린다 */
  danger?: boolean
  /** 이 항목 위에 구분선 */
  separatorBefore?: boolean
  run: CalMenuRun
}

const WEEK_DAYS = ['일', '월', '화', '수', '목', '금', '토']

/**
 * 메뉴 맨 위 제목 — 무엇에 대한 메뉴인지. 「9월 11일 (금)」
 *
 * **naive 문자열을 `new Date()` 에 넣지 않는다**(§datetime 정합성). 여기서 필요한 것은
 * 절대시각이 아니라 **달력상의 요일**이므로, 숫자를 그대로 `Date.UTC` 에 넣어 계산한다 —
 * 실행 환경의 시간대에 따라 요일이 하루 밀리지 않는다.
 */
export function menuDateTitle(dateKey: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey)
  if (!m) return dateKey
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  return `${month}월 ${day}일 (${WEEK_DAYS[dow]})`
}

/** `day-actions` 의 종류 → 메뉴의 실행 종류. 두 축을 억지로 합치지 않고 여기서 옮긴다 */
const ACTION_ICON: Record<string, CalMenuIcon> = {
  meeting: 'meeting', event: 'event', daily: 'daily', crmTask: 'crmTask', ci: 'ci',
}

/**
 * 날짜 칸 우클릭 — 「이 날 열기」 + 그 날 시작할 수 있는 일 전부.
 *
 * 맨 위가 「이 날 열기」인 이유: 우클릭은 **빠른 시작**이지만, 읽으러 온 사람도 있다.
 * 좌클릭과 같은 곳으로 가는 길을 메뉴에도 두면 «어느 버튼이 그거였지»가 없어진다.
 */
export function dayCellMenu(dateKey: string, todayKey: string): CalMenuItem[] {
  const out: CalMenuItem[] = [
    {
      key: 'openDay',
      label: `이 날 ${ACTION.open}`,
      icon: 'open',
      run: { kind: 'openDay', dateKey },
    },
  ]

  dayActions(dateKey, todayKey).forEach((a, i) => {
    out.push({
      key: a.key,
      label: a.label,
      surfaceLabel: a.surfaceLabel,
      icon: ACTION_ICON[a.key] ?? 'open',
      separatorBefore: i === 0,
      run:
        a.kind === 'meeting' ? { kind: 'meeting', dateKey }
          : a.kind === 'inline' ? { kind: 'newEvent', dateKey }
            : { kind: 'link', href: a.href ?? '#' },
    })
  })
  return out
}

export interface EventMenuInput {
  /** 반복 일정은 화면에 전개된 가짜 id 를 쓴다 — **원본 행 id(`base_id`)를 넣을 것** */
  id: string
  title: string
  /** 업무·회의에서 자동 생성된 일정인가 */
  linkKind?: string | null
  linkId?: string | null
  /** 남의 일정은 읽기만 된다(RLS: 쓰기는 본인만) */
  isMine?: boolean
  /** 반복 일정인가 — 고치면 시리즈 전체가 바뀐다는 것을 화면이 알려야 한다 */
  recurring?: boolean
}

/**
 * 일정 칩 우클릭.
 *
 * **자동 생성 일정은 「수정」을 주지 않는다.** 일일업무·회의에서 만들어진 일정은
 * 원본이 진실이라, 여기서 제목을 고치면 원본과 어긋난 채 남는다(고칠 곳이 둘이 된다).
 * 대신 **원본으로 가는 길**을 준다.
 *
 * **남의 일정은 열기만.** 읽기는 조직 계층까지 열려 있고 쓰기는 본인만이다(RLS `cal_write`).
 * 못 하는 것을 메뉴에 띄우면 눌러 보고 나서야 안다(§2-5 (3)).
 */
export function eventChipMenu(ev: EventMenuInput, dateKey: string): CalMenuItem[] {
  const out: CalMenuItem[] = [
    { key: 'open', label: `이 날 ${ACTION.open}`, icon: 'open', run: { kind: 'openDay', dateKey } },
  ]

  if (ev.linkKind === 'daily' && ev.linkId) {
    out.push({
      key: 'source', label: '원본 업무 보기', surfaceLabel: SURFACE_LABEL.member, icon: 'source',
      separatorBefore: true, run: { kind: 'link', href: `/daily?date=${dateKey}` },
    })
  } else if (ev.linkKind === 'meeting' && ev.linkId) {
    out.push({
      key: 'source', label: '원본 미팅 보기', surfaceLabel: SURFACE_LABEL.crm, icon: 'source',
      separatorBefore: true, run: { kind: 'link', href: `/daily?meeting=${ev.linkId}` },
    })
  } else if (ev.isMine !== false) {
    out.push({
      key: 'edit', label: `${ENTITY.event.label} ${ACTION.edit}`, icon: 'edit',
      separatorBefore: true, run: { kind: 'editEvent', eventId: ev.id },
    })
  }

  if (ev.isMine !== false) {
    out.push({
      key: 'delete', label: `${ENTITY.event.label} ${ACTION.delete}`, icon: 'delete', danger: true,
      separatorBefore: out.length === 1,
      run: { kind: 'deleteEvent', eventId: ev.id, title: ev.title },
    })
  }
  return out
}

/**
 * 업무·메모 칩 우클릭.
 *
 * 여기서 지우기·고치기를 주지 않는 이유: 일일업무는 **원문 한 줄이 진실**이라
 * 칩만 보고 고치면 앞뒤 맥락 없이 바꾸게 된다. 그 날 화면으로 데려가는 것이 맞다.
 */
export function taskChipMenu(dateKey: string): CalMenuItem[] {
  return [
    { key: 'open', label: `이 날 ${ACTION.open}`, icon: 'open', run: { kind: 'openDay', dateKey } },
    {
      key: 'daily', label: `${ENTITY.dailyLog.label} ${ACTION.open}`,
      surfaceLabel: SURFACE_LABEL.member, icon: 'daily', separatorBefore: true,
      run: { kind: 'link', href: `/daily?date=${dateKey}` },
    },
  ]
}

/**
 * 회의노트 달력 — 날짜 칸.
 *
 * 이 화면에는 «그 날의 상세»가 없다(회의 목록이 전부다). 그래서 「이 날 열기」는
 * **캘린더의 그 날**로 보낸다 — 없는 화면을 있는 척하지 않는다.
 */
export function meetingDayMenu(dateKey: string, todayKey: string): CalMenuItem[] {
  const pos = dayPosition(dateKey, todayKey)
  return [
    {
      key: 'meeting', label: '미팅 기록', surfaceLabel: SURFACE_LABEL.crm, icon: 'meeting',
      run: { kind: 'meeting', dateKey },
    },
    {
      key: 'openDay', label: `캘린더에서 이 날 ${ACTION.open}`, surfaceLabel: SURFACE_LABEL.member,
      icon: 'open', separatorBefore: true,
      run: { kind: 'link', href: `/calendar?day=${dateKey}` },
    },
    {
      key: 'daily',
      label: pos === 'past' ? '일일업무 보기' : '일일업무 작성',
      surfaceLabel: SURFACE_LABEL.member, icon: 'daily',
      run: { kind: 'link', href: `/daily?date=${dateKey}` },
    },
  ]
}

/** 회의노트 달력 — 회의 칩 */
export function meetingChipMenu(meetingId: string, dateKey: string): CalMenuItem[] {
  return [
    {
      key: 'open', label: `${ENTITY.note.label} ${ACTION.open}`, icon: 'open',
      run: { kind: 'link', href: `/meeting-notes/${meetingId}` },
    },
    {
      key: 'openDay', label: `캘린더에서 이 날 ${ACTION.open}`, surfaceLabel: SURFACE_LABEL.member,
      icon: 'open', separatorBefore: true,
      run: { kind: 'link', href: `/calendar?day=${dateKey}` },
    },
  ]
}

/**
 * 어드민 일일업무 모니터링 달력.
 *
 * **여기 칸의 뜻이 다르다** — 그 날 «누가 몇 명 썼나»를 고르는 자리이지 내 일을 시작하는 곳이 아니다.
 * 그래서 항목이 다르다. 「동일하게」는 *같은 항목*이 아니라 **같은 방식으로 열린다**는 뜻이다 —
 * 없는 기능을 이름만 맞춰 넣으면 눌렀을 때 아무 일도 안 일어난다.
 */
export function monitorDayMenu(dateKey: string, selectHref: string): CalMenuItem[] {
  return [
    {
      key: 'select', label: `이 날 ${ACTION.open}`, icon: 'open',
      run: { kind: 'link', href: selectHref },
    },
    {
      key: 'calendar', label: `캘린더에서 이 날 ${ACTION.open}`, surfaceLabel: SURFACE_LABEL.member,
      icon: 'open', separatorBefore: true,
      run: { kind: 'link', href: `/calendar?day=${dateKey}` },
    },
  ]
}

/** 삭제 확인 문구 — 되돌릴 수 없으므로 무엇이 사라지는지 이름으로 밝힌다(§R-5) */
export function confirmDeleteEvent(title: string): string {
  const name = title.trim() || '(제목 없음)'
  return `${ENTITY.event.label}「${name}」을(를) ${ACTION.delete}할까요?\n되돌릴 수 없습니다.`
}

export { createLabel }
