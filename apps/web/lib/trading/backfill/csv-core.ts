/**
 * CSV 봉 읽기 — **못 읽은 줄을 센다** (명세 §6.1)
 *
 * KIS 분봉 조회는 과거로 한없이 가지 않는다. 명세는 「부족하면 CSV 가져오기(외부 데이터·
 * 증권사 프로그램 내보내기)로 채운다」고 적는다.
 *
 * ## 왜 못 읽은 줄을 세나
 *
 * 조용히 버리면 **채운 줄 알고 넘어간다.** 1-B 검증은 봉이 있는 만큼만 돌고,
 * 없는 구간은 「그 구간에 신호가 없었다」로 보인다. 결측과 무신호는 다른 사실이다.
 */

export interface ParsedBar {
  startAt: Date
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface CsvRejection {
  /** 1부터 세는 줄 번호 (머리글 포함) */
  line: number
  reason: 'missing_field' | 'bad_time' | 'bad_number' | 'bad_range'
}

export interface CsvParseResult {
  bars: ParsedBar[]
  rejected: CsvRejection[]
  /** 어떤 머리글을 어느 뜻으로 읽었나. 사람이 보고 틀린 짝을 알아챈다 */
  mapping: Record<string, string>
}

export type CsvParseFailure = { reason: string; userMessage: string }

/**
 * 머리글 이름 후보. 증권사 프로그램마다 다른 이름을 쓴다.
 *
 * **이름을 외워서 맞추지 않고 표로 맞춘다** — 외우면 새 이름이 들어온 날
 * 조용히 「그 칸이 없다」가 되고, 없는 칸은 전부 거절로 이어진다.
 */
const FIELD_ALIASES: Record<keyof ParsedBar | 'startAt', readonly string[]> = {
  startAt: ['time', 'datetime', 'date', 'bar_start_at', 'startat', '일자', '시각', '일시', '체결시각'],
  open: ['open', 'o', 'open_price', '시가'],
  high: ['high', 'h', 'high_price', '고가'],
  low: ['low', 'l', 'low_price', '저가'],
  close: ['close', 'c', 'close_price', 'last', '종가', '현재가'],
  volume: ['volume', 'v', 'vol', 'qty', '거래량'],
}

function normalizeHeader(raw: string): string {
  return raw.trim().toLowerCase().replace(/^﻿/, '').replace(/[\s_-]/g, '')
}

/** 머리글 줄을 칸 이름으로 맞춘다. 못 맞춘 칸이 있으면 null */
export function mapHeaders(header: readonly string[]): Record<string, number> | null {
  const found: Record<string, number> = {}
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    const wanted = new Set(aliases.map(normalizeHeader))
    const at = header.findIndex((h) => wanted.has(normalizeHeader(h)))
    if (at < 0) {
      // 거래량은 없어도 된다. 0 인 분도 정상 봉이고(§6.2), 안 준 파일이 실제로 있다
      if (field === 'volume') continue
      return null
    }
    found[field] = at
  }
  return found
}

/**
 * 시각을 읽는다. **시간대가 없으면 KST 로 못을 박는다.**
 *
 * 그대로 `new Date` 에 넘기면 서버 시간대로 읽혀 아홉 시간 어긋나고,
 * 어긋난 봉은 다른 분의 봉이 되어 판단을 통째로 틀리게 만든다.
 */
export function parseBarTime(raw: string): Date | null {
  const text = raw.trim()
  if (text === '') return null
  // `YYYYMMDDHHmm` 또는 `YYYYMMDDHHmmss`
  const compact = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?$/.exec(text)
  if (compact) {
    const [, y, mo, d, h, mi] = compact
    return finiteDate(`${y}-${mo}-${d}T${h}:${mi}:00+09:00`)
  }
  // `YYYY-MM-DD HH:mm` 계열. 시간대 표시가 붙어 있으면 그대로 믿는다
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(text)
  const iso = text.replace(' ', 'T').replace(/\//g, '-')
  if (hasZone) return finiteDate(iso)
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(iso)) {
    return finiteDate(`${iso.length === 16 ? `${iso}:00` : iso}+09:00`)
  }
  return null
}

function finiteDate(iso: string): Date | null {
  const at = new Date(iso)
  return Number.isFinite(at.getTime()) ? at : null
}

/** 한 줄을 칸으로 쪼갠다. 따옴표 안의 쉼표는 안 쪼갠다 */
export function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cell += '"'; i += 1; continue }
      if (ch === '"') { quoted = false; continue }
      cell += ch
      continue
    }
    if (ch === '"') { quoted = true; continue }
    if (ch === ',') { out.push(cell); cell = ''; continue }
    cell += ch
  }
  out.push(cell)
  return out
}

/** 숫자 칸. 쉼표 자리표와 공백을 걷어 낸다 */
function toNumber(raw: string | undefined): number | null {
  if (raw === undefined) return null
  const text = raw.trim().replace(/,/g, '')
  if (text === '') return null
  const n = Number(text)
  return Number.isFinite(n) ? n : null
}

export const MAX_CSV_ROWS = 200_000

/**
 * CSV 본문을 봉으로. **머리글을 못 맞추면 한 줄도 읽지 않는다** —
 * 반쯤 읽으면 어느 칸이 시가인지 모르는 채로 값이 들어간다.
 */
export function parseBarCsv(text: string): CsvParseResult | CsvParseFailure {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')
  if (lines.length < 2) {
    return { reason: 'too_short', userMessage: '머리글과 자료 줄이 있어야 합니다' }
  }
  if (lines.length - 1 > MAX_CSV_ROWS) {
    return { reason: 'too_many_rows', userMessage: `한 번에 ${MAX_CSV_ROWS.toLocaleString()}줄까지 올릴 수 있습니다` }
  }
  const header = splitCsvLine(lines[0])
  const at = mapHeaders(header)
  if (!at) {
    return {
      reason: 'unknown_header',
      // **본문을 안 싣는다.** 머리글 이름만 돌려준다
      userMessage: `머리글에서 시각·시가·고가·저가·종가를 못 찾았습니다 (읽은 머리글: ${header.map((h) => h.trim()).join(', ')})`,
    }
  }

  const bars: ParsedBar[] = []
  const rejected: CsvRejection[] = []
  for (let i = 1; i < lines.length; i += 1) {
    const cells = splitCsvLine(lines[i])
    const startAt = parseBarTime(cells[at.startAt] ?? '')
    if (!startAt) { rejected.push({ line: i + 1, reason: 'bad_time' }); continue }
    const open = toNumber(cells[at.open])
    const high = toNumber(cells[at.high])
    const low = toNumber(cells[at.low])
    const close = toNumber(cells[at.close])
    if (open === null || high === null || low === null || close === null) {
      rejected.push({ line: i + 1, reason: 'bad_number' })
      continue
    }
    // 거래량이 없는 파일은 0 으로 본다. 0 인 분도 정상 봉이다(§6.2)
    const volume = at.volume === undefined ? 0 : (toNumber(cells[at.volume]) ?? 0)
    /**
     * 고가가 저가보다 낮은 줄은 **버린다.** 그런 봉으로 계산한 ATR 은 음수가 되고,
     * 음수 ATR 은 손절가를 진입가 반대편에 놓는다
     */
    if (high < low || high < open || high < close || low > open || low > close) {
      rejected.push({ line: i + 1, reason: 'bad_range' })
      continue
    }
    bars.push({ startAt, open, high, low, close, volume: Math.max(0, Math.round(volume)) })
  }

  const mapping: Record<string, string> = {}
  for (const [field, index] of Object.entries(at)) mapping[field] = header[index].trim()
  return { bars, rejected, mapping }
}

/** 사람이 읽을 한 줄. 몇 줄을 읽고 몇 줄을 왜 버렸나 */
export function importSummary(result: CsvParseResult, saved: number): string {
  const byReason = new Map<string, number>()
  for (const r of result.rejected) byReason.set(r.reason, (byReason.get(r.reason) ?? 0) + 1)
  const LABEL: Record<string, string> = {
    missing_field: '칸 없음', bad_time: '시각을 못 읽음',
    bad_number: '숫자가 아님', bad_range: '고가·저가가 어긋남',
  }
  const dropped = [...byReason].map(([reason, n]) => `${LABEL[reason] ?? reason} ${n}줄`).join(', ')
  const head = `${saved}줄 저장`
  return dropped === '' ? head : `${head}, 건너뜀 ${result.rejected.length}줄 (${dropped})`
}
