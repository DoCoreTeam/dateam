/**
 * 「이 날 할 수 있는 것」 — SSOT
 *
 * 사용자 지시(2026-08-27): *"캘린더에 날짜를 누르면 **할 수 있는 모든 펑션**이 나오는거고,
 * CRM에 접속은 뭔가를 세부 확인하고 할때 하는거고 ... **화면전환이 많이 안일어나길 바래**"*.
 *
 * 그래서 날짜 하나를 누르면 그 날 시작할 수 있는 일이 **전부** 거기 있어야 한다.
 * 메뉴를 찾아 들어가는 것은 화면 전환이고, 회의 직전에 그걸 하는 사람은 없다.
 *
 * **표면(업무·CRM·콘텐츠)을 라벨로 밝힌다.** 같은 지시의 다른 half —
 * *"CRM관련된건 CRM에서 진행되고, 개인 업무는 업무관리, CI는 CI쪽으로 일관성"*.
 * 어디로 가는 일인지 모른 채 누르면 사용자는 자기가 어느 시스템에 뭘 남겼는지 잃어버린다.
 *
 * **말은 용어집이 정한다**(`lib/terms`). 여기서 한글 라벨을 새로 짓지 않는다 —
 * 지으면 같은 행위가 화면마다 다른 이름을 갖게 된다.
 */

import {
  ACTION, ENTITY, MEETING_CAPTURE_LABEL, SURFACE_LABEL, createLabel,
  type SurfaceKey,
} from '../terms/index.ts'

/** 눌렀을 때 무엇이 일어나는가 — 화면이 분기할 유일한 축 */
export type DayActionKind =
  /** 다른 화면으로 간다 */
  | 'link'
  /** 이 자리에서 연다(일정 모달) — 화면 전환 0회 */
  | 'inline'
  /** 미팅을 만들고 작업대로 간다 */
  | 'meeting'

export interface DayAction {
  key: string
  label: string
  /** 어느 시스템의 일인가 — 화면이 표면 배지를 붙인다 */
  surface: SurfaceKey
  surfaceLabel: string
  kind: DayActionKind
  /** kind==='link' 일 때만 */
  href?: string
  /** 왜 지금 이게 여기 있나 — 과거 날짜에서 문구가 달라진다 */
  hint?: string
}

/** 오늘보다 앞인가·뒤인가 — 같은 버튼이라도 뜻이 달라진다 */
export type DayPosition = 'past' | 'today' | 'future'

export function dayPosition(dateKey: string, todayKey: string): DayPosition {
  if (dateKey === todayKey) return 'today'
  return dateKey < todayKey ? 'past' : 'future'
}

/**
 * 그 날 시작할 수 있는 일.
 *
 * **과거·오늘·미래가 다르다.** 지난 날짜에 「일일업무 작성」을 띄우면 사용자는
 * 오늘 것을 지난 날에 적는다 — 그게 기록을 조용히 어긋나게 만든다.
 */
export function dayActions(dateKey: string, todayKey: string): DayAction[] {
  const pos = dayPosition(dateKey, todayKey)
  const out: DayAction[] = []

  const push = (a: Omit<DayAction, 'surfaceLabel'>) =>
    out.push({ ...a, surfaceLabel: SURFACE_LABEL[a.surface] })

  // ── CRM: 미팅. 회의 직전에 여는 화면이라 맨 앞이다
  push({
    key: 'meeting',
    label: MEETING_CAPTURE_LABEL,
    surface: 'crm',
    kind: 'meeting',
    hint: pos === 'past' ? '그날 날짜로 만들어요' : undefined,
  })

  // ── 업무: 일정. **여기서 바로 연다** — 이 하나를 위해 캘린더를 떠나지 않는다
  push({
    key: 'event',
    label: createLabel(ENTITY.event.label),
    surface: 'member',
    kind: 'inline',
  })

  // ── 업무: 일일업무. 과거는 보기, 오늘·미래는 쓰기
  push({
    key: 'daily',
    label: pos === 'past' ? '일일업무 보기' : '일일업무 작성',
    surface: 'member',
    kind: 'link',
    href: `/daily?date=${dateKey}`,
  })

  // ── CRM: 할 일. 마감일을 그 날로 채워서 연다 — 안 채우면 오늘로 만들어진다
  if (pos !== 'past') {
    push({
      key: 'crmTask',
      label: createLabel(ENTITY.task.label),
      surface: 'crm',
      kind: 'link',
      href: `/crm/tasks?due=${dateKey}`,
    })
  }

  // ── 콘텐츠: 그 날의 발행·수집 상황
  push({
    key: 'ci',
    label: '콘텐츠 현황',
    surface: 'ci',
    kind: 'link',
    href: '/ci',
  })

  return out
}

/** 표면 순서 — 화면이 배지 색·정렬을 이 순서로 맞춘다 */
export const SURFACE_ORDER: SurfaceKey[] = ['crm', 'member', 'ci']

export { ACTION }
