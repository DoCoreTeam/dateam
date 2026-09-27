/**
 * 설정 도우미가 쓰는 말 — **화면 파일 안에 두지 않는다**
 *
 * 라벨 표가 화면에 있으면 같은 개념이 화면마다 다른 말이 된다
 * (`lib/ui/glossary.test.ts` 가 화면 안 라벨 표가 늘어나는 것을 막는다).
 */

export const ASSISTANT_TITLE = '말로 설정 바꾸기'

export const ASSISTANT_WHY =
  '무엇을 하고 싶은지 쓰면 바꿀 값을 찾아 보여 줍니다. 확인하고 누르기 전에는 아무것도 안 바뀝니다'

export const ASSISTANT_PLACEHOLDER =
  '예) 좀 더 보수적으로 가고 싶어요. 하루에 신호는 세 번까지만'

export const ASSISTANT_ASK = '찾아보기'
export const ASSISTANT_APPLY = '이대로 저장'
export const ASSISTANT_EMPTY = '바꿀 값을 못 찾았습니다'

/** 저장이 언제부터 듣는지. **약속을 흐리지 않는다** (M7) */
export const ASSISTANT_WHEN = '저장한 값은 다음 거래일부터 듣습니다'

/** 안 올라간 줄이 있으면 그 사실을 말한다. 조용히 사라지면 같은 말을 또 하게 된다 */
export const ASSISTANT_REJECTED_TITLE = '올리지 않은 것'
