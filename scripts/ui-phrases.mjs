// UI 상태 문구·색 판정 SSOT — 디자인 가드(scripts/check-design-tokens.mjs)와
// 화면 스캐너(docs/ui-system/scan-screens.mjs)가 **같은 정의**를 쓰도록 한 곳에 둔다.
//
// 왜 한 곳이어야 하나: 예전엔 두 스크립트가 "빈 상태 문구"를 각자 정의했다. 가드는 줄 단위로
// `없습니다`만 봤고(→ `<EmptyState title="…없어요">` 같은 **정상 사용**을 못 거르고, `없어요`는 아예 놓침),
// 스캐너는 JSX 텍스트 노드만 보는 정밀한 판정을 갖고 있었다. 정의가 갈리면 한쪽이 초록이어도
// 다른 쪽이 빨간, 또는 둘 다 틀린 상태가 된다 — 무엇이 위반인지 사람이 알 수 없게 된다.

/** 주석 제거 — 주석 속 예시 문구를 위반으로 세지 않는다. */
export function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
}

/**
 * JSX 텍스트 노드에 문구가 있는가(= 화면에 직접 찍은 자작 문구).
 * - `<div …>없습니다</div>` → 닫는 `>` 뒤에 글자가 온다 → 자작
 * - `title="…없어요"`       → 앞에 `<`가 끼어 이어지지 않는다 → 표준(공용 부품의 props)
 * - `setError('…실패')`     → `(`·`'` 때문에 텍스트 노드가 아니다 → 표준(문자열 인자)
 */
export function jsxText(phrase) {
  return new RegExp(`>[^<>{}]{0,100}?(?:${phrase})`)
}

/** 여러 줄로 쪼개진 JSX 텍스트 — 그 줄에 태그·속성·따옴표가 전혀 없을 때만 */
export function bareText(phrase) {
  return new RegExp(`^[^<>="'\`{}()]*(?:${phrase})`)
}

// '되돌릴/삭제할 수 없습니다'는 **경고문**이지 빈 상태가 아니다 → 능력부정 동사는 뺀다.
// 단 '찾을 수 없습니다'(not found)는 빈 상태가 맞아 남긴다.
//
// ⚠️ 예전 판은 `(?<!되돌릴 )없습니다`라 **한 번도 걸러지지 않았다**. 한국어 능력부정은
//   '되돌릴 **수** 없습니다'라 `없습니다` 바로 앞은 언제나 `수 `이기 때문이다. 제외 목록이
//   실제로 거른 것은 `되돌릴 없습니다`(비문)뿐이었고, 그 결과 경고문을 쓴 화면이 전부
//   '빈 상태 문구 자작'으로 잡혀 **다른 세션의 커밋까지 막았다**(v0.7.493 실측).
//   제외는 `없어요`에도 같이 걸린다 — '되돌릴 수 없어요'도 같은 경고문이다.
const CANNOT = '(?:되돌릴|취소할|삭제할|변경할|사용할|수정할|복구할|입력할|선택할) ?수 ?'
export const EMPTY = `(?<!${CANNOT})(?:없습니다|없어요)|비어 ?있습니다`
export const ERROR = '실패했습니다|오류가 발생|불러오지 못|에러가 발생'
export const LOADING = '로딩 ?중|불러오는 ?중'

/** 한 줄이 자작 상태 문구인가(JSX 텍스트 노드 기준). */
export function isSelfMadeStateText(line, phrase) {
  return jsxText(phrase).test(line) || bareText(phrase).test(line)
}

// 이름색 — 테마 전환에서 통째로 누락된다.
// ① `'white'`/3자리 hex는 어디에 있든 잡는다(기존 규칙 유지 — baseline이 이 기준으로 쌓여 있다).
export const NAMED_COLOR_RE = /(?:'white'|"white"|#[0-9a-fA-F]{3}\b)/g
// ② 그 밖의 색 키워드는 **CSS 색 속성의 값일 때만** 잡는다.
//    (변수명 `red`, 문자열 'green' 같은 상태값까지 잡으면 오탐이 쏟아진다)
const COLOR_KEYWORDS = 'black|red|blue|green|gray|grey|orange|yellow|purple|pink|brown|navy|teal|gold|lime|cyan|magenta|silver|maroon|olive|crimson|salmon|khaki|indigo|violet'
const COLOR_PROPS = 'color|background|backgroundColor|borderColor|borderTopColor|borderBottomColor|borderLeftColor|borderRightColor|fill|stroke|outlineColor|caretColor|textDecorationColor'
export const NAMED_COLOR_PROP_RE = new RegExp(`(?:${COLOR_PROPS})\\s*:\\s*['"\`](?:${COLOR_KEYWORDS})['"\`]`, 'g')
