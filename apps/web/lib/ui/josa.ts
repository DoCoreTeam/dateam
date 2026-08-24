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
//
// **다만 아는 것까지 모른다고 하지는 않는다**(v0.7.595):
// 대문자로만 이어진 꼬리(`API`·`CRM`·`GPU`)와 숫자는 한국어에서 **한 글자씩 읽는 법이 정해져 있다**
// — API는 '에이피아이', CRM은 '씨알엠', 3은 '삼'. 발음이 정해져 있으니 받침도 정해져 있다.
// 이걸 '모른다'로 두는 바람에 시스템 로그가 **"CRM 화면·API이(가) 실패했습니다"**를 그대로 띄웠다
// (실측 2026-08-24 /admin/system-log). 이 병기가 바로 위 주석이 막으려던 그 모양이다.
//
// 소문자가 섞인 말(`Vercel`·`Google`)은 통째로 읽는지 한 글자씩 읽는지 알 수 없으므로 **그대로 병기한다.**

const HANGUL_START = 0xac00
const HANGUL_END = 0xd7a3
const JONGSEONG_COUNT = 28
/** ㄹ 받침 — '로/으로'만 이걸 받침 없는 것처럼 다룬다(서울로, 학교로) */
const JONG_RIEUL = 8

/**
 * 알파벳 한 글자를 한국어로 읽었을 때의 받침. 값은 한글 종성 인덱스다
 * (0=없음 · 1=ㄱ · 4=ㄴ · 8=ㄹ · 16=ㅁ). 받침이 있는 것은 다섯뿐이다 — L엘 · M엠 · N엔 · R알.
 */
const LATIN_JONG: Record<string, number> = {
  A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0, H: 0, I: 0, J: 0, K: 0,
  L: JONG_RIEUL, M: 16, N: 4, O: 0, P: 0, Q: 0, R: JONG_RIEUL, S: 0,
  T: 0, U: 0, V: 0, W: 0, X: 0, Y: 0, Z: 0,
}

/** 숫자를 한국어로 읽었을 때의 받침 — 영(ㅇ) 일(ㄹ) 이 삼(ㅁ) 사 오 육(ㄱ) 칠(ㄹ) 팔(ㄹ) 구 */
const DIGIT_JONG: Record<string, number> = {
  '0': 21, '1': JONG_RIEUL, '2': 0, '3': 16, '4': 0,
  '5': 0, '6': 1, '7': JONG_RIEUL, '8': JONG_RIEUL, '9': 0,
}

/** 마지막 글자의 받침. 읽는 법을 모르는 말이면 판정 불가라 null */
function finalJong(word: string): number | null {
  const trimmed = word.trimEnd()
  const last = trimmed.slice(-1)
  if (!last) return null

  const code = last.charCodeAt(0)
  if (code >= HANGUL_START && code <= HANGUL_END) return (code - HANGUL_START) % JONGSEONG_COUNT

  const digit = DIGIT_JONG[last]
  if (digit !== undefined) return digit

  // 대문자로만 이어진 꼬리여야 약어다. 소문자가 하나라도 섞이면(Vercel) 읽는 법을 모른다
  const tail = /[A-Za-z]+$/.exec(trimmed)?.[0]
  if (tail && tail === tail.toUpperCase()) return LATIN_JONG[last] ?? null

  return null
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
