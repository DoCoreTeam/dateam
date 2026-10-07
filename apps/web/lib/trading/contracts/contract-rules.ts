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
  /**
   * `YYYY-MM-DD`. 둘째 목요일이고 휴장이면 앞당긴다.
   *
   * 여기 함께 두는 이유: 그날이 만기일이면 접속매매가 15:20 에 끝나고, 그 사실을
   * 세션 창을 세우는 쪽이 알아야 한다. 두 곳에서 따로 계산하면 언젠가 갈린다.
   */
  lastTradingDay: string
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
export function contractsOf(
  rows: readonly MasterRow[],
  root: InstrumentRoot,
  holidays: ReadonlySet<string> = new Set(),
): ContractInfo[] {
  const wanted = INFO_TYPE[root]
  const found: ContractInfo[] = []
  for (const row of rows) {
    if (row.infoType !== wanted) continue
    if (row.underlyingName !== 'KOSPI200') continue
    // 연결선물은 실체가 없는 합성 계열이라 조회 대상이 아니다
    if (row.monthClass === '0' || row.monthClass === '') continue
    const expiryMonth = expiryMonthOf(row.korName)
    if (!expiryMonth) continue
    const [year, month] = expiryMonth.split('-').map(Number)
    found.push({
      code: row.shortCode,
      root,
      expiryMonth,
      isFront: row.monthClass === MONTH_CLASS.front,
      lastTradingDay: lastTradingDay(year, month, holidays),
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
  | {
      roll: true
      reason: 'next_volume_exceeded' | 'deadline_reached' | 'deadline_reached_while_thin'
    }

/**
 * 기한으로 갈아탈 때 차월물이 「아직 얇다」고 볼 선.
 *
 * 근월물의 절반도 안 되면 거래가 아직 안 넘어온 것이다. 실측 2026-10-02 의 10월물 대 11월물은
 * 121,719 대 913 으로 0.0075 였고, 그 상태에서 기한만으로 갈아탄 뒤 이틀 동안
 * 하루 거래량 5,000 짜리 월물로 판단했다. 절반은 「넘어가는 중」과 「아직 안 왔다」를 가르는 선이다.
 */
export const THIN_NEXT_RATIO = 0.5

/**
 * 차근월물로 갈아탈 때인가.
 *
 * 두 갈래다. **거래량이 먼저다.** 차월물이 근월물을 넘었으면 거래가 그리로 옮겨 간 것이고,
 * 그날 갈아타는 것이 원래 규칙이 뜻하던 바다(roll.ts 머리글). 안 넘었어도 기한이 오면 갈아탄다 —
 * 기한이 없으면 만기일 당일까지 유동성이 마른 월물로 판단하게 된다.
 *
 * ## 왜 순서를 바꿨나 (실측 2026-10-07)
 *
 * 전에는 기한을 먼저 봤다. 그래서 거래량 비교는 **기한이 안 걸린 날에만** 돌았고,
 * 기한이 걸린 날에는 한 번도 안 읽혔다. 설정이 3 거래일이라 10-05 자정에
 * 「10-08 까지 3 거래일」로 걸렸고, 10월물 121,719 대 11월물 913 — 133배 차이를 안 보고 갈아탔다.
 * 이틀 동안 화면과 판단이 거래량 22분의 1 짜리 월물을 봤다(그날 11월물 5,036 대 10월물 112,701).
 *
 * ## 왜 기한 쪽 사유를 둘로 가르나
 *
 * 기한으로 갈아타는 것 자체는 막을 수 없다. 만기가 오는 것은 거래량과 상관없기 때문이다.
 * 막을 수 없으면 **보이게 한다** — 차월물이 아직 얇은 채로 갈아탄 날은 사유가 다르게 적히고,
 * 그 줄 하나로 「이 월물이 왜 이렇게 한가한가」에 답할 수 있다.
 */
export function shouldRollover(input: RolloverInput): RolloverDecision {
  if (input.nextVolume > input.frontVolume) {
    return { roll: true, reason: 'next_volume_exceeded' }
  }
  if (input.tradingDaysUntilLast <= input.daysBefore) {
    /*
      거래량이 0 대 0 인 날은 비율을 못 잰다. 그런 날을 「얇다」로 적으면 사실이 아닌 말이
      기록에 남는다 — 재는 쪽이 없으면 기한 하나만 말한다
    */
    const thin = input.frontVolume > 0
      && input.nextVolume < input.frontVolume * THIN_NEXT_RATIO
    return { roll: true, reason: thin ? 'deadline_reached_while_thin' : 'deadline_reached' }
  }
  return { roll: false, reason: 'front_still_heavier' }
}
