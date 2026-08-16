// lib/ci/production/chapters.ts — 설명문에서 챕터(구간 표시) 뽑기 (SSOT)
//
// 왜: 링크만 있는 영상은 브라우저가 원본 픽셀을 못 읽는다. 그렇다고 아무것도 못 하는 건 아니다.
// 유튜브 설명문에는 작성자가 직접 적은 `0:00 인트로 / 1:24 본론` 같은 구간 표시가 자주 있다.
// 이건 우리가 추정한 장면 전환보다 **정확하다** — 만든 사람이 직접 찍은 지점이기 때문이다.
// 설명문은 이미 수집·저장하고 있었는데(ci_contents.description) 쓰이지 않고 있었다.
//
// 원칙: 못 읽으면 빈 배열이다. 없는 구간을 지어내지 않는다.

export interface Chapter {
  atSec: number
  label: string
}

/** 라벨 길이 상한. 설명문 한 줄이 통째로 들어오면 편집점 문구가 망가진다. */
const MAX_LABEL = 60
/** 챕터 상한. 이 이상이면 목차라기보다 대본이라 편집점 재료로 쓸모가 없다. */
const MAX_CHAPTERS = 40

/**
 * `1:23`·`01:23`·`1:02:03` → 초.
 * 시:분:초와 분:초를 **자릿수로** 구분한다. 3토막이면 시간이 앞에 있다.
 */
export function timestampToSec(raw: string): number | null {
  const parts = raw.split(':')
  if (parts.length < 2 || parts.length > 3) return null
  const nums = parts.map((p) => (/^\d{1,2}$/.test(p) ? Number(p) : NaN))
  if (nums.some((n) => !Number.isFinite(n))) return null
  // 분·초는 60 미만이어야 한다. 아니면 타임코드가 아니라 그냥 숫자다(스코어 등).
  if (nums.length === 2 && nums[1] >= 60) return null
  if (nums.length === 3 && (nums[1] >= 60 || nums[2] >= 60)) return null
  return nums.length === 3
    ? nums[0] * 3600 + nums[1] * 60 + nums[2]
    : nums[0] * 60 + nums[1]
}

/** 줄 앞뒤의 장식(–, -, ▶, 숫자., 괄호)을 걷어낸다. 라벨만 남긴다. */
function cleanLabel(raw: string): string {
  return raw
    .replace(/^[\s\-–—·•▶▪️*|)\]}]+/, '')
    .replace(/[\s\-–—·•|(\[{]+$/, '')
    .trim()
    .slice(0, MAX_LABEL)
}

const LINE_TIMESTAMP = /(\d{1,2}(?::\d{1,2}){1,2})/

/**
 * 라벨에 글자가 하나라도 있는가.
 * 유니코드 속성 이스케이프(`\p{L}`)를 쓰지 않는 이유: 이 저장소의 컴파일 타깃이 그 문법을 받지 않는다.
 * 라틴·숫자·한글·가나·한자를 명시해 같은 판정을 낸다.
 */
const WORD_CHAR = /[0-9A-Za-z가-힣ㄱ-ㆎ぀-ヿ一-鿿]/

function hasWord(label: string): boolean {
  return WORD_CHAR.test(label)
}

/**
 * 설명문에서 챕터를 뽑는다.
 *
 * 판정 규칙(느슨하면 아무 숫자나 챕터가 된다):
 *  ① 한 줄에 타임코드가 있고
 *  ② 그 줄에 라벨(설명 글자)이 함께 있고
 *  ③ 시각이 **증가하는** 줄들만 남긴다 — 되돌아가는 목록은 목차가 아니다
 */
export function parseChapters(description: string | null | undefined): Chapter[] {
  if (!description) return []

  const found: Chapter[] = []
  for (const line of description.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const m = LINE_TIMESTAMP.exec(trimmed)
    if (!m) continue

    const atSec = timestampToSec(m[1])
    if (atSec == null) continue

    const label = cleanLabel(trimmed.replace(m[1], ' '))
    // 라벨 없는 타임코드는 목차가 아니다(그냥 "3:21"이라고만 적힌 줄).
    // 길이가 아니라 **글자가 있는가**로 본다 — "끝" 한 글자짜리 챕터는 실제로 흔하다.
    if (!hasWord(label)) continue

    found.push({ atSec, label })
    if (found.length >= MAX_CHAPTERS * 2) break
  }

  // 시각이 증가하는 것만 남긴다. 목차는 순서대로 적히는 법이다.
  const ordered: Chapter[] = []
  for (const c of found) {
    if (ordered.length === 0 || c.atSec > ordered[ordered.length - 1].atSec) ordered.push(c)
  }

  // 한두 개짜리는 목차가 아니라 우연히 들어간 시각 표기다
  return ordered.length >= 2 ? ordered.slice(0, MAX_CHAPTERS) : []
}
