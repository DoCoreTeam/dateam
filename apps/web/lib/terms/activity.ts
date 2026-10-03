/**
 * 활동의 말 — SSOT (용어집 §03)
 *
 * **왜 여기인가**: 활동 종류의 이름이 `components/ui/crm/Timeline.tsx` 안에 **두 벌**
 * 있었다(그리는 표 하나, 고르는 목록 하나). 그 화면은 딜·회사·인물 상세 안쪽에만 있었고,
 * 활동을 목록으로 보는 화면이 생기면서 세 벌이 될 자리였다. 같은 종류를 한쪽에서만
 * 고치면 「통화」가 어떤 화면에서는 「전화」가 되는 날이 온다.
 *
 * **종류를 사람이 늘리지 않는다.** 서비스의 `ActivityType` 과 한 벌로 묶여 있고,
 * 늘리려면 저장되는 값(`crm_activity.type`)이 먼저 있어야 한다.
 */

/** 활동 종류 다섯. 저장값과 같은 글자다 */
export type ActivityTypeKey = 'NOTE' | 'CALL' | 'MEETING' | 'EMAIL' | 'SYSTEM'

export const ACTIVITY_TYPE_LABEL: Record<ActivityTypeKey, string> = {
  NOTE: '노트',
  CALL: '통화',
  MEETING: '미팅',
  EMAIL: '메일',
  SYSTEM: '시스템',
}

/**
 * 고르는 칸에 서는 순서 — **사람이 남기는 것부터**.
 *
 * 시스템이 맨 뒤다. 사람이 「누가 몇 번 접촉했나」를 물을 때 시스템 기록은 답이 아니다.
 */
export const ACTIVITY_TYPE_ORDER: readonly ActivityTypeKey[] = ['NOTE', 'CALL', 'MEETING', 'EMAIL', 'SYSTEM']

/** 사람이 직접 남길 수 있는 종류. 메일과 시스템은 연동·시스템이 만든다 */
export const ACTIVITY_MANUAL_TYPES: readonly ActivityTypeKey[] = ['NOTE', 'CALL', 'MEETING']

/**
 * **사람이 한 접촉**으로 세는 종류. 시스템만 뺀다.
 *
 * 직접 남길 수 있는 종류(`ACTIVITY_MANUAL_TYPES`)와 **다르다** — 메일은 연동이 가져오지만
 * 그 편지를 보낸 것은 사람이고, 접촉이 있었다는 사실은 그대로 참이다. 시스템이 남긴
 * 것(태스크 완료·상태 변경)은 아무도 상대를 만나지 않은 기록이라 뺀다.
 *
 * **지표와 목록이 같은 이 목록을 쓴다.** 두 곳에 따로 적으면 리포트 카드가 398 인데
 * 그 카드에서 열린 목록이 421 을 보여 주고, 사람은 어느 쪽을 믿어야 할지 모른다
 * (실측 2026-10-04 실브라우저에서 그 어긋남을 잡았다).
 */
export const ACTIVITY_HUMAN_TYPES: readonly ActivityTypeKey[] = ['NOTE', 'CALL', 'MEETING', 'EMAIL']

/** 그 조건이 걸려 있다고 목록이 말하는 줄 */
export const ACTIVITY_HUMAN_ONLY = '사람이 남긴 것만'

/**
 * 어디에 붙은 기록인지 말하는 자리.
 *
 * **「없음」이라고만 쓰지 않는다.** 활동은 회사·인물·딜 중 하나에 붙어야 만들어지므로
 * 붙은 데가 없는 줄은 **그 대상이 지워진** 것이다. 「없음」은 안 채운 것으로 읽히고,
 * 지워진 것과 안 채운 것은 사람이 해야 할 일이 다르다.
 */
export const ACTIVITY_NO_ANCHOR = '붙은 대상이 지워졌어요'

/**
 * 거르는 칸의 이름 둘.
 *
 * **「담당자」라고 쓰지 않는다.** 활동을 남긴 사람과 딜의 담당자는 다른 사람일 수 있다
 * (영업이 만든 딜에 지원 인력이 통화 기록을 남긴다). 「담당자」로 적으면 딜 담당자로
 * 거르는 줄 알고 그 숫자를 담당자별 실적으로 읽는다.
 *
 * 기간 칸의 이름은 용어집의 `REPORT.period` 를 그대로 쓴다 — 리포트와 같은 말이다.
 */
export const ACTIVITY_AUTHOR = '남긴 사람'
export const ACTIVITY_TYPE_FIELD = '종류'

/**
 * 이어 읽는 단추.
 *
 * 타임라인이 이미 「이전 기록 더 보기」를 쓴다. 목록은 조건으로 거른 결과를 이어 읽는
 * 자리라 「이전」이 아니라 그냥 더 받는 것이므로 짧은 쪽을 쓰고, 두 자리가 같은
 * 뒷말(「더 보기」)을 쓰게 맞춘다.
 */
export const ACTIVITY_MORE = '더 보기'

/**
 * 활동으로 세는 지표 둘의 이름.
 *
 * **둘로 가르는 이유**: 「활동」에는 시스템이 남긴 사실이 섞여 있다(실측 2026-10-02:
 * 421건 중 23건이 SYSTEM). 그것까지 세어 「이번 달 접촉 421건」이라고 말하면 사람이
 * 한 일보다 많은 숫자가 되고, 그 숫자로 담당자를 견주면 틀린 평가가 된다.
 *
 * **여기서는 「접촉」을 쓴다.** 개체 이름으로는 안 쓰기로 한 말인데(위 `activity` 주석)
 * 지표 이름으로는 맞다. 개체는 시스템 기록까지 포함해야 하고, 이 지표는 **사람이
 * 손으로 남긴 것만** 세는 것이라 정확히 접촉이다.
 */
export const ACTIVITY_METRIC = {
  all: '활동 건수',
  contact: '접촉 건수',
} as const

export const ACTIVITY_METRIC_HINT = {
  all: '시스템이 남긴 것까지 모두 셉니다. 기록이 얼마나 쌓이는지를 봅니다',
  contact: '사람이 손으로 남긴 것만 셉니다(노트·통화·미팅·메일). 누가 몇 번 접촉했는지를 봅니다',
} as const

/**
 * 숫자에서 목록으로 가는 길의 이름.
 *
 * 「자세히」라고 쓰지 않는다 — 어디로 가는지 안 밝히면 누르기 전에 무슨 일이 날지 모른다.
 */
export const ACTIVITY_LIST_LINK = '활동 목록으로 보기'

/** 리포트 카드 묶음의 한 줄 설명. 딜 묶음 셋과 다른 것을 센다는 사실을 말한다 */
export const ACTIVITY_GROUP_HINT = '사람이 남긴 기록 · 시스템이 남긴 사실'

/** 활동을 쪼개는 두 축의 이름 */
export const ACTIVITY_AXIS = {
  type: '종류',
  author: '남긴 사람',
} as const

/** 시스템이 남긴 기록임을 밝히는 줄. 사람이 쓴 말과 섞이지 않게 */
export const ACTIVITY_SYSTEM_NOTE = '시스템이 남긴 기록입니다'
