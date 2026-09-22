/**
 * 행위의 말 — SSOT (용어집 §02)
 *
 * **왜 필요한가**: 같은 행위를 표면마다 다른 말로 부르고 있었다(실측 v0.7.597).
 *   · 데이터를 없애는 행위 — `(member)`·`admin`·`(crm)` 은 **삭제** 16곳, `(ci)` 는 **지우기** 5곳
 *   · 진행 표기 — `삭제 중…` 4곳 vs `삭제중` 2곳 (공백 유무)
 *   · 새로 만드는 행위 — `새 딜` 2 · `딜 만들기` 1 · `추가` 8
 *
 * 사용자는 `(ci)` 에서 「지우기」를 배우고 `(crm)` 에서 「삭제」를 만난다.
 * **같은 일인지 확신할 수 없으므로 손이 멈춘다.** 그런데 우리는 이걸 버그로 보지 않아
 * 영원히 안 고쳐진다 — 그래서 상수로 내리고 가드가 지킨다(§2-5 (2)).
 *
 * **화면에 한글 문자열을 직접 적지 않는다.** 여기 없는 말이 필요하면 여기에 먼저 추가한다.
 */

/** 행위 키 — 코드가 부르는 이름. 영문 식별자·API 동사와 같은 뜻으로 맞춘다 */
export type ActionKey =
  | 'save' | 'delete' | 'disconnect' | 'create' | 'edit' | 'change'
  | 'cancel' | 'close' | 'confirm' | 'apply' | 'restore' | 'retry' | 'clear' | 'open'
  | 'export'

export const ACTION: Record<ActionKey, string> = {
  /** 폼·모달의 확정 버튼. **언제나 「저장」**이다(§2-5 (4)) — 카드별 변형 금지 */
  save: '저장',
  /** 데이터를 없앤다. 되돌릴 수 없다는 뜻을 담는다 */
  delete: '삭제',
  /** 연동을 끊는다. **수집한 데이터는 안 사라진다** — 그래서 삭제가 아니다(§2-5 (2)) */
  disconnect: '연결 해제',
  /** 새로 만드는 **진입**. 실제 라벨은 `createLabel(entity)` 로 만든다 */
  create: '새',
  /** 기존 값을 고치는 **진입** */
  edit: '수정',
  /** **대상을 바꾼다**(연결 대상·키). 값을 고치는 '수정'과 구분한다 */
  change: '변경',
  /** 하던 일을 그만둔다 — 한 일이 없던 것이 된다 */
  cancel: '취소',
  /** 패널·시트를 닫는다 — **닫아도 한 일은 남는다.** 취소와 다르다 */
  close: '닫기',
  /**
   * **입력을 비우는 것** — 데이터를 없애는 「삭제」와 다르다.
   *
   * 검색어를 비우는 X 버튼에 「지우기」를 쓰면 금지어이기도 하고,
   * 무엇보다 **데이터가 사라지는 줄 알고 손이 멈춘다.**
   */
  clear: '비우기',
  /** 알림을 읽었다는 응답 */
  confirm: '확인',
  /** **AI 제안을 실제 값으로** 옮긴다 */
  apply: '반영',
  /** 삭제한 것을 되살린다 */
  restore: '되돌리기',
  /** 실패한 것을 한 번 더 */
  retry: '다시 시도',
  /**
   * **이미 있는 것을 펼쳐 본다.** 「보기」와 뜻이 겹쳐 보이지만 자리가 다르다 —
   * 「보기」는 목록/상세의 **전환**(주간 보기·일간 보기)이고, 「열기」는 **대상 하나**를 여는 것이다.
   * 우클릭 메뉴가 이 말을 쓴다(`lib/calendar/day-menu.ts`).
   */
  open: '열기',
  /**
   * 「내보내기」 — 화면 밖으로 파일을 만들어 내는 것.
   * ~~다운로드~~·~~저장~~ 을 쓰지 않는다: 「저장」은 이 시스템 안에 남기는 것이고(§0-2),
   * 「다운로드」는 받는 쪽 동작이라 무엇이 만들어지는지 안 밝힌다.
   */
  export: '내보내기',
}

/**
 * 진행 중 표기 — **한 가지 모양만 쓴다.**
 *
 * 표준은 `{동사} 중…` 이다. 공백과 말줄임표가 둘 다 있어야 한다.
 * 실측으로 `삭제중`(공백 없음) 2곳, `작성중` 3곳이 있었다 — 복붙이 오탈자까지 복제한 결과다.
 */
export function progress(verb: string): string {
  return `${verb} 중…`
}

/**
 * 이미 저장된 칸의 단추는 **「저장」이라고 하지 않는다.**
 *
 * 사용자 지적 2026-09-20: *"방금 상호 넣고 저장 눌렀으면 저장이라는 버튼이 아니라
 * 수정이 되던가 해야지"*
 *
 * 단추가 늘 「저장」이면 두 가지를 못 말한다 — **눌렀던 것이 먹었는지**와
 * **지금 누르면 무슨 일이 일어나는지**. 누른 뒤에도 글자가 그대로라 사람은
 * 안 먹었다고 읽고 다시 누른다.
 *
 * 그래서 칸의 상태가 곧 단추의 말이 된다:
 *   빈 칸        → 「저장」   (처음 넣는 것)
 *   고치는 중    → 「수정」   (있던 값을 바꾸는 것, 눌러야 먹는다)
 *   그대로       → 「저장됨」 (누를 것이 없다. 단추는 잠근다)
 */
export type SettingFieldState = 'empty' | 'dirty' | 'saved'

export function settingFieldState(hasSaved: boolean, changed: boolean): SettingFieldState {
  if (!hasSaved) return 'empty'
  return changed ? 'dirty' : 'saved'
}

export const SETTING_SAVE_LABEL: Record<SettingFieldState, string> = {
  empty: ACTION.save,
  dirty: ACTION.edit,
  saved: '저장됨',
}

/** 「저장됨」은 누를 것이 없다 — 잠근 단추가 «이미 됐다»를 말한다 */
export function settingSaveDisabled(state: SettingFieldState): boolean {
  return state === 'saved'
}

/**
 * 저장된 값이 고를 수 있는 목록에 없을 때 화면이 하는 말.
 *
 * ## 왜 필요한가 (실측 2026-09-20 ~ 09-22)
 *
 * `ai.model.extract` 에 `global-model` 이 들어앉았을 때, 드롭다운은 그 값에 맞는 항목이 없으니
 * **첫 항목을 그렸다.** 화면은 「자동 (지금은 Gemini)」라고 말했고 기능은 죽어 있었다.
 * 값이 이상하다는 사실을 화면이 숨기면, 고칠 사람이 고칠 자리를 못 찾는다.
 */
export function settingUnknownValue(value: string): string {
  return `지금 저장된 값(${value})은 고를 수 있는 목록에 없습니다. 아래에서 다시 골라 주세요.`
}

/** 목록에 없는 값을 드롭다운에 그대로 보여 줄 때 붙이는 꼬리표 */
export function settingUnknownOptionLabel(value: string): string {
  return `${value} (알 수 없는 값)`
}

/**
 * 새로 만드는 진입 라벨 — `새 딜` · `새 회사`.
 *
 * **「추가」를 쓰지 않는다.** 무엇을 추가하는지 안 밝히면 버튼만 보고는 알 수 없다(실측 8곳).
 * 미팅은 예외다 — `MEETING_CAPTURE_LABEL` 참조.
 */
export function createLabel(entityLabel: string): string {
  return `${ACTION.create} ${entityLabel}`
}

/**
 * 미팅만은 「새 미팅」이 아니라 **「미팅 기록」**이다.
 *
 * 만드는 행위가 아니라 **이미 일어나고 있는 일을 받아적는 행위**라 뜻이 다르다.
 * 현재 코드 4곳이 이미 이 말을 쓰고 있다.
 *
 * **예외는 이유와 함께 적는다** — 안 적으면 다음 사람이 "일관성 없다"며 `새 미팅`으로 바꾼다.
 */
export const MEETING_CAPTURE_LABEL = '미팅 기록'

/**
 * 쓰지 않는 말 → 대신 쓸 말.
 *
 * 가드(`lib/ui/glossary.test.ts`)가 이 표를 읽어 화면 코드를 스캔한다.
 * **여기 추가하면 그 순간부터 새 위반이 차단된다.**
 */
export const BANNED_TERMS: { readonly bad: string; readonly good: string; readonly why: string }[] = [
  { bad: '지우기', good: ACTION.delete, why: '삭제 16곳 vs 지우기 5곳: 코드 식별자도 전부 delete' },
  { bad: '삭제중', good: progress(ACTION.delete), why: '공백 없음. 표준은 `{동사} 중…`' },
  { bad: '작성중', good: progress('작성'), why: '공백 없음' },
  { bad: '저장중', good: progress(ACTION.save), why: '공백 없음' },
  { bad: '재시도', good: ACTION.retry, why: '한자어보다 우리말' },
  /**
   * 접근권한 화면이 처음에 「열기·막기」로 나갔다가 지적받았다(2026-09-21).
   * 이 시스템은 이미 `차단`·`차단됨` 을 쓴다 — `lib/gpu/confidence-gate.ts` 의 `block`,
   * `lib/vercel/normalize.ts` 의 `BLOCKED`, CRM 예산 카드의 `blocked`. 셋 다 `status: 'blocker'` 다.
   * 같은 뜻에 새 말을 지으면 사용자는 둘을 다른 일로 읽는다.
   */
  { bad: '막기', good: '차단', why: '이미 차단·차단됨을 쓴다(gpu 신뢰도 게이트·Vercel 배포 상태·CRM 예산)' },
  { bad: '영업기회', good: '딜', why: '구 화면(/deals) 잔재: CRM 개체 이름은 딜' },
  /*
    RFP 금지어 셋. 셋 다 **함수 이름이 화면으로 샌 것**이다.
    코드가 쓰는 말과 사람이 읽는 말은 다르고, 섞이면 화면이 개발 문서처럼 읽힌다.
  */
  { bad: '훑기', good: '수집', why: 'sweep 이라는 함수 이름이 화면에 샜다' },
  { bad: '어디를 뒤질까', good: '수집처', why: '개체 이름이 있는데 설명문으로 부르고 있었다' },
  { bad: '독소조항', good: '이상 조항', why: '단정이 세다. 확정과 의심을 함께 담는 말이어야 한다' },
]
