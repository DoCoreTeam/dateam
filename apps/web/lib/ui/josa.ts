// 한국어 조사 SSOT — 화면 문장이 "회사을(를)"처럼 어색해지지 않게
//
// **왜 필요한가**: 이름을 문장에 끼워 넣을 때마다 `${name}을(를)` 처럼 두 형태를 병기해 왔다.
// 읽는 사람은 매번 괄호를 건너뛰며 읽어야 하고, 화면이 기계가 쓴 것처럼 보인다.
// (실측: 영업 단계 화면에서 "지금 여기 있는 1건은 **회사을(를)** 모두 채웠어요"가 그대로 렌더됐다.
//  저장소 전체에 같은 병기가 25곳 있었다.)
//
// **판정 근거**: 한글 음절은 유니코드에서 `(초성×21 + 중성)×28 + 종성` 으로 배열돼 있다.
// 그래서 `(코드 - 0xAC00) % 28` 이 0이면 받침이 없다 — 사전이 필요 없다.
//
// **모르는 것은 지어내지 않는다**: 한글이 아닌 말(영문·숫자·기호)로 끝나면 발음을 알 수 없다.
// 그때만 예전처럼 두 형태를 병기한다 — 틀린 조사를 붙이는 것보다 낫다.

const HANGUL_START = 0xac00
const HANGUL_END = 0xd7a3
const JONGSEONG_COUNT = 28
/** ㄹ 받침 — '로/으로'만 이걸 받침 없는 것처럼 다룬다(서울로, 학교로) */
const JONG_RIEUL = 8

/** 마지막 글자의 받침. 한글이 아니면 판정 불가라 null */
function finalJong(word: string): number | null {
  const last = word.trimEnd().slice(-1)
  if (!last) return null
  const code = last.charCodeAt(0)
  if (code < HANGUL_START || code > HANGUL_END) return null
  return (code - HANGUL_START) % JONGSEONG_COUNT
}

/** 받침 있을 때 / 없을 때 형태 — 판정 불가면 둘 다 보여 준다 */
function pick(word: string, withJong: string, withoutJong: string): string {
  const jong = finalJong(word)
  if (jong === null) return `${withJong}(${withoutJong})`
  return jong === 0 ? withoutJong : withJong
}

/** 을 / 를 */
export function eulReul(word: string): string {
  return pick(word, '을', '를')
}

/** 이 / 가 */
export function iGa(word: string): string {
  return pick(word, '이', '가')
}

/** 은 / 는 */
export function eunNeun(word: string): string {
  return pick(word, '은', '는')
}

/** 과 / 와 */
export function gwaWa(word: string): string {
  return pick(word, '과', '와')
}

/** 으로 / 로 — ㄹ 받침은 '로'다(서울로, 결과로) */
export function euroRo(word: string): string {
  const jong = finalJong(word)
  if (jong === null) return '(으)로'
  return jong === 0 || jong === JONG_RIEUL ? '로' : '으로'
}

/** 말 뒤에 조사를 붙인 한 덩어리 — 호출부가 매번 이어 붙이지 않게 */
export function withJosa(word: string, josa: (w: string) => string): string {
  return `${word}${josa(word)}`
}
