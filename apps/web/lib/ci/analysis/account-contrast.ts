// lib/ci/analysis/account-contrast.ts — "이 계정에서 왜 이게 잘 됐나" (순수 함수)
//
// 사용자가 말한 것: "해당 계정의 모든 게시물에서 잘 되는 게시물을 파악하고 **왜 잘 되는지** 파악".
//
// 그동안 시스템이 답한 것은 "왜"가 아니었다. 배수(평소 대비 몇 배)는 **얼마나** 잘 됐는지고,
// 썸네일 분석은 그 한 건이 **어떻게 생겼는지**다. 둘 다 "왜"가 아니다.
//
// "왜"는 **대조**로만 나온다: 잘된 것들이 가졌고 평소 것들이 안 가진 것.
// 같은 계정 안에서 비교해야 의미가 있다 — 채널이 다르면 구독자·주제·시청층이 전부 달라
// "쇼츠가 잘 된다" 같은 말이 그 채널 얘기인지 플랫폼 얘기인지 알 수 없다.
//
// 이 모듈이 지키는 것:
//   1) **근거 없으면 말하지 않는다.** 표본이 얇으면 findings를 비우고 왜 못 말하는지 남긴다.
//      "표본 3건으로 발견한 공식"은 공식이 아니라 우연이다.
//   2) **관측한 것만 말한다.** 제목·길이·요일·시간대·형식·키워드는 우리가 실제로 수집한 값이다.
//      "썸네일에 사람 얼굴이 있어서"처럼 안 본 것을 추측하지 않는다.
//   3) **차이를 수로 밝힌다.** 잘된 쪽 몇 %, 평소 몇 % — 읽는 사람이 스스로 판단할 수 있게.

import { CREATIVE_MIN_INDEX } from './outlier.ts'

/** 이 아래로는 대조를 시작하지 않는다. 잘된 게 1~2건이면 어떤 공통점도 우연이다. */
export const MIN_WINNERS = 3

/** 비교 대상(평소)이 이만큼은 있어야 "평소와 다르다"고 말할 수 있다. */
export const MIN_BASELINE = 5

/** 잘된 쪽 비율이 평소의 몇 배여야 차이로 볼지. 1.5배 미만은 흔들림이다. */
export const MIN_LIFT = 1.5

/** 그 값을 가진 잘된 게시물이 이만큼은 있어야 한다(비율만 높고 1건이면 의미 없다). */
export const MIN_SUPPORT = 2

/** 길이 차이는 이 정도는 나야 말한다. 10% 차이를 "짧게 만드세요"라고 하면 소음이다. */
export const MIN_NUMERIC_DIFF_RATIO = 0.25

/** 소재는 몇 개까지 보여줄지. 채널 고정 태그가 목록을 뒤덮는 것을 막는다. */
export const MAX_KEYWORD_FINDINGS = 4

/**
 * 신호의 세기. 1보다 큰 쪽과 작은 쪽을 대칭으로 본다 —
 * 0.5배(절반)와 2배는 같은 세기다.
 */
export function effectSize(f: { lift: number }): number {
  if (!Number.isFinite(f.lift) || f.lift <= 0) return 0
  return f.lift >= 1 ? f.lift : 1 / f.lift
}

export interface ContrastInput {
  /** 평소 대비 배수. null이면 비교 근거가 없는 콘텐츠 — 대조에서 제외한다. */
  outlierIndex: number | null
  format: string | null
  durationSec: number | null
  /** KST 등 채널 지역 기준 요일(0=일). temporal.ts가 채운 값. */
  weekday: number | null
  /** 'dawn' | 'morning' | 'afternoon' | 'evening' | 'night' */
  dayPart: string | null
  keywords: string[] | null
  title: string | null
}

export interface ContrastFinding {
  /** 어떤 축에서 난 차이인가 */
  dimension: 'format' | 'weekday' | 'dayPart' | 'keyword' | 'duration' | 'titleLength'
  /** 사람이 읽는 한 문장 */
  text: string
  /** 잘된 쪽에서 이 특징을 가진 수 */
  winnerCount: number
  /** 차이의 크기(비율 축은 배수, 수치 축은 변화율) */
  lift: number
}

export interface AccountContrast {
  /** 대조에 쓴 잘된 게시물 수 */
  winners: number
  /** 대조에 쓴 평소 게시물 수 */
  baseline: number
  /** 발견한 차이. 근거가 부족하면 빈 배열이다. */
  findings: ContrastFinding[]
  /** 왜 말할 수 없는지. 말할 수 있으면 null. */
  insufficientReason: string | null
  /** 화면에 항상 붙이는 근거 문장 */
  basisText: string
}

const WEEKDAY_LABEL = ['일', '월', '화', '수', '목', '금', '토']

const DAY_PART_LABEL: Record<string, string> = {
  dawn: '새벽', morning: '오전', afternoon: '오후', evening: '저녁', night: '밤',
}

const FORMAT_LABEL: Record<string, string> = {
  short: '숏폼', long: '롱폼', live: '라이브', image: '이미지', text: '텍스트',
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

function pct(n: number, total: number): number {
  return total === 0 ? 0 : Math.round((n / total) * 100)
}

/** 값별 개수. null·빈 값은 세지 않는다 — 모르는 것을 하나의 부류로 만들면 안 된다. */
function tally<T extends ContrastInput>(rows: T[], pick: (r: T) => string | null): Map<string, number> {
  const m = new Map<string, number>()
  for (const r of rows) {
    const v = pick(r)
    if (!v) continue
    m.set(v, (m.get(v) ?? 0) + 1)
  }
  return m
}

/** 이 축에서 값 하나를 대조한다. 조건을 못 넘으면 null(= 할 말 없음). */
function contrastCategory(
  dimension: ContrastFinding['dimension'],
  value: string,
  label: string,
  winnerN: number, winnersTotal: number,
  baseN: number, baseTotal: number,
): ContrastFinding | null {
  if (winnerN < MIN_SUPPORT) return null

  const winnerRate = winnerN / winnersTotal
  const baseRate = baseN / baseTotal

  // 평소에 아예 없던 것이면 "새로 시도한 것"이다 — 배수는 무한이니 별도로 다룬다.
  const lift = baseRate === 0 ? Infinity : winnerRate / baseRate
  if (lift < MIN_LIFT) return null

  const wp = pct(winnerN, winnersTotal)
  const bp = pct(baseN, baseTotal)
  const text = baseRate === 0
    ? `${label} — 잘된 ${winnerN}건에는 있고 평소 게시물에는 없던 특징입니다`
    : `${label} — 잘된 쪽 ${wp}%, 평소 ${bp}%`

  return { dimension, text, winnerCount: winnerN, lift: baseRate === 0 ? 99 : Number(lift.toFixed(2)) }
}

function contrastNumeric(
  dimension: ContrastFinding['dimension'],
  winnerVals: number[], baseVals: number[],
  render: (w: number, b: number, longer: boolean) => string,
): ContrastFinding | null {
  if (winnerVals.length < MIN_SUPPORT || baseVals.length < MIN_SUPPORT) return null
  const w = median(winnerVals)
  const b = median(baseVals)
  if (w == null || b == null || b === 0) return null

  const ratio = w / b
  const diff = Math.abs(ratio - 1)
  if (diff < MIN_NUMERIC_DIFF_RATIO) return null

  return {
    dimension,
    text: render(w, b, ratio > 1),
    winnerCount: winnerVals.length,
    lift: Number(ratio.toFixed(2)),
  }
}

/** 키워드 정규화 — 대소문자·해시태그·공백만 정리한다. 뜻을 해석하지 않는다. */
function normKeyword(raw: string): string {
  return raw.trim().replace(/^#/, '').toLowerCase()
}

/**
 * 한 계정의 콘텐츠를 "잘된 것"과 "평소"로 갈라 무엇이 다른지 찾는다.
 *
 * 반환값이 비어 있는 것은 실패가 아니다 — 아직 말할 근거가 없다는 뜻이고,
 * 그 이유를 `insufficientReason`에 담아 화면이 그대로 보여줄 수 있게 한다.
 */
export function buildAccountContrast(
  rows: ContrastInput[],
  minIndex: number = CREATIVE_MIN_INDEX,
): AccountContrast {
  // 배수가 없는 콘텐츠는 잘됐는지 아닌지 판정 자체가 불가능하다.
  const judged = rows.filter((r) => r.outlierIndex != null && Number.isFinite(r.outlierIndex))
  const winners = judged.filter((r) => (r.outlierIndex as number) >= minIndex)
  const baseline = judged.filter((r) => (r.outlierIndex as number) < minIndex)

  const basisText = `잘된 게시물 ${winners.length}건 · 평소 ${baseline.length}건 비교`

  if (judged.length === 0) {
    return {
      winners: 0, baseline: 0, findings: [], basisText,
      insufficientReason: '아직 평소 대비 배수를 낸 게시물이 없습니다. 같은 계정의 게시물이 더 모이면 비교를 시작합니다.',
    }
  }
  if (winners.length < MIN_WINNERS) {
    return {
      winners: winners.length, baseline: baseline.length, findings: [], basisText,
      insufficientReason: `잘된 게시물이 ${winners.length}건뿐이라 공통점을 찾아도 우연과 구분되지 않습니다. ${MIN_WINNERS}건부터 비교합니다.`,
    }
  }
  if (baseline.length < MIN_BASELINE) {
    return {
      winners: winners.length, baseline: baseline.length, findings: [], basisText,
      insufficientReason: `비교할 평소 게시물이 ${baseline.length}건뿐입니다. "평소와 다르다"고 말하려면 평소가 ${MIN_BASELINE}건은 있어야 합니다.`,
    }
  }

  const findings: ContrastFinding[] = []
  const wN = winners.length
  const bN = baseline.length

  // ── 형식 ──
  const wFmt = tally(winners, (r) => r.format)
  const bFmt = tally(baseline, (r) => r.format)
  wFmt.forEach((n, v) => {
    const f = contrastCategory('format', v, FORMAT_LABEL[v] ?? v, n, wN, bFmt.get(v) ?? 0, bN)
    if (f) findings.push(f)
  })

  // ── 요일 ──
  const wDay = tally(winners, (r) => (r.weekday == null ? null : String(r.weekday)))
  const bDay = tally(baseline, (r) => (r.weekday == null ? null : String(r.weekday)))
  wDay.forEach((n, v) => {
    const label = `${WEEKDAY_LABEL[Number(v)] ?? v}요일 게시`
    const f = contrastCategory('weekday', v, label, n, wN, bDay.get(v) ?? 0, bN)
    if (f) findings.push(f)
  })

  // ── 시간대 ──
  const wPart = tally(winners, (r) => r.dayPart)
  const bPart = tally(baseline, (r) => r.dayPart)
  wPart.forEach((n, v) => {
    const f = contrastCategory('dayPart', v, `${DAY_PART_LABEL[v] ?? v} 게시`, n, wN, bPart.get(v) ?? 0, bN)
    if (f) findings.push(f)
  })

  // ── 키워드 ──
  const wKw = tally(winners, () => null)
  for (const r of winners) {
    // 한 게시물이 같은 소재를 여러 번 달아도 1건이다 — 표기 중복이 근거를 부풀리면 안 된다
    const uniq = Array.from(new Set((r.keywords ?? []).map(normKeyword).filter(Boolean)))
    for (const k of uniq) wKw.set(k, (wKw.get(k) ?? 0) + 1)
  }
  const bKw = new Map<string, number>()
  for (const r of baseline) {
    const uniq = Array.from(new Set((r.keywords ?? []).map(normKeyword).filter(Boolean)))
    for (const k of uniq) bKw.set(k, (bKw.get(k) ?? 0) + 1)
  }
  // 채널이 모든 영상에 다는 고정 태그(이름·종목 등)는 잘된 쪽에도 평소에도 있어
  // 약한 차이로 잔뜩 통과한다. 그대로 두면 목록이 그 세트로 뒤덮여
  // 정작 중요한 요일·길이 발견이 안 보인다. 센 것 몇 개만 남긴다.
  const kwFindings: ContrastFinding[] = []
  wKw.forEach((n, v) => {
    const f = contrastCategory('keyword', v, `"${v}" 소재`, n, wN, bKw.get(v) ?? 0, bN)
    if (f) kwFindings.push(f)
  })
  kwFindings.sort((a, b) => (b.lift - a.lift) || (b.winnerCount - a.winnerCount))
  findings.push(...kwFindings.slice(0, MAX_KEYWORD_FINDINGS))

  // ── 길이 ──
  const durF = contrastNumeric(
    'duration',
    winners.map((r) => r.durationSec).filter((n): n is number => n != null && n > 0),
    baseline.map((r) => r.durationSec).filter((n): n is number => n != null && n > 0),
    (w, b, longer) => `길이 — 잘된 쪽 약 ${Math.round(w)}초, 평소 약 ${Math.round(b)}초 (${longer ? '더 김' : '더 짧음'})`,
  )
  if (durF) findings.push(durF)

  // ── 제목 길이 ──
  const titleF = contrastNumeric(
    'titleLength',
    winners.map((r) => r.title?.trim().length ?? 0).filter((n) => n > 0),
    baseline.map((r) => r.title?.trim().length ?? 0).filter((n) => n > 0),
    (w, b, longer) => `제목 길이 — 잘된 쪽 약 ${Math.round(w)}자, 평소 약 ${Math.round(b)}자 (${longer ? '더 김' : '더 짧음'})`,
  )
  if (titleF) findings.push(titleF)

  // 차이가 큰 것부터. 같으면 근거가 많은 것부터.
  //
  // 크기는 lift가 아니라 **효과 크기**로 잰다. "0.55배(45% 더 짧음)"는 "2배 더 김"과
  // 같은 세기의 신호인데, lift로 정렬하면 1보다 작은 값이 전부 맨 뒤로 밀려
  // "짧게 만들라"는 발견이 화면 밖으로 나간다.
  findings.sort((a, b) => (effectSize(b) - effectSize(a)) || (b.winnerCount - a.winnerCount))

  return {
    winners: wN,
    baseline: bN,
    findings,
    basisText,
    insufficientReason: findings.length === 0
      ? '잘된 게시물과 평소 게시물 사이에서 뚜렷한 차이를 찾지 못했습니다. 형식·요일·시간대·소재·길이가 비슷합니다.'
      : null,
  }
}
