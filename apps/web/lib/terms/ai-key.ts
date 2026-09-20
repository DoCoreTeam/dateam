// AI 공급자 키 화면의 말 (SSOT)
//
// 왜 여기인가: 키 줄의 상태를 규칙 모듈(lib/ai/key-store-core)이 만들고 있었다.
// 규칙이 말을 가지면, 그 말이 필요한 두 번째 화면이 자기 것을 또 적는다 —
// 「연결됨」이 화면마다 다른 말이 됐던 것과 같은 자리다(lib/terms/connection.ts).
// 규칙은 **어떤 상태인가**를 정하고, 여기는 **그것을 뭐라고 부르는가**를 정한다.
//
// 금지어를 피한 자리: 새 줄을 더하는 버튼은 「추가」가 아니라 **「새 키」**다
// (「추가」는 무엇을 추가하는지 안 밝힌다 — 용어집 §07).

/** 키 한 줄이 지금 어떤 상태인가. 규칙은 lib/ai/key-store-core 가 정한다 */
export const AI_KEY_STATUS = {
  usable: '쓸 수 있음',
  cooling: '한도에 걸려 쉬는 중',
  /** 기다려서 풀릴 일이 아니다. 사람이 새 키로 바꿔야 한다는 뜻까지 담는다 */
  auth_broken: '키가 거부됨, 새 키로 바꿔야 합니다',
  /** 사람이 끈 것. 기계가 끈 것(cooling·auth_broken)과 구분한다 */
  off: '꺼 둠',
} as const

export type AiKeyStatusKey = keyof typeof AI_KEY_STATUS

/** 키 목록 화면의 말 */
export const AI_KEY = {
  /** 새 줄을 더하는 버튼. 「추가」가 아니다 */
  create: '새 키',
  labelField: '키 이름',
  keyField: 'API 키',
  labelPlaceholder: '두 번째 계정',
  moveUp: '위로',
  moveDown: '아래로',
  turnOn: '켜기',
  turnOff: '끄기',
  /** 순서가 곧 정책이다. 화면이 그 사실을 말해야 관리자가 순서를 의미 있게 정한다 */
  orderNote: '앞에 있는 키부터 씁니다. 한도에 걸리면 다음 키로 이어서 부릅니다',
} as const
