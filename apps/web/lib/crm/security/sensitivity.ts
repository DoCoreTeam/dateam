/**
 * 필드 민감도 레지스트리 (SSOT) — 화면·API·내보내기 셋이 같은 표를 읽는다
 *
 * **왜 한 곳인가**: 등급을 화면마다 정하면 새 화면이 생길 때마다 빠뜨린다.
 * 그리고 빠뜨린 곳은 **원가가 실려 나간 뒤에야** 발견된다.
 *
 * **왜 지금 거는가**: 검사를 나중에 넣으면 «원가가 실려 나간 API»를 전수로 찾아야 하고
 * 그건 사실상 못 한다. 처음부터 검사해 두는 것이 유일한 안전한 순서다.
 *
 * **무엇이 민감한가는 계산으로 판정한다** — 기준 하나:
 * <mark>이 값으로 원가·단가를 역산할 수 있는가.</mark>
 * 그래서 현물 «합계»는 internal 이고 «명세»는 restricted 다 —
 * «연구원 3명 × 참여율 50% × 24개월 = 1.8억» 이 보이면 1인 연봉이 역산된다.
 *
 * **나중에 푸는 것은 표 한 줄이다.** VISIBILITY_POLICY 에 역할을 더하면 된다.
 */

/** 민감 등급 — 셋뿐이다. 늘리면 판정이 흐려진다 */
export type Sensitivity = 'public' | 'internal' | 'restricted'

/** 능력(capability) — 역할을 늘리지 않고 능력을 사람마다 더하거나 뺀다 */
export type Capability =
  | 'cost.view'
  | 'cost.edit'
  | 'margin.view'
  | 'quote.send'
  | 'quote.approve'

export const ALL_CAPABILITIES: readonly Capability[] = [
  'cost.view', 'cost.edit', 'margin.view', 'quote.send', 'quote.approve',
]

/**
 * 필드 → 등급.
 *
 * 키는 `표.필드` 다. 표 이름은 도메인 이름을 쓴다(prisma 모델이 아니라) —
 * 화면·API·내보내기가 같은 말을 써야 대조가 된다.
 */
export const FIELD_SENSITIVITY: Readonly<Record<string, Sensitivity>> = {
  // ── 견적서에 실리는 것 — 고객이 본다
  'quoteLine.name': 'public',
  'quoteLine.quantity': 'public',
  'quoteLine.unitPriceMinor': 'public',
  'quoteLine.lineTotalMinor': 'public',
  'quote.netMinor': 'public',
  'quote.proposedNetMinor': 'public',
  'quote.taxMinor': 'public',
  'quote.grossMinor': 'public',
  'quote.validUntil': 'public',
  'quote.footnotes': 'public',

  // ── 우리 장부 — CRM 멤버 전원
  'deal.budgetNetMinor': 'internal',
  'deal.quotedNetMinor': 'internal',
  'deal.contractNetMinor': 'internal',
  'deal.bookedNetMinor': 'internal',
  'deal.inKindTotalMinor': 'internal',   // 합계는 역산이 안 된다
  'deal.exInKindMinor': 'internal',
  'deal.termType': 'internal',
  'deal.stageId': 'internal',
  'fundingSource.amountMinor': 'internal',
  'fundingSource.sourceType': 'internal',

  // ── 관리자만 — 원가·단가를 역산할 수 있는 값
  'inKind.valueMinor': 'restricted',     // 명세는 인건비 단가를 역산할 수 있다
  'inKind.quantity': 'restricted',
  'inKind.basisNote': 'restricted',
  'quoteLine.costMinor': 'restricted',
  'quoteLine.costFxRate': 'restricted',
  'quote.marginPct': 'restricted',
  'quote.grossProfitMinor': 'restricted',
  'quoteNode.costMinor': 'restricted',
  'quoteNode.profitMinor': 'restricted',
  'quoteNode.profitPct': 'restricted',
  'quoteNode.contributionPp': 'restricted',
  'quoteNode.sensitivityJson': 'restricted',
  'quoteNode.breakEvenJson': 'restricted',
  'dealCost.amountMinor': 'restricted',
  'dealCost.inputValue': 'restricted',
  'costElement.defaultValue': 'restricted',
  'costBaseline.monthlyFixedCostMinor': 'restricted',
  'costBaseline.hourlyCostMinor': 'restricted',
  'costBaseline.utilizationPct': 'restricted',
  'laborGrade.costPerMmMinor': 'restricted',
  'partnerTier.discountPct': 'restricted',
  'supplyQuote.unitPriceUsd': 'restricted',
  'supplyQuote.evidenceDriveFileId': 'restricted',
  'competitor.priceMinor': 'restricted',
}

/**
 * 등급 → 그 등급을 볼 수 있는 역할.
 *
 * **지금은 restricted 가 관리자뿐이다.** 나중에 «영업팀장도 마진은 본다»가 되면
 * 여기에 역할을 하나 더한다 — 코드는 안 고친다.
 */
export const VISIBILITY_POLICY: Readonly<Record<Sensitivity, readonly string[]>> = {
  public: ['OWNER', 'ADMIN', 'MEMBER', 'READONLY'],
  internal: ['OWNER', 'ADMIN', 'MEMBER', 'READONLY'],
  restricted: ['OWNER', 'ADMIN'],
}

/** 역할이 기본으로 갖는 능력. 사람마다 더하거나 뺄 수 있다 */
export const ROLE_CAPABILITIES: Readonly<Record<string, readonly Capability[]>> = {
  OWNER: ['cost.view', 'cost.edit', 'margin.view', 'quote.send', 'quote.approve'],
  ADMIN: ['cost.view', 'cost.edit', 'margin.view', 'quote.send', 'quote.approve'],
  MEMBER: ['quote.send'],
  READONLY: [],
}

export interface Viewer {
  role: string
  /** 역할 기본값에 더하는 능력 */
  capabilities?: readonly Capability[]
}

export function sensitivityOf(field: string): Sensitivity {
  // 등재되지 않은 필드는 **restricted 로 본다**.
  // 모르는 것을 public 으로 두면 새 필드가 조용히 새어 나간다.
  return FIELD_SENSITIVITY[field] ?? 'restricted'
}

export function canView(viewer: Viewer | null | undefined, field: string): boolean {
  if (!viewer) return false
  const level = sensitivityOf(field)
  if (level === 'restricted') {
    // 능력으로 개별 부여받았으면 역할과 무관하게 통과한다
    if (viewer.capabilities?.includes('cost.view')) return true
  }
  return VISIBILITY_POLICY[level].includes(viewer.role)
}

export function capabilitiesOf(viewer: Viewer | null | undefined): readonly Capability[] {
  if (!viewer) return []
  const base = ROLE_CAPABILITIES[viewer.role] ?? []
  const extra = viewer.capabilities ?? []
  return Array.from(new Set([...base, ...extra]))
}

export function hasCapability(viewer: Viewer | null | undefined, cap: Capability): boolean {
  return capabilitiesOf(viewer).includes(cap)
}

/**
 * 응답에서 등급 미달 필드를 **제거한다**. 가리는 것이 아니라 뺀다 —
 * 가리면 값이 여전히 전선을 타고 나가고, 브라우저 도구로 보인다.
 *
 * `prefix` 는 도메인 표 이름이다: `pick(deal, 'deal', viewer)`.
 */
export function pickVisible<T extends Record<string, unknown>>(
  obj: T,
  prefix: string,
  viewer: Viewer | null | undefined,
): Partial<T> {
  const out: Partial<T> = {}
  for (const k of Object.keys(obj) as (keyof T & string)[]) {
    if (canView(viewer, `${prefix}.${k}`)) out[k] = obj[k]
  }
  return out
}

/** 배열용 */
export function pickVisibleAll<T extends Record<string, unknown>>(
  rows: readonly T[],
  prefix: string,
  viewer: Viewer | null | undefined,
): Partial<T>[] {
  return rows.map((r) => pickVisible(r, prefix, viewer))
}

/**
 * 내보내기 필터 — 고객에게 가는 파일에서 원가를 **물리적으로 없앤다**.
 *
 * 권한이 있는 사람이 뽑아도 대외용 파일에는 안 실린다.
 * 숨기는 것이 아니라 **내보내기용 데이터를 따로 만드는** 것이라
 * 엑셀 수식·숨긴 시트에 남는 사고가 구조적으로 불가능하다.
 */
export function stripForExport<T extends Record<string, unknown>>(obj: T, prefix: string): Partial<T> {
  const out: Partial<T> = {}
  for (const k of Object.keys(obj) as (keyof T & string)[]) {
    if (sensitivityOf(`${prefix}.${k}`) === 'public') out[k] = obj[k]
  }
  return out
}
