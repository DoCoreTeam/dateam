const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

export interface ParsedLeadData {
  company_name?: string
  industry?: string
  segment?: string
  size?: string
  region?: string
  website?: string
  company_phone?: string
  address?: string
  contact_name?: string
  contact_title?: string
  contact_department?: string
  contact_email?: string
  contact_phone?: string
  contact_mobile?: string
  deal_title?: string
  deal_description?: string
  next_action?: string
  fit_score?: number
  fit_reason?: string
  tags?: string[]
}

const LEAD_PARSE_PROMPT = `당신은 B2B 영업 CRM 전문가입니다. 아래 입력에서 거래처/담당자/영업기회 정보를 추출하여 JSON으로 반환하세요.

추출 항목:
- company_name: 회사명
- industry: 업종 (IT, 제조, 금융, 의료, 유통, 공공, 교육, 기타)
- segment: 고객 세그먼트 (엔터프라이즈, SMB, 공공, 스타트업)
- size: 기업 규모 (대기업, 중견기업, 중소기업, 스타트업)
- region: 지역 (서울, 경기, 부산, 대구, 인천, 기타)
- website: 웹사이트 URL
- company_phone: 회사 전화
- address: 주소
- contact_name: 담당자 이름
- contact_title: 직함/직책
- contact_department: 부서
- contact_email: 이메일
- contact_phone: 직통 전화
- contact_mobile: 휴대폰
- deal_title: 영업기회 제목 (없으면 "회사명 + 신규 협력" 형식으로 생성)
- deal_description: 영업기회 설명
- next_action: 다음 액션 권고 (예: "담당자에게 이메일 발송 및 미팅 일정 조율")
- fit_score: AX사업본부 AI/디지털전환 사업 적합도 점수 (0-100). IT기업/대기업/공공기관이면 높게, 소규모 서비스업이면 낮게
- fit_reason: 적합도 점수 이유 한 문장
- tags: 태그 배열 (예: ["AI", "클라우드", "2024H2"])

규칙:
- 명확하게 언급된 정보만 추출 (없으면 null)
- fit_score: 반드시 0-100 정수
- 순수 JSON만 반환, 마크다운 블록 없이`

const FIT_SCORE_PROMPT = `당신은 AX사업본부(AI·디지털전환 컨설팅) B2B 영업 전문가입니다.
아래 거래처 정보를 바탕으로 우리 사업부의 적합도를 평가하세요.

평가 기준:
- IT/AI/디지털전환 관련 기업: +30
- 대기업/중견기업: +20, 스타트업: +10, 중소기업: +5
- 공공기관: +25
- 제조/금융/의료: +15 (디지털전환 수요 높음)
- 서울/경기권: +10

결과: {"fit_score": 0-100, "fit_reason": "이유 한 문장"} JSON만 반환`

async function callGemini(
  prompt: string,
  apiKey: string,
  model: string
): Promise<string> {
  const url = `${GEMINI_API_BASE}/models/${model}:generateContent`
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Gemini API error: ${res.status}`)
  const json = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('Gemini 응답이 비어 있습니다')
  return text
}

export async function parseLeadInput(
  rawInput: string,
  apiKey: string,
  model: string
): Promise<ParsedLeadData> {
  const prompt = `${LEAD_PARSE_PROMPT}\n\n입력:\n${rawInput}`
  const text = await callGemini(prompt, apiKey, model)
  try {
    const parsed = JSON.parse(text)
    return parsed as ParsedLeadData
  } catch {
    throw new Error('Gemini 리드 파싱 JSON 오류')
  }
}

export async function scoreFit(
  accountInfo: { name: string; industry?: string | null; segment?: string | null; size?: string | null; region?: string | null },
  apiKey: string,
  model: string
): Promise<{ fit_score: number; fit_reason: string }> {
  const prompt = `${FIT_SCORE_PROMPT}\n\n거래처:\n${JSON.stringify(accountInfo, null, 2)}`
  const text = await callGemini(prompt, apiKey, model)
  try {
    const parsed = JSON.parse(text) as { fit_score?: number; fit_reason?: string }
    return {
      fit_score: typeof parsed.fit_score === 'number' ? Math.min(100, Math.max(0, parsed.fit_score)) : 50,
      fit_reason: typeof parsed.fit_reason === 'string' ? parsed.fit_reason : '',
    }
  } catch {
    throw new Error('Gemini fit score JSON 오류')
  }
}
