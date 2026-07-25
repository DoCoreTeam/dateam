// 목록 심층분석 — 원문 대비 "핵심 요소 보존율" 측정 SSOT (순수 함수·테스트 대상).
//
// 왜: 심화 결과가 원문을 재서술하며 ID·수치 같은 구체 정보를 잃어도 시스템이 몰랐다(지표 0건).
// 원문에서 결정론으로 핵심 엔티티(ID·수치)를 뽑아 결과에 남았는지 세어, 카드에 "ID 12/12·수치 8/8"을
// 표시하고 누락 시 경고한다. LLM 판단이 아니라 정규식 기반이라 값싸고 재현 가능하다.

/** 요구/결정 ID 류: 대문자 1~4 + (선택)하이픈 + 숫자. 예: FR-101, NFR-03, D-16, V-10, S1, P0. */
const ID_RE = /\b[A-Z]{1,4}-?\d{1,4}\b/g

/**
 * 의미 있는 수치: 숫자(소수·콤마 허용) + 단위/맥락. 맨숫자 남발을 피하려 단위가 붙은 것만 센다.
 * %·배수·한국어 단위·기술 단위(MB/RPM 등)·시간(T+N) 등.
 */
const NUM_RE =
  /\b\d[\d,]*(?:\.\d+)?\s?(?:%|배|일|시간|분|초|자|개|건|명|원|점|회|위|주|월|년|만|억|천|VU|RPM|TPM|MB|GB|KB|TB|ms|초당|비트)/g
/** "T+N", "P50", "P95" 같은 지표성 토큰. (맨소수 \d+\.\d+는 섹션번호 오검출이 많아 제외 — 단위 붙은 소수는 NUM_RE가 잡는다.) */
const METRIC_RE = /\b(?:T\+\d+|P\d{2,3})\b/g

function uniqueMatches(text: string, re: RegExp): string[] {
  const found = text.match(re) ?? []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of found) {
    const t = raw.trim()
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

export interface EntitySet {
  ids: string[]
  numbers: string[]
}

/** 원문에서 보존 여부를 추적할 핵심 엔티티(ID·수치)를 추출한다. */
export function extractEntities(text: string): EntitySet {
  const numbers = Array.from(new Set([...uniqueMatches(text, NUM_RE), ...uniqueMatches(text, METRIC_RE)]))
  return { ids: uniqueMatches(text, ID_RE), numbers }
}

export interface RetentionResult {
  idTotal: number
  idKept: number
  numTotal: number
  numKept: number
  /** 원문에 있었으나 결과에서 사라진 엔티티(경고 표시용, 상한 12개). */
  missing: string[]
  /** 원문에 추적할 엔티티가 하나도 없으면 true(보존율 배지 미표시 대상). */
  empty: boolean
}

/** 공백을 무시한 포함 검사 — 결과의 표/줄바꿈 재배치로 토큰 사이 공백이 달라져도 매칭되게. */
function contains(haystackNoSpace: string, needle: string): boolean {
  return haystackNoSpace.includes(needle.replace(/\s+/g, ''))
}

export type InputDensity = 'dense' | 'sparse'

/**
 * 입력 밀도 분류 — 심화 모드 자동분기용.
 *  dense  = 이미 상세한 정본(표·ID·수치 다수) → "검증·갭·리스크" 중심 보강(부풀리기 금지)
 *  sparse = 압축된 목록(짧은 항목) → "생략된 실행 상세 펼치기" 보강
 * 순수·결정론 — AI 호출 없음.
 */
export function classifyDensity(source: string): InputDensity {
  const { ids, numbers } = extractEntities(source)
  const chars = source.length || 1
  const hasTable = /\|.*\|/.test(source)
  const entityPerK = (ids.length + numbers.length) / (chars / 1000)
  // 짧은 한 줄(예: "10만 명")은 엔티티 1개만으로 per-K가 폭등하므로 최소 길이 이상에서만 밀도 판정.
  if (hasTable || ids.length >= 3 || (chars >= 40 && entityPerK >= 6)) return 'dense'
  return 'sparse'
}

/**
 * 결과에 등장하지만 원문엔 없던 수치 — AI가 새로 도입한 값(충실도 신호, 결정론 프록시).
 * "이 수치는 원문 근거가 없으니 검토하라"를 정확히 짚어준다. LLM-judge보다 값싸고 재현 가능하다.
 * (augment 모드 결과는 원문을 그대로 담으므로, 여기서 잡히는 건 순수하게 '보강'이 더한 값이다.)
 */
export function computeAddedNumbers(source: string, result: string): string[] {
  const srcNums = new Set(extractEntities(source).numbers.map((n) => n.replace(/\s+/g, '')))
  const out: string[] = []
  const seen = new Set<string>()
  for (const n of extractEntities(result).numbers) {
    const key = n.replace(/\s+/g, '')
    if (srcNums.has(key) || seen.has(key)) continue
    seen.add(key)
    out.push(n)
  }
  return out.slice(0, 12)
}

/**
 * 원문(source) 대비 결과(result)의 핵심 엔티티 보존율.
 * 증강 모드처럼 원문을 그대로 담은 결과는 자연히 100%가 된다(설계상 안심 신호).
 */
export function computeRetention(source: string, result: string): RetentionResult {
  const { ids, numbers } = extractEntities(source)
  const resultNoSpace = result.replace(/\s+/g, '')
  const missing: string[] = []

  let idKept = 0
  for (const id of ids) {
    if (contains(resultNoSpace, id)) idKept++
    else missing.push(id)
  }
  let numKept = 0
  for (const n of numbers) {
    if (contains(resultNoSpace, n)) numKept++
    else missing.push(n)
  }

  return {
    idTotal: ids.length,
    idKept,
    numTotal: numbers.length,
    numKept,
    missing: missing.slice(0, 12),
    empty: ids.length === 0 && numbers.length === 0,
  }
}
