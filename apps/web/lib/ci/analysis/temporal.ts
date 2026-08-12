// lib/ci/analysis/temporal.ts — 게시 시점의 맥락 판정 (순수 함수)
//
// 왜 필요한가: "평소 대비 9배"만으로는 **언제의 트렌드인지** 알 수 없다.
// 여름에 통한 것을 겨울에 따라 하면 안 되고, 주말 저녁에 통한 것을 평일 아침에 올리면 안 된다.
// 게시 시각을 계절·분기·요일·시간대로 풀어 두면 "언제 통했나"를 물을 수 있다.
//
// 원칙: 시각은 **콘텐츠가 속한 지역 기준**으로 읽는다.
// 한국 채널의 새벽 3시와 미국 채널의 새벽 3시는 다른 사건이다.
// 지역을 모르면 모른다고 두고, KST로 우겨넣지 않는다.

/** 반구 — 계절은 남·북이 반대다. 한쪽만 맞으면 절반이 틀린다. */
export type Hemisphere = 'north' | 'south'
export type Season = 'spring' | 'summer' | 'autumn' | 'winter'

export const SEASON_LABEL: Record<Season, string> = {
  spring: '봄', summer: '여름', autumn: '가을', winter: '겨울',
}

/** 국가 → 시간대·반구·좌표(날씨 조회용). 확실한 것만 둔다. */
export interface CountryInfo {
  timeZone: string
  hemisphere: Hemisphere
  lat: number
  lon: number
  label: string
}

export const COUNTRY_INFO: Record<string, CountryInfo> = {
  KR: { timeZone: 'Asia/Seoul', hemisphere: 'north', lat: 37.57, lon: 126.98, label: '한국' },
  JP: { timeZone: 'Asia/Tokyo', hemisphere: 'north', lat: 35.68, lon: 139.69, label: '일본' },
  US: { timeZone: 'America/Los_Angeles', hemisphere: 'north', lat: 34.05, lon: -118.24, label: '미국' },
  GB: { timeZone: 'Europe/London', hemisphere: 'north', lat: 51.51, lon: -0.13, label: '영국' },
  DE: { timeZone: 'Europe/Berlin', hemisphere: 'north', lat: 52.52, lon: 13.40, label: '독일' },
  FR: { timeZone: 'Europe/Paris', hemisphere: 'north', lat: 48.86, lon: 2.35, label: '프랑스' },
  CN: { timeZone: 'Asia/Shanghai', hemisphere: 'north', lat: 39.90, lon: 116.40, label: '중국' },
  TW: { timeZone: 'Asia/Taipei', hemisphere: 'north', lat: 25.03, lon: 121.57, label: '대만' },
  VN: { timeZone: 'Asia/Ho_Chi_Minh', hemisphere: 'north', lat: 10.82, lon: 106.63, label: '베트남' },
  TH: { timeZone: 'Asia/Bangkok', hemisphere: 'north', lat: 13.76, lon: 100.50, label: '태국' },
  IN: { timeZone: 'Asia/Kolkata', hemisphere: 'north', lat: 28.61, lon: 77.21, label: '인도' },
  ID: { timeZone: 'Asia/Jakarta', hemisphere: 'south', lat: -6.21, lon: 106.85, label: '인도네시아' },
  BR: { timeZone: 'America/Sao_Paulo', hemisphere: 'south', lat: -23.55, lon: -46.63, label: '브라질' },
  AU: { timeZone: 'Australia/Sydney', hemisphere: 'south', lat: -33.87, lon: 151.21, label: '호주' },
  ES: { timeZone: 'Europe/Madrid', hemisphere: 'north', lat: 40.42, lon: -3.70, label: '스페인' },
  MX: { timeZone: 'America/Mexico_City', hemisphere: 'north', lat: 19.43, lon: -99.13, label: '멕시코' },
}

/** 언어 코드로 국가를 추정한다. 확실한 1:1만 — 영어처럼 여러 나라가 쓰는 건 추정하지 않는다. */
const LANGUAGE_TO_COUNTRY: Record<string, string> = {
  ko: 'KR', ja: 'JP', de: 'DE', fr: 'FR', th: 'TH', vi: 'VN', id: 'ID',
}

/**
 * 국가 판정. 확실한 근거 순으로 본다.
 * 근거가 없으면 null — "아마 한국"으로 채우면 계절·시간대가 통째로 틀어진다.
 */
export function resolveCountry(input: {
  channelCountry?: string | null
  language?: string | null
}): { code: string; source: 'channel' | 'language' } | null {
  const cc = input.channelCountry?.trim().toUpperCase()
  if (cc && COUNTRY_INFO[cc]) return { code: cc, source: 'channel' }

  const lang = input.language?.trim().toLowerCase().split('-')[0]
  if (lang && LANGUAGE_TO_COUNTRY[lang]) {
    return { code: LANGUAGE_TO_COUNTRY[lang], source: 'language' }
  }
  return null
}

/** 월(1~12) → 계절. 남반구는 6개월 밀린다. */
export function seasonOf(month: number, hemisphere: Hemisphere): Season {
  const m = ((Math.trunc(month) - 1) % 12 + 12) % 12 + 1
  const northern: Season = m <= 2 || m === 12 ? 'winter'
    : m <= 5 ? 'spring'
      : m <= 8 ? 'summer' : 'autumn'
  if (hemisphere === 'north') return northern
  const flip: Record<Season, Season> = {
    winter: 'summer', spring: 'autumn', summer: 'winter', autumn: 'spring',
  }
  return flip[northern]
}

/** 시간대(0~23) → 사람이 쓰는 구간. */
export type DayPart = 'dawn' | 'morning' | 'afternoon' | 'evening' | 'night'
export const DAY_PART_LABEL: Record<DayPart, string> = {
  dawn: '새벽', morning: '오전', afternoon: '오후', evening: '저녁', night: '밤',
}

export function dayPartOf(hour: number): DayPart {
  const h = ((Math.trunc(hour) % 24) + 24) % 24
  if (h < 6) return 'dawn'
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  if (h < 21) return 'evening'
  return 'night'
}

export const WEEKDAY_LABEL = ['일', '월', '화', '수', '목', '금', '토'] as const

export interface TemporalContext {
  /** 콘텐츠 지역 기준 현지 시각 정보 */
  localDate: string          // YYYY-MM-DD
  year: number
  month: number
  quarter: number
  weekday: number            // 0=일
  weekdayLabel: string
  isWeekend: boolean
  hour: number
  dayPart: DayPart
  season: Season
  countryCode: string | null
  countrySource: 'channel' | 'language' | null
  timeZone: string
  /** 지역을 몰라 UTC로 읽었는지 — 화면이 정직하게 밝힐 수 있게 */
  regionKnown: boolean
}

/** 주어진 시간대의 벽시계 값을 뽑는다. */
function partsInZone(iso: string, timeZone: string): {
  year: number; month: number; day: number; hour: number; weekday: number
} | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hour12: false, weekday: 'short',
  })
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]))
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // 24시는 자정을 뜻한다(Intl이 이렇게 준다) — 0으로 되돌린다
    hour: Number(parts.hour) % 24,
    weekday: weekdayMap[parts.weekday as string] ?? 0,
  }
}

/**
 * 게시 시각 → 맥락.
 * 지역을 모르면 UTC로 읽되 regionKnown=false로 표시한다. 모른 채로 단정하지 않는다.
 */
export function buildTemporalContext(input: {
  publishedAtIso: string | null
  channelCountry?: string | null
  language?: string | null
}): TemporalContext | null {
  if (!input.publishedAtIso) return null

  const country = resolveCountry(input)
  const info = country ? COUNTRY_INFO[country.code] : null
  const timeZone = info?.timeZone ?? 'UTC'

  const p = partsInZone(input.publishedAtIso, timeZone)
  if (!p) return null

  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    localDate: `${p.year}-${pad(p.month)}-${pad(p.day)}`,
    year: p.year,
    month: p.month,
    quarter: Math.floor((p.month - 1) / 3) + 1,
    weekday: p.weekday,
    weekdayLabel: WEEKDAY_LABEL[p.weekday],
    isWeekend: p.weekday === 0 || p.weekday === 6,
    hour: p.hour,
    dayPart: dayPartOf(p.hour),
    season: seasonOf(p.month, info?.hemisphere ?? 'north'),
    countryCode: country?.code ?? null,
    countrySource: country?.source ?? null,
    timeZone,
    regionKnown: Boolean(info),
  }
}

/** 화면에 한 줄로 쓰는 요약. */
export function describeContext(c: TemporalContext): string {
  const region = c.countryCode ? (COUNTRY_INFO[c.countryCode]?.label ?? c.countryCode) : '지역 미상'
  return `${region} · ${c.year}년 ${SEASON_LABEL[c.season]} · ${c.weekdayLabel}요일 ${DAY_PART_LABEL[c.dayPart]}`
}
