/**
 * 금액 계산 SSOT — 부가세 · 반올림 · 잔차 배분
 *
 * **왜 한 곳인가**: 지금 저장소에 `Math.round|floor|ceil` 호출이 35곳 흩어져 있다.
 * 규칙이 흩어지면 «원가 쪽 반올림»과 «견적 쪽 반올림»이 언젠가 갈리고,
 * 그때 1원씩 안 맞는 문제가 생긴다 — 그건 찾기가 아주 어렵다.
 *
 * **왜 정수(BigInt)인가**: 부동소수로 돈을 더하면 합계가 1원씩 어긋난다.
 * 금액은 전부 minor 단위 정수로 다루고, 비율만 정수 basis point 로 받아
 * **마지막에 한 번** 정수화한다.
 *
 * **왜 basis point 인가**: 세율 10% 를 `0.1` 로 두면 곱셈에 부동소수가 들어온다.
 * `1000 / 10000` 으로 두면 나눗셈 한 번만 남고 그 나눗셈을 우리가 통제한다.
 */

/** 반올림 방식 */
export type RoundMode = 'round' | 'floor' | 'ceil'

/** 부가세를 어느 쪽으로 푸는가 — 이 한 칸이 방향을 기록한다 */
export type TaxBasis = 'NET' | 'GROSS'

/** 세율 구분. 영세율과 면세는 세금계산서 종류가 다르므로 나눠 둔다 */
export type TaxKind = 'TAXABLE' | 'ZERO_RATED' | 'EXEMPT'

/**
 * 무엇이 오든 **minor 단위 정수**로.
 *
 * **왜 여기 있나**: 이 함수가 `lib/crm/domain/cost.ts` 와 `booked-amount.ts` 에
 * **글자까지 똑같이** 두 벌 있었다(각각 `big()`). 복붙된 변환은 언젠가 한쪽만 고쳐지고,
 * 그날부터 원가 쪽 1원과 수주 쪽 1원이 달라진다 — 그건 결산 때나 발견된다.
 *
 * 규칙 셋:
 *   · 빈 값·null·NaN 은 **0** 이다. 던지지 않는다 — 폼의 빈 칸이 계산을 멈추면 안 된다
 *   · bigint 는 그대로 통과한다(이미 정수다)
 *   · 소수는 **반올림**한다. 잘라 버리면 합계가 늘 작아진다
 */
export function toMinor(v: bigint | number | string | null | undefined): bigint {
  if (v === null || v === undefined || v === '') return BigInt(0)
  if (typeof v === 'bigint') return v
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? BigInt(Math.round(n)) : BigInt(0)
}

/** 숫자로. 빈 값·NaN 은 0 — `toMinor` 와 같은 규칙을 소수에도 적용한다 */
export function toNum(v: number | string | null | undefined): number {
  if (v === null || v === undefined || v === '') return 0
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * 「base 의 pct%」를 정수로.
 *
 * 소수 넷까지 받는다(0.0001% 단위). `pct` 를 그대로 곱하면 부동소수가 금액에 들어오므로
 * **10,000 을 곱해 정수로 만든 뒤** 1,000,000 으로 나눈다(= ÷100 for %, ÷10,000 for 소수 넷).
 */
export function pctOfMinor(
  base: bigint,
  pct: number | string | null | undefined,
  /**
   * 기본은 반올림. **예상·전망은 `floor` 를 쓴다** — 넘겨 잡은 숫자로 사람을 뽑으면
   * 그 차액은 사람의 월급이 된다(`forecast.ts` 가 그래서 내림이다).
   */
  mode: RoundMode = 'round',
): bigint {
  const p = toNum(pct)
  if (p === 0 || base === BigInt(0)) return BigInt(0)
  const num = base * BigInt(Math.round(p * 10_000))
  const den = BigInt(1_000_000)
  if (mode === 'floor') return divFloor(num, den)
  if (mode === 'ceil') { const q = divFloor(num, den); return q * den === num ? q : q + BigInt(1) }
  return divRound(num, den)
}

/**
 * 「단가 × 수량」.
 *
 * 수량은 소수일 수 있다(0.5식 · 1.5개월 · 2.5 M/M). 그래서 곱한 뒤 **한 번** 반올림한다 —
 * 단가를 먼저 반올림하면 그 오차가 수량만큼 증폭된다.
 */
export function mulQty(unitMinor: bigint, qty: number): bigint {
  const q = toNum(qty)
  if (q <= 0 || unitMinor === BigInt(0)) return BigInt(0)
  return BigInt(Math.round(Number(unitMinor) * q))
}

/**
 * 「part 가 whole 의 몇 %인가」 — 소수 한 자리.
 *
 * whole 이 0 이면 **null** 이다. 0% 가 아니라 «비율을 말할 수 없다»가 맞다 —
 * 0% 로 두면 화면이 「현물 0%」라고 단정해 버린다.
 */
export function ratioPct(part: bigint, whole: bigint): number | null {
  if (whole === BigInt(0)) return null
  return Math.round((Number(part) / Number(whole)) * 1000) / 10
}

/** 퍼센트(10.00 같은 값)를 basis point 정수로. 소수 2자리까지 보존한다 */
export function pctToBp(pct: number | string): bigint {
  const n = typeof pct === 'string' ? Number(pct) : pct
  if (!Number.isFinite(n) || n < 0) return BigInt(0)
  // 10.00% → 1000bp. 소수 2자리를 살리려면 ×100 이 필요하다
  return BigInt(Math.round(n * 100))
}

/** 나눗셈 — HALF_UP. 음수는 절댓값으로 처리한 뒤 부호를 되돌린다 */
export function divRound(a: bigint, b: bigint): bigint {
  if (b === BigInt(0)) return BigInt(0)
  const neg = (a < BigInt(0)) !== (b < BigInt(0))
  const x = a < BigInt(0) ? -a : a
  const y = b < BigInt(0) ? -b : b
  const q = (x + y / BigInt(2)) / y
  return neg ? -q : q
}

/** 나눗셈 — 버림(0 방향) */
export function divFloor(a: bigint, b: bigint): bigint {
  if (b === BigInt(0)) return BigInt(0)
  const neg = (a < BigInt(0)) !== (b < BigInt(0))
  const x = a < BigInt(0) ? -a : a
  const y = b < BigInt(0) ? -b : b
  const q = x / y
  return neg ? -q : q
}

/**
 * 자리수 단위로 맞춘다. `unit` 은 minor 단위 크기다(1 = 원, 10000 = 만원).
 *
 * 제안가 절사가 이 함수를 쓴다 — 24,265,200 을 «만원 단위 버림» 하면 24,260,000 이고,
 * **사라진 5,200 이 어디서 생겼는지**를 호출한 쪽이 함께 기록한다.
 */
export function roundToUnit(value: bigint, unit: bigint, mode: RoundMode): bigint {
  if (unit <= BigInt(1)) return value
  const neg = value < BigInt(0)
  const x = neg ? -value : value
  const rem = x % unit
  if (rem === BigInt(0)) return value
  let y: bigint
  if (mode === 'floor') y = x - rem
  else if (mode === 'ceil') y = x - rem + unit
  else y = rem * BigInt(2) >= unit ? x - rem + unit : x - rem
  return neg ? -y : y
}

export interface TaxInput {
  /** 원본 금액. taxBasis 가 NET 이면 공급가액, GROSS 이면 총액이다 */
  amountMinor: bigint
  taxBasis: TaxBasis
  /** 세율 퍼센트(10 = 10%). TaxKind 가 과세가 아니면 무시된다 */
  taxRatePct?: number | string
  taxKind?: TaxKind
  /** 세액 절사 방식. 기본은 버림(DA 견적서의 «부가세(절사)» 그대로) */
  taxRounding?: RoundMode
}

export interface TaxAmounts {
  /** 공급가액 */
  netMinor: bigint
  /** 세액 */
  taxMinor: bigint
  /** 총액 (VAT 포함) */
  grossMinor: bigint
}

/**
 * 부가세 — **세 값은 언제나 계산한다.** 저장하는 것은 `taxBasis` 와 원본 하나뿐이다.
 *
 * 방향이 둘인 이유: 어느 쪽이 **원본 입력**인가가 자리마다 다르다.
 *   · 견적 라인은 단가에서 쌓아 올린다 → NET
 *   · 국가 과제 사업비·고객 예산은 총액이 먼저 주어진다 → GROSS
 *
 * **흔한 오류**: 포함가에 세율을 곱하는 것.
 * 13억이 VAT 포함이면 세액은 13억 × 10% = 1.3억이 아니라 13억 ÷ 11 = 1억 1,818만이다.
 * 그 차이가 1,182만이다.
 *
 * 어느 방향이든 `net + tax = gross` 가 **정확히** 성립한다(불변식 I5) —
 * 한쪽을 계산하고 나머지를 뺄셈으로 얻기 때문이다.
 */
export function computeTax(input: TaxInput): TaxAmounts {
  const kind = input.taxKind ?? 'TAXABLE'
  const amount = input.amountMinor

  // 영세율·면세는 세액이 없다. 둘의 차이는 세금계산서 종류이지 금액이 아니다
  if (kind !== 'TAXABLE') {
    return { netMinor: amount, taxMinor: BigInt(0), grossMinor: amount }
  }

  const bp = pctToBp(input.taxRatePct ?? 10)
  if (bp === BigInt(0)) return { netMinor: amount, taxMinor: BigInt(0), grossMinor: amount }

  if (input.taxBasis === 'GROSS') {
    // 총액이 원본 — 공급가액을 나눠 내리고 세액은 차액으로 얻는다
    const net = divRound(amount * BigInt(10000), BigInt(10000) + bp)
    return { netMinor: net, taxMinor: amount - net, grossMinor: amount }
  }

  // 공급가액이 원본 — 세액을 곱해 올린다. 기본은 버림
  const mode = input.taxRounding ?? 'floor'
  const raw = amount * bp
  const tax = mode === 'floor' ? divFloor(raw, BigInt(10000)) : mode === 'ceil'
    ? -divFloor(-raw, BigInt(10000))
    : divRound(raw, BigInt(10000))
  return { netMinor: amount, taxMinor: tax, grossMinor: amount + tax }
}

/**
 * 세율이 섞이면 GROSS 역산을 쓰지 않는다.
 *
 * 국내 10% 와 수출 영세율이 한 견적에 있으면 **하나의 나눗셈으로 못 푼다**.
 * 이 판정도 계산이다 — 세율 종류가 몇 가지인지 세면 된다.
 */
export function canUseGrossBasis(kinds: readonly { taxKind?: TaxKind; taxRatePct?: number | string }[]): boolean {
  if (kinds.length === 0) return true
  const first = `${kinds[0].taxKind ?? 'TAXABLE'}:${pctToBp(kinds[0].taxRatePct ?? 10)}`
  return kinds.every((k) => `${k.taxKind ?? 'TAXABLE'}:${pctToBp(k.taxRatePct ?? 10)}` === first)
}

/**
 * 최대잔여법 — 총액을 가중치대로 나누되 **1원도 잃지 않는다**.
 *
 * 100원을 셋으로 나누면 33+33+33 = 99 다. 1원이 사라진다.
 * 회계 시스템은 이걸 반드시 처리하고, 표준 기법이 이것이다 —
 * 내림으로 나눈 뒤 남는 몫을 **소수부가 큰 순서로** 하나씩 얹는다.
 *
 * 동점이면 앞 항목이 먼저 받는다(결정적이어야 다시 계산해도 같은 답이 나온다).
 */
export function largestRemainder(total: bigint, weights: readonly bigint[]): bigint[] {
  const n = weights.length
  if (n === 0) return []
  const sum = weights.reduce((a, b) => a + b, BigInt(0))
  if (sum === BigInt(0)) {
    // 가중치가 전부 0이면 나눌 근거가 없다 — 첫 항목이 전부 갖는다
    return weights.map((_, i) => (i === 0 ? total : BigInt(0)))
  }

  const base: bigint[] = []
  const rem: { i: number; r: bigint }[] = []
  let used = BigInt(0)
  for (let i = 0; i < n; i++) {
    const exact = total * weights[i]
    const q = exact / sum
    base.push(q)
    rem.push({ i, r: exact - q * sum })
    used += q
  }

  let left = total - used
  // 잔여가 음수일 수도 있다(총액이 음수인 경우) — 그때는 큰 쪽부터 하나씩 뺀다
  const step = left < BigInt(0) ? -BigInt(1) : BigInt(1)
  rem.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1))
  let k = 0
  while (left !== BigInt(0) && rem.length > 0) {
    base[rem[k % rem.length].i] += step
    left -= step
    k++
  }
  return base
}

/** 표시용 — 화면은 이 함수만 쓴다. 계산에는 쓰지 않는다 */
export function formatMinor(v: bigint, currency = 'KRW'): string {
  const s = v < BigInt(0) ? `-${(-v).toString()}` : v.toString()
  const withComma = s.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return currency === 'KRW' ? withComma : `${withComma} ${currency}`
}

/** 폰에서 자릿수 열 개를 읽는 사람은 없다 — 억·만 단위로 줄인다 */
export function formatMinorShort(v: bigint): string {
  const neg = v < BigInt(0)
  const x = neg ? -v : v
  const sign = neg ? '-' : ''
  if (x >= BigInt(100000000)) {
    const eok = Number(x) / 100_000_000
    return `${sign}${eok >= 100 ? Math.round(eok) : Math.round(eok * 10) / 10}억`
  }
  if (x >= BigInt(10000)) return `${sign}${Math.round(Number(x) / 10_000)}만`
  return `${sign}${formatMinor(x)}`
}
