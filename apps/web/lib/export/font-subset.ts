// 내보낸 문서가 들고 갈 한글 자형을 고르는 계산 (순수 함수 · SSOT).
//
// 왜 이 파일이 생겼나 (실측 2026-09-30):
//   내보낸 PDF·이미지에서 **한글만 통째로 빈칸**으로 나왔다. 숫자와 로마자
//   (Onedrive·SaaS·WBS·VPN·Dooray)는 멀쩡했다. 원인은 코드가 아니라 렌더 환경이다 —
//   `@sparticuz/chromium@149` 가 배포본에 싣는 글꼴은 `bin/fonts.tar.br` 를 풀어 보면
//   `Open_Sans/{Regular,Bold,Italic}.ttf` **셋뿐**이고, 한글 자형이 서버에 하나도 없다.
//   문서 CSS 가 부르던 `-apple-system`·`Malgun Gothic`·`Apple SD Gothic Neo`·`Noto Sans KR`
//   는 전부 로컬 macOS 에만 있는 이름이라, 로컬에서는 100% 정상이고 프로덕션에서만 깨졌다.
//
// 그래서 시스템 글꼴을 기대하지 않는다. 문서가 자기 자형을 **들고 간다**.
// 파일을 읽는 쪽은 embed-korean-font.ts(서버 전용)이고, 여기는 고르는 규칙만 둔다 —
// 규칙은 순수 함수라 단위 시험이 가능하고, 시험이 도는 곳에 `server-only` 를 들일 수 없다.

/** 문서가 부를 이름. 화면 CSS 와 같은 이름이라 내보낸 문서가 앱과 같은 자형으로 나온다. */
export const EXPORT_FONT_FAMILY = "'Pretendard Variable'"

/** 내보낸 문서의 글꼴 차례. 자형을 들고 가므로 첫 줄이 항상 맞고, 나머지는 만약을 위한 뒤받침. */
export const EXPORT_FONT_STACK =
  `${EXPORT_FONT_FAMILY}, -apple-system, BlinkMacSystemFont, 'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif`

/**
 * 배포본에서 `public/` 이 있을 수 있는 자리 — 실행 디렉터리 기준 상대 경로.
 *
 * 모노레포라 실행 디렉터리가 저장소 루트일 수도, `apps/web` 일 수도, λ 의 `/var/task` 일 수도 있다.
 * 모양을 보고 고르면 못 본 모양 하나에서 없는 경로를 짚고, 그때 증상은 다시 「한글만 빈칸」이다 —
 * 이 사고와 똑같이 **프로덕션에서만** 그렇다. 그래서 읽는 쪽이 차례로 열어 보고 되는 자리를 쓴다.
 *
 * 전부 저장소 안 고정 문자열이다 — 밖에서 온 값이 경로에 안 섞인다(경로 조작 여지 0).
 * 읽는 쪽과 가드가 **이 한 목록**을 같이 본다(두 벌이면 한쪽만 고쳐진다).
 */
export const PUBLIC_CANDIDATES = ['public', 'apps/web/public']

/** fonts.css 한 줄에서 뽑아낸 조각 하나 — 어느 파일이 어느 글자를 덮는가. */
export interface FontFace {
  /** public 아래 상대 경로 (예: fonts/pretendard/PretendardVariable.subset.3.woff2) */
  file: string
  /** 원문 그대로의 unicode-range 값 — 문서에 그대로 되싣는다 */
  unicodeRange: string
  /** [시작, 끝] 코드포인트 쌍 목록. 문서 글자와 겹치는지 보는 데 쓴다 */
  ranges: [number, number][]
}

const FACE_RE = /@font-face\{([^}]*)\}/g
const FAMILY_RE = /font-family:'([^']+)'/
const URL_RE = /src:url\(([^)]+)\)/
const RANGE_RE = /unicode-range:([^;}]+)/

/** `U+ac00-d7a3` `U+39` `U+0000-00FF` 를 [시작,끝] 쌍으로. */
function parseRanges(raw: string): [number, number][] {
  const out: [number, number][] = []
  for (const part of raw.split(',')) {
    const m = part.trim().match(/^U\+([0-9a-f]+)(?:-([0-9a-f]+))?$/i)
    if (!m) continue
    const from = parseInt(m[1], 16)
    out.push([from, m[2] ? parseInt(m[2], 16) : from])
  }
  return out
}

/**
 * fonts.css 에서 한 글꼴 가족의 조각 목록을 읽어 낸다.
 *
 * 왜 CSS 를 파싱하나: 조각 92개의 unicode-range 는 **fonts.css 한 곳에만** 적혀 있다.
 * 여기에 표를 또 만들면 글꼴을 갱신할 때 한쪽만 고쳐지고, 그 어긋남은 글자가 빈칸으로
 * 나가야만 드러난다(이번 사고와 같은 모양).
 */
export function parseFontFaces(css: string, family: string): FontFace[] {
  const faces: FontFace[] = []
  for (const m of css.matchAll(FACE_RE)) {
    const decl = m[1]
    if (FAMILY_RE.exec(decl)?.[1] !== family) continue
    const url = URL_RE.exec(decl)?.[1]
    const range = RANGE_RE.exec(decl)?.[1]
    if (!url || !range) continue
    faces.push({ file: url.replace(/^\//, ''), unicodeRange: range.trim(), ranges: parseRanges(range) })
  }
  return faces
}

/**
 * 이 글자들을 덮는 조각만 고른다.
 *
 * 문서 한 편이 쓰는 한글은 보통 수백 자이고 조각 92개에 흩어져 있다. 다 실으면 매
 * 내보내기마다 3MB 를 들고 가는데 그중 대부분은 이 문서에 없는 글자다.
 */
export function pickKoreanFontFaces(text: string, faces: FontFace[]): FontFace[] {
  const points = new Set<number>()
  for (const ch of text) {
    const cp = ch.codePointAt(0)
    if (cp !== undefined) points.add(cp)
  }
  return faces.filter((f) => f.ranges.some(([a, b]) => {
    for (const cp of points) if (cp >= a && cp <= b) return true
    return false
  }))
}

/** 조각 하나를 문서에 박을 수 있는 @font-face 한 줄로. */
export function fontFaceCss(base64: string, unicodeRange: string): string {
  return `@font-face{font-family:${EXPORT_FONT_FAMILY};font-style:normal;font-weight:45 920;`
    + `src:url(data:font/woff2;base64,${base64}) format('woff2-variations');`
    + `unicode-range:${unicodeRange}}`
}
