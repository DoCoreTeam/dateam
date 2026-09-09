/**
 * 나라장터 낙찰과 계약 (설계서 3.2.3, F7)
 *
 * ## 이 데이터가 학습의 정답지다
 *
 * 「우리 판정이 맞았나」는 **낙찰 결과가 있어야** 답할 수 있다.
 * 적합도 70점을 준 사업에서 우리가 떨어지고 50점 준 사업에서 붙었다면
 * 가중치가 틀린 것이다. 그 비교를 하려면 결과가 쌓여 있어야 한다.
 *
 * ## 우리 참여 여부를 이름으로 판단한다
 *
 * 나라장터는 「누가 얼마에 따갔나」를 준다. 그중 우리가 있는지는 **회사 이름으로** 본다.
 * 이름 표기가 흔들리므로(「(주)」 「주식회사」) 비교 전에 편다.
 *
 * ## 두 번 수집해도 한 행이다
 *
 * 크론이 같은 공고를 여러 번 훑는다. 그때마다 행이 늘면
 * 「몇 건 이겼나」가 부풀고, 그 숫자로 가중치를 보정하면 조용히 틀린다.
 */

export interface AwardBidder {
  /** 업체 이름 */
  name: string
  /** 사업자등록번호. 있으면 이름보다 정확하다 */
  bizNo: string | null
  amount: number | null
  /** 순위. 낙찰자는 1 */
  rank: number | null
  /** 낙찰자인가 */
  won: boolean
}

export interface AwardInfo {
  noticeNo: string
  /** 낙찰 업체 */
  winner: AwardBidder | null
  bidders: AwardBidder[]
  contractAmount: number | null
  awardedAt: string | null
  /** 유찰·취소면 낙찰자가 없다 */
  cancelled: boolean
}

/** 회사 이름을 비교하기 좋게 편다 — 「(주)」 「주식회사」 표기가 흔들린다 */
export function normalizeCompany(name: string): string {
  return name
    .replace(/\(주\)|㈜|주식회사|유한회사|합자회사|재단법인|사단법인|\(재\)|\(사\)/g, '')
    .replace(/[\s.,·]/g, '')
    .toLowerCase()
}

/** 우리 회사가 이 목록에 있나 — 사업자번호가 있으면 그것을 먼저 본다 */
export function findUs(
  bidders: readonly AwardBidder[],
  us: { name: string; bizNo: string | null },
): AwardBidder | null {
  if (us.bizNo) {
    const byNo = bidders.find((b) => b.bizNo && b.bizNo.replace(/\D/g, '') === us.bizNo!.replace(/\D/g, ''))
    if (byNo) return byNo
  }
  const target = normalizeCompany(us.name)
  if (!target) return null
  return bidders.find((b) => normalizeCompany(b.name) === target) ?? null
}

export type OutcomeResult = 'won' | 'lost' | 'cancelled' | 'unknown'

export interface OutcomeRow {
  caseId: string
  /** 우리가 냈나 — 목록에 있으면 냈다 */
  submitted: boolean
  result: OutcomeResult
  awardedTo: string | null
  awardedAmount: number | null
  /** 우리 순위. 안 냈으면 null */
  ourRank: number | null
  source: 'g2b'
}

/**
 * 낙찰 정보를 결과 행으로 옮긴다.
 *
 * **참여 여부와 순위를 구분한다** — 안 낸 것과 내고 떨어진 것은 다른 사실이고,
 * 학습에서 다르게 쓰인다(안 낸 것은 판정 정확도의 증거가 아니다).
 */
export function toOutcome(
  caseId: string,
  award: AwardInfo,
  us: { name: string; bizNo: string | null },
): OutcomeRow {
  const ours = findUs(award.bidders, us)
  const submitted = ours !== null

  let result: OutcomeResult = 'unknown'
  if (award.cancelled) result = 'cancelled'
  else if (ours?.won) result = 'won'
  else if (submitted) result = 'lost'
  else if (award.winner) result = 'lost'   // 우리가 안 냈고 남이 따갔다

  return {
    caseId,
    submitted,
    result,
    awardedTo: award.winner?.name ?? null,
    awardedAmount: award.contractAmount ?? award.winner?.amount ?? null,
    // 안 냈으면 순위가 없다. 0 으로 두면 「1등 아님」과 섞인다
    ourRank: ours?.rank ?? null,
    source: 'g2b',
  }
}

/** 응답을 낙찰 정보로 옮긴다 */
export function toAwardInfo(rows: readonly Record<string, unknown>[]): AwardInfo | null {
  if (rows.length === 0) return null
  const first = rows[0]
  const noticeNo = String(first.bidNtceNo ?? '').trim()
  if (!noticeNo) return null

  const bidders: AwardBidder[] = rows.map((r) => ({
    name: String(r.prcbdrNm ?? r.bidwinnrNm ?? '').trim(),
    bizNo: strOrNull(r.bizno ?? r.prcbdrBizno),
    amount: amountOf(r.bidprcAmt ?? r.sucsfbidAmt),
    rank: intOrNull(r.opengRank ?? r.rank),
    won: String(r.sucsfbidYn ?? '').toUpperCase() === 'Y' || intOrNull(r.opengRank ?? r.rank) === 1,
  })).filter((b) => b.name)

  const winner = bidders.find((b) => b.won) ?? null
  const cancelled = rows.some((r) => /유찰|취소|중止|중지/.test(String(r.bidNtceSttusNm ?? '')))

  return {
    noticeNo,
    winner,
    bidders,
    contractAmount: amountOf(first.sucsfbidAmt ?? first.cntrctAmt) ?? winner?.amount ?? null,
    awardedAt: strOrNull(first.opengDt ?? first.cntrctDt),
    cancelled,
  }
}

function strOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s || null
}

function intOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const n = Number(String(v).trim())
  return Number.isInteger(n) ? n : null
}

function amountOf(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const n = Number(String(v).replace(/[\s,원]/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * 결과 행을 DB 모양으로.
 *
 * `case_id` 에 유니크가 걸려 있어 두 번 넣어도 한 행이다 —
 * 그 유니크가 「몇 건 이겼나」가 부풀지 않게 막는다.
 */
export function toDbOutcome(row: OutcomeRow, orgId: string): Record<string, unknown> {
  return {
    org_id: orgId,
    case_id: row.caseId,
    submitted: row.submitted,
    result: row.result,
    awarded_to: row.awardedTo,
    awarded_amount: row.awardedAmount,
    our_rank: row.ourRank,
    source: row.source,
  }
}

/**
 * 사람이 적은 값을 자동 수집이 덮지 않게 고칠 칸만 고른다.
 *
 * 담당자가 「우리는 안 냈다」고 적어 뒀는데 크론이 그것을 뒤집으면
 * 그 사람은 다시는 이 화면을 안 믿는다.
 */
export function mergeWithManual(
  existing: { source: string; submitted: boolean | null; decision: string | null } | null,
  fresh: OutcomeRow,
): Record<string, unknown> {
  const base = {
    result: fresh.result,
    awarded_to: fresh.awardedTo,
    awarded_amount: fresh.awardedAmount,
    our_rank: fresh.ourRank,
    source: 'g2b',
  }
  // 사람이 적은 행이면 참여 여부와 결정은 그대로 둔다
  if (existing && existing.source === 'manual') return base
  return { ...base, submitted: fresh.submitted }
}
