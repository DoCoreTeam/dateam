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
  | 'cancel' | 'close' | 'confirm' | 'apply' | 'restore' | 'retry'

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
  /** 알림을 읽었다는 응답 */
  confirm: '확인',
  /** **AI 제안을 실제 값으로** 옮긴다 */
  apply: '반영',
  /** 삭제한 것을 되살린다 */
  restore: '되돌리기',
  /** 실패한 것을 한 번 더 */
  retry: '다시 시도',
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
  { bad: '지우기', good: ACTION.delete, why: '삭제 16곳 vs 지우기 5곳 — 코드 식별자도 전부 delete' },
  { bad: '삭제중', good: progress(ACTION.delete), why: '공백 없음. 표준은 `{동사} 중…`' },
  { bad: '작성중', good: progress('작성'), why: '공백 없음' },
  { bad: '저장중', good: progress(ACTION.save), why: '공백 없음' },
  { bad: '재시도', good: ACTION.retry, why: '한자어보다 우리말' },
  { bad: '영업기회', good: '딜', why: '구 화면(/deals) 잔재 — CRM 개체 이름은 딜' },
]
