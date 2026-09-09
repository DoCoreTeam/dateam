/**
 * 이상 조항 실행기 (설계서 3.8.1)
 *
 * ## 이 파일에는 규칙 값이 없다
 *
 * 임계 배수도 사전도 노임단가도 전부 **인자로 받는다.** 코드에 박으면
 * 관리자가 못 고치고, 못 고치면 규칙이 곧 낡는다. 실행기는 «어떻게 재나» 만 안다.
 *
 * ## 「특정 업체에 유리하다」고 쓰지 않는다
 *
 * 명예훼손 위험이 실제로 있다. 우리가 쓸 수 있는 말은 **관측된 사실**이다 —
 * 「상표가 적혀 있고 동등 이상 문구가 없다」, 「공고 기간이 20일이다」.
 * 그 사실로 무엇을 판단할지는 사람 몫이다.
 */

import type { AnomalyRule, AnomalyGrade, AnomalySeverity, RuleId } from './rules.ts'

export interface AnomalyEvidence {
  blockId: string
  quote: string
  pageNo: number | null
}

export interface Anomaly {
  ruleId: RuleId
  title: string
  grade: AnomalyGrade
  severity: AnomalySeverity
  /** 관측된 사실만 적는다. 판단하는 문장을 쓰지 않는다 */
  rationale: string
  evidence: AnomalyEvidence[]
}

export interface DocBlock {
  blockId: string
  text: string
  pageNo: number | null
}

/** 실행기에 넣는 사실들 — 리포트에서 이미 뽑아 둔 값 */
export interface AnomalyFacts {
  budgetAmount: number | null
  durationMonths: number | null
  noticeDate: string | null
  proposalDeadline: string | null
  /** 계약 방법. 모르면 협상계약으로 본다(가장 긴 기간이라 안전한 쪽) */
  noticeKind: 'general' | 'negotiated' | 'urgent' | 'rebid'
  requirementCount: number | null
  /** 요구 실적 건수와 금액 */
  requiredRecordCount: number | null
  requiredRecordAmount: number | null
  requiredCapital: number | null
  requiredRevenue: number | null
  /** 등급별 인원 × 개월 */
  manMonths: Record<string, number>
  /** 문서에서 발견된 금액들 — 상충 검사에 쓴다 */
  amountMentions: { amount: number; blockId: string }[]
}

export function emptyFacts(): AnomalyFacts {
  return {
    budgetAmount: null, durationMonths: null, noticeDate: null, proposalDeadline: null,
    noticeKind: 'negotiated', requirementCount: null,
    requiredRecordCount: null, requiredRecordAmount: null,
    requiredCapital: null, requiredRevenue: null,
    manMonths: {}, amountMentions: [],
  }
}

/** 문장으로 자른다 — 「동등 이상」을 몇 문장 안에서 찾을지 세려면 필요하다 */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.。!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** 규칙 하나를 돌린다. 안 걸리면 빈 배열 */
export function runRule(rule: AnomalyRule, blocks: readonly DocBlock[], facts: AnomalyFacts): Anomaly[] {
  if (!rule.enabled) return []
  switch (rule.id) {
    case 'R01': return runBrand(rule, blocks)
    case 'R02': return runSpec(rule, blocks)
    case 'R03': return runNoticePeriod(rule, facts)
    case 'R04': return runRecords(rule, facts)
    case 'R05': return runCapital(rule, facts)
    case 'R06': return runLabor(rule, facts)
    case 'R07': return runDeliverables(rule, facts)
    case 'R08': case 'R12': return runPatterns(rule, blocks)
    case 'R09': return runPenalty(rule, blocks)
    case 'R10': return runConflict(rule, facts)
    case 'R11': return runCertifications(rule, blocks)
  }
}

export function runAll(rules: readonly AnomalyRule[], blocks: readonly DocBlock[], facts: AnomalyFacts): Anomaly[] {
  return rules.flatMap((r) => runRule(r, blocks, facts))
}

function hit(rule: AnomalyRule, rationale: string, evidence: AnomalyEvidence[]): Anomaly {
  return { ruleId: rule.id, title: rule.title, grade: rule.grade, severity: rule.severity, rationale, evidence }
}

// R01 특정 상표

function runBrand(rule: AnomalyRule, blocks: readonly DocBlock[]): Anomaly[] {
  const brands = (rule.params.brandDictionary as string[]) ?? []
  const phrases = (rule.params.equivalencePhrases as string[]) ?? []
  const window = Number(rule.params.windowSentences ?? 2)
  const out: Anomaly[] = []

  for (const b of blocks) {
    const sents = sentences(b.text)
    for (let i = 0; i < sents.length; i++) {
      const found = brands.find((br) => sents[i].toLowerCase().includes(br.toLowerCase()))
      if (!found) continue
      // 앞뒤 몇 문장 안에 「동등 이상」이 있으면 문제가 아니다
      const near = sents.slice(Math.max(0, i - window), i + window + 1).join(' ')
      if (phrases.some((p) => near.includes(p))) continue
      out.push(hit(rule, `상표 「${found}」가 적혀 있고 앞뒤 ${window}문장 안에 동등 이상 문구가 없다`,
        [{ blockId: b.blockId, quote: sents[i], pageNo: b.pageNo }]))
    }
  }
  return out
}

// R02 고유 규격

function runSpec(rule: AnomalyRule, blocks: readonly DocBlock[]): Anomaly[] {
  const min = Number(rule.params.minSpecTokens ?? 3)
  const re = new RegExp(String(rule.params.specPattern ?? ''), 'gi')
  const out: Anomaly[] = []
  for (const b of blocks) {
    for (const s of sentences(b.text)) {
      const n = (s.match(re) ?? []).length
      if (n >= min) {
        out.push(hit(rule, `한 문장에 규격 수치가 ${n}개 모여 있다`,
          [{ blockId: b.blockId, quote: s, pageNo: b.pageNo }]))
      }
    }
  }
  return out
}

// R03 법정 공고 기간

function runNoticePeriod(rule: AnomalyRule, facts: AnomalyFacts): Anomaly[] {
  if (!facts.noticeDate || !facts.proposalDeadline) return []
  const days = (Date.parse(facts.proposalDeadline) - Date.parse(facts.noticeDate)) / 86_400_000
  if (Number.isNaN(days)) return []
  const required = Number((rule.params as Record<string, unknown>)[facts.noticeKind] ?? 0)
  if (!required || days >= required) return []
  // 「위법」이라 쓰지 않는다. 숫자만 적는다
  return [hit(rule, `공고일부터 마감까지 ${days.toFixed(0)}일이고 ${facts.noticeKind} 기준은 ${required}일이다`, [])]
}

// R04 실적

function runRecords(rule: AnomalyRule, facts: AnomalyFacts): Anomaly[] {
  const out: Anomaly[] = []
  const maxCount = Number(rule.params.maxRecordCount ?? 3)
  const maxRatio = Number(rule.params.maxSingleRecordRatio ?? 1)

  if (facts.requiredRecordCount !== null && facts.requiredRecordCount > maxCount) {
    out.push(hit(rule, `유사 실적을 ${facts.requiredRecordCount}건 요구하고 기준은 ${maxCount}건이다`, []))
  }
  if (facts.requiredRecordAmount !== null && facts.budgetAmount) {
    const ratio = facts.requiredRecordAmount / facts.budgetAmount
    if (ratio > maxRatio) {
      out.push(hit(rule, `단일 실적 요구액이 사업 예산의 ${(ratio * 100).toFixed(0)}%다`, []))
    }
  }
  return out
}

// R05 자본금과 매출

function runCapital(rule: AnomalyRule, facts: AnomalyFacts): Anomaly[] {
  if (!facts.budgetAmount) return []
  const out: Anomaly[] = []
  const capRatio = Number(rule.params.maxCapitalRatio ?? 0.5)
  const revRatio = Number(rule.params.maxRevenueRatio ?? 2)

  if (facts.requiredCapital !== null && facts.requiredCapital > facts.budgetAmount * capRatio) {
    out.push(hit(rule, `요구 자본금이 예산의 ${(facts.requiredCapital / facts.budgetAmount * 100).toFixed(0)}%다`, []))
  }
  if (facts.requiredRevenue !== null && facts.requiredRevenue > facts.budgetAmount * revRatio) {
    out.push(hit(rule, `요구 매출이 예산의 ${(facts.requiredRevenue / facts.budgetAmount * 100).toFixed(0)}%다`, []))
  }
  return out
}

// R06 인력 대비 예산

function runLabor(rule: AnomalyRule, facts: AnomalyFacts): Anomaly[] {
  if (!facts.budgetAmount) return []
  const rates = (rule.params.laborRateKrwPerMonth as Record<string, number>) ?? {}
  const max = Number(rule.params.maxLaborCostRatio ?? 1.1)

  let cost = 0
  for (const [grade, months] of Object.entries(facts.manMonths)) {
    cost += (rates[grade] ?? 0) * months
  }
  if (cost === 0) return []
  const ratio = cost / facts.budgetAmount
  if (ratio <= max) return []
  // 계산 근거를 문장에 적는다 — 숫자만 보여 주면 아무도 못 따라온다
  return [hit(rule,
    `요구 인력을 노임단가로 환산하면 ${Math.round(cost).toLocaleString()}원이고 예산의 ${(ratio * 100).toFixed(0)}%다`, [])]
}

// R07 기간 대비 산출물

function runDeliverables(rule: AnomalyRule, facts: AnomalyFacts): Anomaly[] {
  if (!facts.requirementCount || !facts.durationMonths) return []
  const fallback = Number(rule.params.fallbackRequirementsPerMonth ?? 12)
  const mult = Number(rule.params.multiplier ?? 2)
  const perMonth = facts.requirementCount / facts.durationMonths
  if (perMonth <= fallback * mult) return []
  return [hit(rule,
    `요구사항 ${facts.requirementCount}건을 ${facts.durationMonths}개월로 나누면 월 ${perMonth.toFixed(1)}건이고 기준은 월 ${fallback * mult}건이다`, [])]
}

// R08 R12 문구 규칙

function runPatterns(rule: AnomalyRule, blocks: readonly DocBlock[]): Anomaly[] {
  const patterns = (rule.params.patterns as string[]) ?? []
  const out: Anomaly[] = []
  for (const b of blocks) {
    for (const s of sentences(b.text)) {
      const p = patterns.find((x) => new RegExp(x).test(s))
      if (p) out.push(hit(rule, `문구가 발견됐다`, [{ blockId: b.blockId, quote: s, pageNo: b.pageNo }]))
    }
  }
  return out
}

// R09 지체상금

function runPenalty(rule: AnomalyRule, blocks: readonly DocBlock[]): Anomaly[] {
  const out = runPatterns(rule, blocks)
  const maxDelay = Number(rule.params.maxDelayRate ?? 0.0025)
  for (const b of blocks) {
    for (const s of sentences(b.text)) {
      const m = s.match(/지체상금.{0,20}?(\d+(?:\.\d+)?)\s*(%|퍼센트|천분의\s*\d+)/)
      if (!m) continue
      const rate = s.includes('천분의')
        ? Number(s.match(/천분의\s*(\d+)/)?.[1] ?? 0) / 1000
        : Number(m[1]) / 100
      if (rate > maxDelay) {
        out.push(hit(rule, `지체상금률이 ${(rate * 100).toFixed(2)}%이고 기준은 ${(maxDelay * 100).toFixed(2)}%다`,
          [{ blockId: b.blockId, quote: s, pageNo: b.pageNo }]))
      }
    }
  }
  return out
}

// R10 상충 기재

function runConflict(rule: AnomalyRule, facts: AnomalyFacts): Anomaly[] {
  if (facts.budgetAmount === null || facts.amountMentions.length === 0) return []
  const tol = Number(rule.params.amountTolerance ?? 0.01)
  const different = facts.amountMentions.filter((m) =>
    Math.abs(m.amount - facts.budgetAmount!) / Math.max(1, facts.budgetAmount!) > tol)
  if (different.length === 0) return []
  return [hit(rule,
    `총액 ${facts.budgetAmount.toLocaleString()}원과 다른 금액이 ${different.length}곳에 있다`,
    different.map((d) => ({ blockId: d.blockId, quote: `${d.amount.toLocaleString()}원`, pageNo: null })))]
}

// R11 특정 인증

function runCertifications(rule: AnomalyRule, blocks: readonly DocBlock[]): Anomaly[] {
  const certs = (rule.params.certifications as string[]) ?? []
  const out: Anomaly[] = []
  for (const b of blocks) {
    for (const s of sentences(b.text)) {
      const found = certs.find((c) => s.includes(c))
      if (found) {
        out.push(hit(rule, `참가 자격에 「${found}」가 적혀 있다`,
          [{ blockId: b.blockId, quote: s, pageNo: b.pageNo }]))
      }
    }
  }
  return out
}

/** 같은 규칙이 같은 자리를 여러 번 잡으면 하나로 접는다 */
export function dedupe(list: readonly Anomaly[]): Anomaly[] {
  const seen = new Set<string>()
  const out: Anomaly[] = []
  for (const a of list) {
    const key = `${a.ruleId}|${a.evidence.map((e) => e.blockId + e.quote).join('|')}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(a)
  }
  return out
}
