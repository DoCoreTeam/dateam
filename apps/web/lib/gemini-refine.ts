const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

export interface MergedCategoryReport {
  category: string
  performance: string
  plan: string
  issues: string
}

const MERGE_BY_CATEGORY_PROMPT = `당신은 기업 주간보고서 편집 전문가입니다. 여러 팀원의 주간보고를 팀 전체 하나의 통합 보고서로 작성합니다.

## 1단계: 구분(category) 의미론적 통합
입력된 모든 구분 값을 파악한 뒤, 업무 도메인 관점에서 실질적으로 같은 업무 영역에 해당하는 구분들을 하나로 묶으세요.

통합 판단 기준 — 아래 질문에 "예"라면 통합 대상:
• 오타·띄어쓰기·약어 차이일 뿐 사실상 같은 표현인가?
• 조직 내에서 동일한 담당자·팀이 수행하는 업무인가?
• 일반적인 기업 업무 용어로 보아 같은 기능 범주에 속하는가?
  (예시 아님 — AI의 업무 도메인 지식으로 판단: 영업 파이프라인 관리는 영업 활동의 일부, 사업개발은 기획·영업 범주 등)

표준 명칭 선정: 여러 구분 중 가장 명확하고 업무 성격이 잘 드러나는 표현을 선택
단, 성격이 다른 독립 업무는 무리하게 묶지 말 것

## 2단계: 내용 병합 및 정제
통합된 구분별로 모든 팀원의 내용을 합칩니다:
• 같은 구분의 성과·계획·이슈를 모두 나열 (작성자 이름 제거)
• 동일하거나 매우 유사한 항목은 1개만 유지 (중복 제거)
• 스타일 통일: <ul><li>내용</li></ul> 형태
• 오타·맞춤법 교정 (수치·숫자 원본 유지, 내용 임의 생성 금지)
• 빈 내용("-", "", null)은 빈 문자열("")로

## 3단계: 출력 스타일 일관성 적용
항목 내 프로젝트명·고객명·과제명 표기를 전체에서 일관되게 통일하세요:
• 꺾쇠 표기(<프로젝트명>) 사용 여부를 입력 데이터에서 다수가 사용하는 방식으로 통일
• 같은 프로젝트·고객이 어떤 항목에서는 <이름> 형식, 어떤 항목에서는 일반 텍스트로 혼재하면 반드시 한 가지로 통일
• 통일 방향: 입력 데이터 전체에서 <> 표기가 더 많이 쓰였다면 <> 방식으로, 없는 경우가 더 많다면 일반 텍스트 방식으로

출력: 순수 JSON 배열만 [{category, performance, plan, issues}]
- 구분별 정확히 1개 항목 (중복 구분 절대 없음)
- 마크다운 코드블록·설명 없이 순수 JSON만`

export interface WeeklyRow {
  category: string
  performance: string
  plan: string
  issues: string
}

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

const WEEKLY_REFINE_PROMPT = `당신은 기업 주간보고서 편집 전문가입니다. 팀원이 작성한 주간보고를 김도현 본부장 보고용으로 정비합니다.

정비 규칙:
1. 오타·맞춤법 교정 (내용 변경 최소화)
2. 동일 항목 내 중복 내용 제거
3. 불완전한 문장 최소한으로 보완
4. 숫자·수치는 원본 유지 (임의 변경 금지)
5. HTML 태그 구조 유지 (p, ul, li 태그 보존)
6. 포맷 통일: 항목은 <ul><li>...</li></ul> 형태 권장

절대 금지:
- 비어있는 필드(빈 문자열, "-")에 내용 생성 금지
- 작성자가 쓰지 않은 내용 추가·창작 금지
- category 값 변경 금지

반환: 입력과 동일한 구조의 JSON 배열. 순수 JSON만, 설명·마크다운 코드블록 없이.`

export async function mergeAndRefineByCategory(
  reports: ReportForRefine[],
  apiKey: string,
  model: string
): Promise<MergedCategoryReport[]> {
  if (reports.length === 0) return []

  const url = `${GEMINI_API_BASE}/models/${model}:generateContent`

  const input = reports.map(({ userName, category, performance, plan, issues }) => ({
    userName, category, performance, plan, issues,
  }))

  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ text: `${MERGE_BY_CATEGORY_PROMPT}\n\n입력 데이터:\n${JSON.stringify(input, null, 2)}` }],
      },
    ],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
    cache: 'no-store',
  })

  if (!res.ok) throw new Error(`Gemini API error: ${res.status} ${res.statusText}`)

  const json = await res.json() as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
  }
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('Gemini 응답이 비어 있습니다')

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Gemini 병합 응답 JSON 파싱 실패')
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('Gemini 병합 응답 형식이 올바르지 않습니다')
  }

  return (parsed as unknown[]).map((item) => {
    const r = (typeof item === 'object' && item !== null) ? item as Record<string, unknown> : {}
    return {
      category: typeof r.category === 'string' ? r.category : '',
      performance: typeof r.performance === 'string' ? r.performance : '',
      plan: typeof r.plan === 'string' ? r.plan : '',
      issues: typeof r.issues === 'string' ? r.issues : '',
    }
  }).filter((r) => r.category !== '')
}

export async function refineWeeklyReport(
  rows: WeeklyRow[],
  apiKey: string,
  model: string
): Promise<WeeklyRow[]> {
  if (rows.length === 0) return rows

  const url = `${GEMINI_API_BASE}/models/${model}:generateContent`

  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ text: `${WEEKLY_REFINE_PROMPT}\n\n입력 데이터:\n${JSON.stringify(rows, null, 2)}` }],
      },
    ],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
    cache: 'no-store',
  })

  if (!res.ok) throw new Error(`Gemini API error: ${res.status} ${res.statusText}`)

  const json = await res.json() as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
  }
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('Gemini 응답이 비어 있습니다')

  const parsed = JSON.parse(text)
  if (!Array.isArray(parsed)) throw new Error('Gemini 응답 형식이 올바르지 않습니다')

  return rows.map((src) => {
    const match = (parsed as unknown[]).find(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        (item as Record<string, unknown>).category === src.category
    )
    if (!match) return src
    const r = match as Record<string, unknown>
    return {
      category: src.category,
      performance: typeof r.performance === 'string' ? r.performance : src.performance,
      plan: typeof r.plan === 'string' ? r.plan : src.plan,
      issues: typeof r.issues === 'string' ? r.issues : src.issues,
    }
  })
}

/** @deprecated mergeAndRefineByCategory로 대체됨 */
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
