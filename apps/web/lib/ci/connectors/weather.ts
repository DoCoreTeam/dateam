// lib/ci/connectors/weather.ts — 게시일의 날씨 (Open-Meteo 아카이브)
//
// 왜: "언제의 트렌드인가"에는 날씨도 들어간다. 폭염에 통한 것과 장마에 통한 것은 다르다.
//
// 오픈소스/무료 선택: Open-Meteo의 과거 기상 아카이브는 API 키가 없고 비상업·상업 모두 열려 있다.
// 키 관리가 하나 늘지 않는 게 이 선택의 핵심이다.
// 정확도 한계: 국가 대표 좌표(수도) 기준이라 "그 나라 그날의 대략"이지 촬영지 날씨가 아니다.
// 그 한계는 저장할 때 함께 남긴다 — 정밀한 값인 척하지 않는다.

const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive'
const TIMEOUT_MS = 8000

export interface DayWeather {
  /** 평균 기온(℃) */
  tempMeanC: number | null
  tempMaxC: number | null
  tempMinC: number | null
  /** 강수량 합(mm) */
  precipMm: number | null
  /** 사람이 읽는 한 줄 */
  summary: string
  /** 좌표 기준을 밝힌다 */
  basis: string
}

/** 기온·강수로 한 줄 요약. 지어내지 않고 관측값만 말한다. */
export function summarize(tempMean: number | null, precip: number | null): string {
  const parts: string[] = []
  if (tempMean != null) {
    const band = tempMean >= 28 ? '무더움'
      : tempMean >= 23 ? '더움'
        : tempMean >= 17 ? '선선함'
          : tempMean >= 8 ? '쌀쌀함'
            : tempMean >= 0 ? '추움' : '한파'
    parts.push(`${band} ${tempMean.toFixed(1)}℃`)
  }
  if (precip != null) {
    if (precip >= 30) parts.push(`많은 비 ${precip.toFixed(0)}mm`)
    else if (precip >= 5) parts.push(`비 ${precip.toFixed(0)}mm`)
    else if (precip > 0) parts.push('약간의 비')
    else parts.push('강수 없음')
  }
  return parts.length > 0 ? parts.join(' · ') : '날씨 정보 없음'
}

/**
 * 특정 날짜·좌표의 날씨. 실패하면 null — 분석을 막지 않는다.
 * 아카이브는 보통 며칠 지연되므로 최근 날짜는 비어 올 수 있다.
 */
export async function fetchDayWeather(input: {
  lat: number; lon: number; date: string; regionLabel: string
}): Promise<DayWeather | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const url = `${ARCHIVE}?latitude=${input.lat}&longitude=${input.lon}`
      + `&start_date=${input.date}&end_date=${input.date}`
      + '&daily=temperature_2m_mean,temperature_2m_max,temperature_2m_min,precipitation_sum'
      + '&timezone=auto'

    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) return null

    const json = await res.json() as {
      daily?: {
        temperature_2m_mean?: (number | null)[]
        temperature_2m_max?: (number | null)[]
        temperature_2m_min?: (number | null)[]
        precipitation_sum?: (number | null)[]
      }
    }
    const d = json.daily
    if (!d) return null

    const mean = d.temperature_2m_mean?.[0] ?? null
    const precip = d.precipitation_sum?.[0] ?? null
    // 값이 하나도 없으면 "조회했지만 없음"이다 — 빈 객체를 성공으로 위장하지 않는다
    if (mean == null && precip == null) return null

    return {
      tempMeanC: mean,
      tempMaxC: d.temperature_2m_max?.[0] ?? null,
      tempMinC: d.temperature_2m_min?.[0] ?? null,
      precipMm: precip,
      summary: summarize(mean, precip),
      basis: `${input.regionLabel} 대표 좌표 기준 ${input.date}`,
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
