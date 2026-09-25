/**
 * 월물 규칙 — **무엇이 근월물이고 언제 바꾸나** (순수 함수)
 *
 * ## 왜 코드를 지어내지 않나
 *
 * 월물 종목코드는 규칙으로 만들 수 있을 것처럼 생겼는데(A01 + 연도 + 월) 실제로는
 * 만들면 안 된다. 상장 월물이 어느 달인지는 거래소가 정하고, 틀린 코드로 조회하면
 * 오류가 아니라 **빈 응답**이 온다 — 그러면 화면에는 「시장이 조용하다」로 보인다.
 *
 * 그래서 목록도 「지금 무엇이 근월물인가」도 KIS 종목정보 마스터에서 읽는다.
 * 마스터의 `월물구분코드` 가 1=최근월물, 2=차근월물이라고 직접 말해 준다
 * (`stocks_info/종목마스터정보(지수선물옵션).h`).
 *
 * ## 마스터 파일 실측 (2026-09-26)
 *
 * ```
 * 1|A01612|KR4A016C0004|F 202612| |00000.00|1|2001|KOSPI200      ← 정규 근월물
 * B|A05610|KR4A056A0007|미니F 202610| |00000.00|1|2001|KOSPI200  ← 미니 근월물
 * ```
 * 칸 아홉: 상품종류 · 단축코드 · 표준코드 · 한글종목명 · ATM구분 · 행사가 ·
 *          월물구분코드 · 기초자산 단축코드 · 기초자산 명
 */

export type InstrumentRoot = 'KOSPI200' | 'MINI_KOSPI200'

/** 상품종류 칸의 값. 1=지수선물, B=미니선물 (마스터 레이아웃 .h) */
const INFO_TYPE: Record<InstrumentRoot, string> = {
  KOSPI200: '1',
  MINI_KOSPI200: 'B',
}

/** 월물구분코드. 0=연결선물이라 실제 월물이 아니다 — 조회 대상에서 뺀다 */
export const MONTH_CLASS = { front: '1', next: '2' } as const

export interface MasterRow {
  infoType: string
  /** KIS 조회의 `FID_INPUT_ISCD` 에 넣는 값 */
  shortCode: string
  standardCode: string
  korName: string
  monthClass: string
  underlyingName: string
}

export interface ContractInfo {
  code: string
  root: InstrumentRoot
  /** `YYYY-MM-01` */
  expiryMonth: string
  /** 근월물인가 */
  isFront: boolean
}

/**
 * 마스터 본문을 줄 단위로 읽는다.
 *
 * 칸 수가 아홉이 아닌 줄은 **버리고 센다.** 조용히 넘기면 형식이 바뀐 날
 * 월물이 0개가 되고, 화면에는 「봉이 안 온다」로 보인다.
 */
export function parseIndexFutureMaster(text: string): { rows: MasterRow[]; dropped: number } {
  const rows: MasterRow[] = []
  let dropped = 0
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue
    const cols = line.split('|')
    if (cols.length !== 9) { dropped += 1; continue }
    rows.push({
      infoType: cols[0],
      shortCode: cols[1].trim(),
      standardCode: cols[2].trim(),
      korName: cols[3].trim(),
      monthClass: cols[6].trim(),
      underlyingName: cols[8].trim(),
    })
  }
  return { rows, dropped }
}

/** `F 202612` · `미니F 202610` → `2026-12-01` */
export function expiryMonthOf(korName: string): string | null {
  const matched = korName.match(/(\d{4})(\d{2})\s*$/)
  if (!matched) return null
  const month = Number(matched[2])
  if (month < 1 || month > 12) return null
  return `${matched[1]}-${matched[2]}-01`
}

/**
 * 이 상품의 월물들. `isFront` 는 마스터가 말한 것을 그대로 옮긴다.
 *
 * 연결선물(월물구분 0)과 옵션은 빠진다 — 기초자산이 KOSPI200 이어도 선물이 아니면
 * 봉의 뜻이 다르다.
 */
export function contractsOf(rows: readonly MasterRow[], root: InstrumentRoot): ContractInfo[] {
  const wanted = INFO_TYPE[root]
  const found: ContractInfo[] = []
  for (const row of rows) {
    if (row.infoType !== wanted) continue
    if (row.underlyingName !== 'KOSPI200') continue
    // 연결선물은 실체가 없는 합성 계열이라 조회 대상이 아니다
    if (row.monthClass === '0' || row.monthClass === '') continue
    const expiryMonth = expiryMonthOf(row.korName)
    if (!expiryMonth) continue
    found.push({
      code: row.shortCode,
      root,
      expiryMonth,
      isFront: row.monthClass === MONTH_CLASS.front,
    })
  }
  return found.sort((a, b) => a.expiryMonth.localeCompare(b.expiryMonth))
}

/** 마스터가 말한 근월물. 없으면 null — 없는 것을 첫 줄로 때우지 않는다 */
export function frontContractOf(contracts: readonly ContractInfo[]): ContractInfo | null {
  return contracts.find((c) => c.isFront) ?? null
}

export function nextContractOf(contracts: readonly ContractInfo[]): ContractInfo | null {
  const front = frontContractOf(contracts)
  if (!front) return null
  return contracts.find((c) => c.expiryMonth > front.expiryMonth) ?? null
}

// ── 최종거래일 ───────────────────────────────────────────

/**
 * 둘째 목요일 (`YYYY-MM-DD`, 서울 기준).
 *
 * 정규는 3·6·9·12월, 미니는 매월. 미니는 **매달 한 번씩** 만기일 규칙이 적용된다(D-50).
 */
export function secondThursday(year: number, month: number): string {
  // 그 달 1일의 요일부터 첫 목요일까지의 거리
  const first = new Date(Date.UTC(year, month - 1, 1))
  const shiftToThursday = (4 - first.getUTCDay() + 7) % 7
  const day = 1 + shiftToThursday + 7
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * 최종거래일. 둘째 목요일이 휴장일이면 **앞당긴다**(뒤로 미루지 않는다).
 *
 * 앞당기는 방향이 중요하다. 뒤로 미루면 이미 만기가 지난 월물로 하루 더 판단하게 된다.
 *
 * @param holidays `YYYY-MM-DD` 휴장일. 없으면 둘째 목요일 그대로
 */
export function lastTradingDay(
  year: number,
  month: number,
  holidays: ReadonlySet<string> = new Set(),
): string {
  let day = secondThursday(year, month)
  // 연속 휴장을 대비해 며칠 앞까지 본다. 주말도 휴장이므로 함께 건너뛴다
  for (let i = 0; i < 10; i += 1) {
    const weekday = new Date(`${day}T12:00:00+09:00`).getUTCDay()
    const isWeekend = weekday === 0 || weekday === 6
    if (!holidays.has(day) && !isWeekend) return day
    day = shiftDays(day, -1)
  }
  return day
}

function shiftDays(dateKey: string, delta: number): string {
  const at = new Date(`${dateKey}T12:00:00+09:00`)
  at.setUTCDate(at.getUTCDate() + delta)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(at)
}

/** 정규는 분기물, 미니는 매월 (명세 §20) */
export function expiryMonthsOf(root: InstrumentRoot): number[] {
  return root === 'KOSPI200' ? [3, 6, 9, 12] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
}

// ── 교체 ─────────────────────────────────────────────────

export interface RolloverInput {
  /** 오늘 근월물 거래량 */
  frontVolume: number
  /** 오늘 차근월물 거래량 */
  nextVolume: number
  /** 최종거래일까지 남은 거래일 수. 세션 캘린더로 센 값을 받는다 */
  tradingDaysUntilLast: number
  /** 설정 `rollover_days_before_last` */
  daysBefore: number
}

export type RolloverDecision =
  | { roll: false; reason: 'front_still_heavier' }
  | { roll: true; reason: 'next_volume_exceeded' | 'deadline_reached' }

/**
 * 차근월물로 갈아탈 때인가.
 *
 * 두 갈래다. 거래량이 먼저 넘으면 그날 갈아타고, 안 넘어도 **기한이 오면 갈아탄다** —
 * 기한이 없으면 만기일 당일까지 유동성이 마른 월물로 판단하게 된다.
 * 기한 쪽을 먼저 보는 이유: 거래량이 뒤집히지 않는 날이 실제로 있고, 그날도 기한은 온다.
 */
export function shouldRollover(input: RolloverInput): RolloverDecision {
  if (input.tradingDaysUntilLast <= input.daysBefore) {
    return { roll: true, reason: 'deadline_reached' }
  }
  if (input.nextVolume > input.frontVolume) {
    return { roll: true, reason: 'next_volume_exceeded' }
  }
  return { roll: false, reason: 'front_still_heavier' }
}
