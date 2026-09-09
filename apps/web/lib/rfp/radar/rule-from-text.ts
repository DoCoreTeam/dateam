/**
 * 말로 조건 만들기 — 「AI 관련 3억 이상 공공기관 사업」 → 찾을 조건 (사용자 개입)
 *
 * ## 왜 폼이 아닌가
 *
 * 조건 이름·키워드·발주 기관·예산 하한·예산 상한을 각각 채우라는 것은
 * **사용자에게 표처럼 생각하라**는 요구다. 사람은 「AI 관련 3억 이상 공공기관 사업」이라고
 * 말하지, 그것을 다섯 칸으로 쪼개서 말하지 않는다.
 *
 * ## 규칙이 먼저 풀고 AI 는 남은 것만
 *
 * 금액은 정규식이 확실하게 푼다 — 「3억 이상」의 뜻은 안 흔들린다. AI 에게 맡기면
 * 3억을 300,000,000 으로 쓸지 3으로 쓸지가 회차마다 달라진다.
 * 키워드와 기관처럼 뜻을 알아야 하는 것만 AI 가 푼다.
 *
 * ## 결과는 사람이 확인한다
 *
 * 정형화한 결과를 그대로 저장하지 않는다. 화면에 채워 놓고 사람이 고친 뒤 저장한다 —
 * 조건이 틀리면 그 뒤 모든 알림이 틀리고, 사용자는 「레이더가 이상하다」로만 느낀다.
 */

import { recoverJson, asJsonRecord } from '../../ai/json-recover.ts'

export interface RuleDraft {
  name: string
  keywords: string[]
  agencies: string[]
  budgetMin: number | null
  budgetMax: number | null
}

export const EMPTY_DRAFT: RuleDraft = {
  name: '', keywords: [], agencies: [], budgetMin: null, budgetMax: null,
}

const EOK = 100_000_000
const MAN = 10_000

/** 「3억」·「5천만」·「12억 5천」 → 원 단위 숫자 */
export function parseKrw(raw: string): number | null {
  const t = raw.replace(/[\s,]/g, '')
  if (!t) return null

  const eok = t.match(/([0-9.]+)억/)
  const cheon = t.match(/([0-9.]+)천만/)
  const man = t.match(/([0-9.]+)만(?!원?\s*이)/)

  let total = 0
  let hit = false
  if (eok) { total += Number(eok[1]) * EOK; hit = true }
  if (cheon) { total += Number(cheon[1]) * 1000 * MAN; hit = true }
  else if (man) { total += Number(man[1]) * MAN; hit = true }
  if (hit) return Math.round(total)

  // 단위 없는 순수 숫자는 원 단위로 본다 — 「300000000 이상」처럼 적는 사람이 있다
  const plain = t.match(/^([0-9]{4,})원?/)
  return plain ? Number(plain[1]) : null
}

/**
 * 문장에서 예산 범위를 뽑는다.
 *
 * 「이상」·「넘는」은 하한, 「이하」·「미만」은 상한, 「A~B」는 둘 다.
 * 못 찾으면 둘 다 null — 억지로 추측하면 조건이 조용히 좁아진다.
 */
export function parseBudgetRange(text: string): { min: number | null; max: number | null } {
  // ① 범위 표기가 먼저다. 「3억~10억」에서 「3억 이상」만 잡으면 상한을 잃는다
  const range = text.match(/([0-9.,]+\s*(?:억|천만|만)?원?)\s*(?:~|-|부터|에서)\s*([0-9.,]+\s*(?:억|천만|만)?원?)/)
  if (range) {
    const lo = parseKrw(range[1])
    const hi = parseKrw(range[2])
    if (lo !== null || hi !== null) return { min: lo, max: hi }
  }

  let min: number | null = null
  let max: number | null = null

  const RE = /([0-9.,]+\s*(?:억|천만|만)?원?)\s*(이상|넘는|초과|이하|미만|밑|아래)/g
  for (let m = RE.exec(text); m !== null; m = RE.exec(text)) {
    const amount = parseKrw(m[1])
    if (amount === null) continue
    if (/이상|넘는|초과/.test(m[2])) min = amount
    else max = amount
  }

  return { min, max }
}

/** 규칙이 확실히 푸는 것 — 금액뿐이다. 나머지는 뜻을 알아야 한다 */
export function draftByRules(text: string): RuleDraft {
  const { min, max } = parseBudgetRange(text)
  return { ...EMPTY_DRAFT, budgetMin: min, budgetMax: max }
}

/** AI 에게 아직 안 풀린 것만 묻는다 */
export function unfilledParts(d: RuleDraft): string[] {
  const out: string[] = []
  if (!d.name.trim()) out.push('name')
  if (d.keywords.length === 0) out.push('keywords')
  if (d.agencies.length === 0) out.push('agencies')
  if (d.budgetMin === null && d.budgetMax === null) out.push('budget')
  return out
}

export function buildRulePrompt(text: string, parts: readonly string[]): string {
  return [
    '아래는 어떤 입찰 공고를 찾고 싶은지 사람이 말한 것이다. 이것을 검색 조건으로 바꾼다.',
    `채울 것: ${parts.join(', ')}`,
    '',
    '지켜야 할 규칙',
    '1. 말에 없는 조건을 만들지 않는다. 없으면 빈 배열이나 null 로 둔다',
    '2. keywords 는 공고 제목에 실제로 나올 만한 낱말로 적는다 (「관련」·「사업」 같은 군더더기는 뺀다)',
    '3. agencies 는 발주 기관 이름이다. 「공공기관」처럼 범주를 말하면 빈 배열로 둔다',
    '4. 금액은 원 단위 정수로 적는다 (3억 = 300000000)',
    '5. name 은 목록에서 알아볼 짧은 이름이다 (20자 이내)',
    '',
    '아래 JSON 하나만 답한다. 다른 말을 덧붙이지 않는다.',
    '{ "name": "", "keywords": [], "agencies": [], "budgetMin": null, "budgetMax": null }',
    '',
    '사람이 한 말',
    text,
  ].join('\n')
}

/** 키워드가 너무 많으면 조건이 넓어져 알림이 소음이 된다 */
export const MAX_KEYWORDS = 20

export function parseRuleDraft(text: string): Partial<RuleDraft> {
  let parsed: unknown
  try {
    parsed = recoverJson(text)
  } catch {
    return {}
  }
  const b = asJsonRecord(parsed)
  const out: Partial<RuleDraft> = {}
  const name = str(b.name)
  if (name) out.name = name.slice(0, 60)
  const keywords = strList(b.keywords).slice(0, MAX_KEYWORDS)
  if (keywords.length > 0) out.keywords = keywords
  const agencies = strList(b.agencies)
  if (agencies.length > 0) out.agencies = agencies
  const min = num(b.budgetMin)
  if (min !== null) out.budgetMin = min
  const max = num(b.budgetMax)
  if (max !== null) out.budgetMax = max
  return out
}

/** 규칙이 푼 금액은 AI 가 안 덮는다 — 확실한 것을 추측으로 바꾸는 셈이다 */
export function mergeRuleDraft(rules: RuleDraft, ai: Partial<RuleDraft>, fallbackName = ''): RuleDraft {
  const merged: RuleDraft = {
    // 이름이 없으면 사람이 한 말을 쓰되 짧게 자른다 — 목록에서 한 줄로 보여야 한다
    name: rules.name || ai.name || shortName(fallbackName),
    keywords: rules.keywords.length > 0 ? rules.keywords : (ai.keywords ?? []),
    agencies: rules.agencies.length > 0 ? rules.agencies : (ai.agencies ?? []),
    budgetMin: rules.budgetMin ?? ai.budgetMin ?? null,
    budgetMax: rules.budgetMax ?? ai.budgetMax ?? null,
  }
  // 하한이 상한보다 크면 둘 다 못 믿는다 — 그대로 두면 늘 0건이 되고 이유가 안 보인다
  if (merged.budgetMin !== null && merged.budgetMax !== null && merged.budgetMin > merged.budgetMax) {
    return { ...merged, budgetMin: merged.budgetMax, budgetMax: merged.budgetMin }
  }
  return merged
}

/** 목록 한 줄에 들어갈 길이로 자른다 */
export function shortName(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ')
  return t.length <= 24 ? t : `${t.slice(0, 24)}…`
}

/**
 * AI 없이도 최소한은 만든다.
 *
 * 키가 없거나 모델이 죽어도 「아무것도 안 됨」이 되면 안 된다 —
 * 말에서 낱말을 뽑아 키워드로 쓰면 대충은 걸린다.
 */
export function keywordsFallback(text: string): string[] {
  const STOP = new Set([
    '관련', '사업', '공고', '입찰', '이상', '이하', '미만', '초과', '넘는', '찾아줘', '찾아',
    '해줘', '알려줘', '있는', '하는', '되는', '것', '거', '좀', '전부', '모두', '모든',
  ])
  return Array.from(new Set(
    text
      .replace(/[0-9.,]+\s*(?:억|천만|만)?원?/g, ' ')
      .split(/[\s,·、]+/)
      .map((w) => w.replace(/[^가-힣A-Za-z0-9]/g, '').trim())
      .filter((w) => w.length >= 2 && !STOP.has(w)),
  )).slice(0, 6)
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}
function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v)
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v.replace(/[^0-9]/g, ''))
    return Number.isFinite(n) && n > 0 ? n : null
  }
  return null
}
function strList(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => (x as string).trim())
    : []
}
