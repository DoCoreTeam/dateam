const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

export interface ReportForRefine {
  userName: string
  category: string
  performance: string
  plan: string
  issues: string
}

export interface RefinedReport extends ReportForRefine {
  weekStart: string
}

const SYSTEM_PROMPT = `당신은 기업 주간보고서 편집 전문가입니다. 아래 JSON 배열의 주간보고 데이터를 다음 규칙에 따라 정제하여 동일한 JSON 형식으로 반환하세요.

정제 규칙:
1. 오타/맞춤법 교정 (내용 변경 최소화)
2. 동일 항목 내 중복 내용 제거
3. 불완전한 문장 최소한으로 보완
4. 숫자/수치는 원본 유지 (임의 변경 금지)
5. HTML 태그 구조 유지 (p, ul, li 태그 보존)
6. 내용이 없거나 "-"인 경우 그대로 유지
7. 포맷 통일: 항목은 <ul><li>...</li></ul> 형태로 정리

중요: 반드시 JSON 배열만 반환. 설명이나 마크다운 코드블록 없이 순수 JSON만.`

export async function refineReports(
  reports: ReportForRefine[],
  apiKey: string,
  model: string
): Promise<ReportForRefine[]> {
  const url = `${GEMINI_API_BASE}/models/${model}:generateContent`

  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `${SYSTEM_PROMPT}\n\n입력 데이터:\n${JSON.stringify(reports, null, 2)}`,
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.1,
    },
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  })

  if (!res.ok) {
    throw new Error(`Gemini API error: ${res.status} ${res.statusText}`)
  }

  const json = await res.json() as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
  }

  const text = json.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('Gemini 응답이 비어 있습니다')

  const parsed = JSON.parse(text)
  if (!Array.isArray(parsed) || parsed.length !== reports.length) {
    throw new Error('Gemini 응답 형식이 올바르지 않습니다')
  }

  const refined: ReportForRefine[] = parsed.map((item: unknown, i: number) => {
    const src = reports[i]
    if (typeof item !== 'object' || item === null) return src
    const r = item as Record<string, unknown>
    return {
      userName: typeof r.userName === 'string' ? r.userName : src.userName,
      category: typeof r.category === 'string' ? r.category : src.category,
      performance: typeof r.performance === 'string' ? r.performance : src.performance,
      plan: typeof r.plan === 'string' ? r.plan : src.plan,
      issues: typeof r.issues === 'string' ? r.issues : src.issues,
    }
  })

  return refined
}
