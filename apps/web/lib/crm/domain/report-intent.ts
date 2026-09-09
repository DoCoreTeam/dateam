/**
 * 자연어 → 리포트 조건 (순수 규칙 파서)
 *
 * **왜 규칙이 먼저인가**: 회사 보강 37건이 전부 할당량 초과로 죽은 적이 있다.
 * 도우미를 모델 한 번에 전부 맡기면 할당량이 막힌 날 도우미가 통째로 없는 기능이 된다.
 * 「이번 분기 파이프라인별 수주」 같은 말은 **모델 없이도 풀린다** — 그것부터 푼다.
 * 모델은 규칙이 못 푼 부분만 맡는다(`app/api/crm/metrics/ask`).
 *
 * **P-1 을 지킨다**: 지표·축의 이름은 여기서 새로 적지 않고 **선언에서 읽는다**.
 * 그래서 지표를 하나 더하면 도우미가 **배포 없이** 그 말을 알아듣는다.
 * 값(「공공」·「제조」)은 코드에 없다 — 그건 데이터에서 찾아야 하므로 **힌트로만** 남긴다.
 *
 * 순수하다 — DB 도 모델도 모른다.
 */

import { METRICS, DERIVED } from './metrics.ts'
import { DIMENSIONS } from './dimensions.ts'
import { periodOfToday, type Period, type PeriodKind, INDEX_MAX } from './target.ts'

/** 시간 축 — 쪼개는 기준 목록에는 없지만 축에는 설 수 있다 */
export const TIME_AXIS_WORDS: { key: string; words: string[] }[] = [
  { key: 'month', words: ['월별', '달별', '월간별'] },
  { key: 'quarter', words: ['분기별'] },
  { key: 'half', words: ['반기별'] },
  { key: 'year', words: ['연별', '연도별', '해마다', '년별'] },
]

/**
 * 우리 말의 별명.
 *
 * **지표 이름 자체는 여기 없다** — `METRICS` 의 `label` 을 그대로 쓴다.
 * 여기 있는 것은 사람이 그 지표를 **다르게 부르는 말**뿐이다.
 */
const METRIC_ALIAS: Record<string, string[]> = {
  bookings: ['수주', '따낸 것', '계약액', '수주액'],
  open_pipeline: ['파이프라인', '열린 딜', '진행 중인 딜'],
  weighted: ['예상', '가중', '전망', '예측'],
  new_deals: ['신규', '새 딜', '새로 들어온'],
  won_count: ['성사', '이긴', '수주 건수'],
  lost_count: ['실주', '진', '놓친'],
  overdue: ['기한', '지연', '밀린'],
  stalled: ['정체', '멈춘', '안 움직'],
  quoted_sum: ['견적'],
  budget_sum: ['예산'],
  contract_sum: ['계약서', '도장'],
  recognized: ['매출', '인식'],
}

export interface ReportIntent {
  metric: string | null
  rows: string | null
  cols: string | null
  period: Period | null
  /** 값으로 걸릴 후보 — **코드가 값을 모르므로** 서버가 실제 축 값과 맞춰 본다 */
  hints: string[]
  /** 규칙이 못 푼 것. 화면이 「이 부분은 못 알아들었어요」라고 말한다 */
  unresolved: string[]
}

export const EMPTY_INTENT: ReportIntent = {
  metric: null, rows: null, cols: null, period: null, hints: [], unresolved: [],
}

/** 공백·조사를 털어 낸 말 — 「분기별로」·「수주가」를 같은 말로 본다 */
function norm(s: string): string {
  return s.replace(/[.,!?·]/g, ' ').replace(/\s+/g, ' ').trim()
}

// ------------------------------------------------------------
// 기간
// ------------------------------------------------------------

const KIND_WORD: { kind: PeriodKind; words: string[] }[] = [
  { kind: 'QUARTER', words: ['분기'] },
  { kind: 'HALF', words: ['반기'] },
  { kind: 'MONTH', words: ['달', '월'] },
  { kind: 'YEAR', words: ['해', '년', '연간'] },
]

const REL_WORD: { delta: number; words: string[] }[] = [
  { delta: 0, words: ['이번', '올', '금', '현재', '이'] },
  { delta: -1, words: ['지난', '작', '전', '저번'] },
  { delta: 1, words: ['다음', '내', '차'] },
]

/** 기간을 한 칸 옮긴다 — 연도 경계를 넘으면 해를 함께 옮긴다 */
function shift(p: Period, delta: number): Period {
  if (delta === 0) return p
  const max = INDEX_MAX[p.kind]
  if (max <= 1) return { ...p, year: p.year + delta }
  const zero = (p.index ?? 1) - 1 + delta
  const year = p.year + Math.floor(zero / max)
  const index = ((zero % max) + max) % max + 1
  return { kind: p.kind, year, index }
}

/**
 * 기간을 읽는다.
 *
 * 「2026년 3분기」처럼 **숫자가 있으면 그게 이긴다** — 상대말(이번·지난)보다 정확하다.
 */
export function parsePeriod(text: string, todayKey: string): Period | null {
  const t = norm(text)
  const year = Number(t.match(/(\d{4})\s*년/)?.[1] ?? 0)

  const q = Number(t.match(/([1-4])\s*분기/)?.[1] ?? 0)
  if (q) return { kind: 'QUARTER', year: year || Number(todayKey.slice(0, 4)), index: q }

  const h = t.match(/(상|하)\s*반기/)?.[1]
  if (h) return { kind: 'HALF', year: year || Number(todayKey.slice(0, 4)), index: h === '상' ? 1 : 2 }

  const mm = Number(t.match(/(\d{1,2})\s*월/)?.[1] ?? 0)
  if (mm >= 1 && mm <= 12) return { kind: 'MONTH', year: year || Number(todayKey.slice(0, 4)), index: mm }

  // 상대말 — 「이번 분기」·「지난달」·「작년」
  for (const k of KIND_WORD) {
    for (const w of k.words) {
      const i = t.indexOf(w)
      if (i < 0) continue
      const before = t.slice(Math.max(0, i - 4), i)
      const rel = REL_WORD.find((r) => r.words.some((rw) => before.includes(rw)))
      if (!rel && !year) continue
      const base = periodOfToday(k.kind, todayKey)
      return year ? { ...base, year } : shift(base, rel?.delta ?? 0)
    }
  }

  if (year) return { kind: 'YEAR', year }
  return null
}

// ------------------------------------------------------------
// 지표·축
// ------------------------------------------------------------

/** 지표를 찾는다 — 선언의 이름이 먼저고, 못 찾으면 별명을 본다 */
export function parseMetric(text: string): string | null {
  const t = norm(text)
  const all = [...METRICS, ...DERIVED]
  // 긴 이름부터 — 「수주 건수」가 「수주」에 먹히면 안 된다
  const byLabel = [...all].sort((a, b) => b.label.length - a.label.length)
  for (const m of byLabel) if (t.includes(m.label)) return m.key
  const entries = Object.entries(METRIC_ALIAS)
    .flatMap(([k, ws]) => ws.map((w) => [k, w] as const))
    .sort((a, b) => b[1].length - a[1].length)
  for (const [key, w] of entries) if (t.includes(w)) return key
  return null
}

/**
 * 축을 찾는다 — 「~별」이 축을 가리키는 표시다.
 *
 * 두 개가 나오면 **먼저 말한 것이 행**이다(사람이 말하는 순서가 곧 보고 싶은 순서다).
 */
export function parseAxes(text: string): { rows: string | null; cols: string | null } {
  const t = norm(text)
  const found: { key: string; at: number }[] = []

  for (const ta of TIME_AXIS_WORDS) {
    for (const w of ta.words) {
      const i = t.indexOf(w)
      if (i >= 0) { found.push({ key: ta.key, at: i }); break }
    }
  }
  for (const d of DIMENSIONS) {
    const i = t.indexOf(`${d.label}별`)
    if (i >= 0) { found.push({ key: d.key, at: i }); continue }
    // 「담당자마다」·「회사 별」처럼 붙지 않은 경우도 받는다
    const j = t.indexOf(`${d.label} 별`)
    if (j >= 0) found.push({ key: d.key, at: j })
  }

  found.sort((a, b) => a.at - b.at)
  const uniq = found.filter((f, i) => found.findIndex((g) => g.key === f.key) === i)
  return { rows: uniq[0]?.key ?? null, cols: uniq[1]?.key ?? null }
}

/**
 * 남은 말 — 값으로 걸릴 후보.
 *
 * **여기서 값을 판정하지 않는다.** 「공공」이 파이프라인 이름인지 산업 이름인지는
 * 데이터만 안다. 그래서 낱말만 넘기고, 실제 축 값과 맞추는 일은 서버가 한다(P-1).
 */
export function parseHints(text: string, used: { metric: string | null; rows: string | null; cols: string | null }): string[] {
  let t = norm(text)
  const all = [...METRICS, ...DERIVED]
  for (const m of all) t = t.split(m.label).join(' ')
  for (const ws of Object.values(METRIC_ALIAS)) for (const w of ws) t = t.split(w).join(' ')
  for (const d of DIMENSIONS) t = t.split(`${d.label}별`).join(' ').split(`${d.label} 별`).join(' ').split(d.label).join(' ')
  for (const ta of TIME_AXIS_WORDS) for (const w of ta.words) t = t.split(w).join(' ')
  t = t.replace(/\d{4}\s*년|\d{1,2}\s*월|[1-4]\s*분기|[상하]\s*반기/g, ' ')
  // 기간을 가리키는 낱말도 턴다 — 「이번 분기」의 「분기」가 남으면 값으로 찾으러 간다
  for (const k of KIND_WORD) for (const w of k.words) t = t.split(w).join(' ')
  t = t.replace(/이번|지난|올해|작년|내년|저번|다음|현재|얼마|보여|알려|줘|해줘|좀|의|를|을|은|는|이|가|로|으로|에서|까지|부터/g, ' ')
  void used
  return t.split(' ').map((w) => w.trim()).filter((w) => w.length >= 2)
}

/** 자연어 한 줄을 조건으로 — 규칙만으로 푼다 */
export function parseReportAsk(text: string, todayKey: string): ReportIntent {
  if (!text.trim()) return EMPTY_INTENT
  const metric = parseMetric(text)
  const { rows, cols } = parseAxes(text)
  const period = parsePeriod(text, todayKey)
  const hints = parseHints(text, { metric, rows, cols })
  const unresolved: string[] = []
  if (!metric) unresolved.push('어느 지표를 볼지')
  if (!period) unresolved.push('어느 기간을 볼지')
  return { metric, rows, cols, period, hints, unresolved }
}

/** 조건을 사람이 읽는 한 줄로 — 실행 전에 「이렇게 이해했습니다」를 보여준다 */
export function describeIntent(
  i: ReportIntent,
  label: (kind: 'metric' | 'dimension', key: string) => string,
  periodText: (p: Period) => string,
): string {
  const parts: string[] = []
  if (i.period) parts.push(periodText(i.period))
  if (i.metric) parts.push(label('metric', i.metric))
  const axes = [i.rows, i.cols].filter(Boolean) as string[]
  if (axes.length > 0) parts.push(`${axes.map((a) => label('dimension', a)).join(' × ')} 로 쪼개서`)
  return parts.join(' · ')
}
