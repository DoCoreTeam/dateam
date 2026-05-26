import { logTokenUsage } from '@/lib/token-logger'
import type { AiFeature } from '@/types/database'

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

const GEMINI_VISION_MIME_TYPES = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif',
  'image/bmp', 'image/tiff', 'image/heic', 'image/heif', 'image/avif',
  'application/pdf',
])

export function isVisionMimeType(mimeType: string): boolean {
  return GEMINI_VISION_MIME_TYPES.has(mimeType.toLowerCase())
}

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
  next_action_date?: string | null
  fit_score?: number
  fit_reason?: string
  tags?: string[]
  registration_number?: string | null
  source?: string | null
  // BULK_MODE 전용 필드
  gpu_demand_intensity?: string | null
  account_type?: string | null
  deal_value_billion?: number | null
  product_recommendation?: string | null
  lead_type?: string | null
  hw_included?: boolean | null
  is_new_deal?: boolean | null
  contact_role?: string | null
  expected_date?: string | null
  funding_source?: string | null
  procurement_status?: string | null
  bulk_import_row?: number
}

export interface ColumnIndexMap {
  companyName: number
  registrationNumber?: number
  industry?: number
  accountType?: number
  gpuDemand?: number
  tier?: number
  businessJudge?: number
  region?: number
  contactName?: number
  contactTitle?: number
  contactPhone?: number
  contactEmail?: number
  productRecommendation?: number
  dealValueBillion?: number
  dealTitle?: number
  expectedDate?: number
  newOrContinue?: number
  hwIncluded?: number
  fundingSource?: number
  procurementStatus?: number
  fitScore?: number
  notes?: number
  sourceKind?: 'private' | 'public'
}

const BULK_LEAD_PARSE_PROMPT = `당신은 CRM 데이터 정규화 전문가입니다.
아래는 고객 데이터베이스에서 추출한 행 목록입니다. 각 행을 JSON 객체로 변환하여 배열로 반환하세요.

[필드 매핑 규칙]
- 회사명 → company_name (필수)
- 기관명 → company_name (필수, 공공 파일)
- 사업자번호/기관번호 → registration_number
- 업종/산업/업태 → industry (있을 때만. 없으면 null. 절대 다른 필드에서 추론하거나 만들지 말 것)
- 거래처유형/고객유형/유형/기관유형 → account_type (민간/국가기관/지자체/공공기관/교육/대학/병원/파트너 중 가장 가까운 값)
- GPU수요강도 → gpu_demand_intensity: "최상"/"상"/"중"/"하"
- Tier → segment: T1/T2/공공/파트너 중 가장 가까운 값
- 소재지 → region (시/도 단위 정규화)
- 담당자 → contact_name
- 직책 → contact_title
- 연락처 → contact_phone (하이픈 정규화)
- 이메일 → contact_email (소문자 정규화)
- 사업명/품목명 → deal_title
- 추천제안 → product_recommendation
- 예상딜밸류(억)/당해금액/총사업금액/HW예산/구매예산 → deal_value_billion (억원 단위 숫자, null 허용)
- 발주시기/예상시기 → expected_date
- 신규/계속 → is_new_deal (신규 true, 계속 false)
- HW도입/HW도입여부 → hw_included
- 재원 → funding_source
- 발주여부 → procurement_status
- 적합도 → fit_score (0-100 정수, null 허용. 절대 "Fit N" 형식 문자열 금지)
- 비고/사업개요/제안각도 → deal_description 또는 next_action
- source가 private이면 lead_type="기업형", source가 public이면 lead_type="사업형"

[중요 금지 사항]
- industry 필드에 숫자, "Fit N", 점수 형식 값을 넣지 말 것
- 데이터에 없는 필드는 null로 반환하거나 키를 생략할 것
- 추론하거나 만들어낸 업종 금지

[출력 형식]
반드시 JSON 배열만 반환. 마크다운 없음. 설명 없음.
[{"company_name": "...", "gpu_demand_intensity": "상", "segment": "T1", ...}, ...]

[데이터]`

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
- registration_number: 사업자번호 또는 기관번호(명확할 때만)
- account_type: 거래처유형 (민간, 국가기관, 지자체, 공공기관, 교육, 대학, 병원, 파트너)
- gpu_demand_intensity: GPU 수요 강도 (최상, 상, 중, 하)
- contact_name: 담당자 이름
- contact_title: 직함/직책
- contact_department: 부서
- contact_email: 이메일
- contact_phone: 직통 전화
- contact_mobile: 휴대폰
- deal_title: 영업기회 제목 (없으면 "회사명 + 신규 협력" 형식으로 생성)
- deal_description: 영업기회 설명
- lead_type: 기업형 또는 사업형
- product_recommendation: gcube임대, 하이퍼큐브, 예약형, 번들 중 가장 가까운 제품
- deal_value_billion: 예상금액이 있으면 억원 단위 숫자
- expected_date: 예상시기/발주시기
- hw_included: HW 도입 여부
- is_new_deal: 신규면 true, 계속이면 false
- funding_source: 재원
- procurement_status: 발주여부
- next_action: 다음 액션 권고 (예: "담당자에게 이메일 발송 및 미팅 일정 조율")
- next_action_date: 다음 액션 기한(YYYY-MM-DD를 알 수 있을 때만)
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

async function callGeminiWithVision(
  base64Data: string,
  mimeType: string,
  apiKey: string,
  model: string
): Promise<{ text: string; usage: { promptTokens: number; outputTokens: number; totalTokens: number } }> {
  const url = `${GEMINI_API_BASE}/models/${model}:generateContent`
  const body = {
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { mimeType, data: base64Data } },
        { text: LEAD_PARSE_PROMPT },
      ],
    }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Gemini Vision API error: ${res.status}`)
  const json = await res.json() as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number }
  }
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('Gemini Vision 응답이 비어 있습니다')
  return {
    text,
    usage: {
      promptTokens: json.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
      totalTokens: json.usageMetadata?.totalTokenCount ?? 0,
    },
  }
}

export async function parseLeadFromVision(
  buffer: Buffer,
  mimeType: string,
  apiKey: string,
  model: string,
  userId?: string | null
): Promise<ParsedLeadData> {
  const base64 = buffer.toString('base64')
  const { text, usage } = await callGeminiWithVision(base64, mimeType, apiKey, model)
  try {
    const parsed = JSON.parse(text) as ParsedLeadData
    logTokenUsage({ userId: userId ?? null, feature: 'lead-parse' as AiFeature, model, ...usage })
    return parsed
  } catch {
    throw new Error('Gemini Vision 리드 파싱 JSON 오류')
  }
}

async function callGemini(
  prompt: string,
  apiKey: string,
  model: string
): Promise<{ text: string; usage: { promptTokens: number; outputTokens: number; totalTokens: number } }> {
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
  const json = await res.json() as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number }
  }
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('Gemini 응답이 비어 있습니다')
  const usage = {
    promptTokens: json.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
    totalTokens: json.usageMetadata?.totalTokenCount ?? 0,
  }
  return { text, usage }
}

export async function parseLeadInput(
  rawInput: string,
  apiKey: string,
  model: string,
  userId?: string | null
): Promise<ParsedLeadData> {
  const prompt = `${LEAD_PARSE_PROMPT}\n\n입력:\n${rawInput}`
  const { text, usage } = await callGemini(prompt, apiKey, model)
  try {
    const parsed = JSON.parse(text)
    logTokenUsage({ userId: userId ?? null, feature: 'lead-parse' as AiFeature, model, ...usage })
    return parsed as ParsedLeadData
  } catch {
    throw new Error('Gemini 리드 파싱 JSON 오류')
  }
}

export async function parseBulkLeadChunk(
  rows: string[][],
  colMap: ColumnIndexMap,
  apiKey: string,
  model: string,
  userId?: string | null,
  chunkStartRow = 0
): Promise<ParsedLeadData[]> {
  const rowsText = rows.map((row, i) => {
    const fields: Record<string, string> = {}
    if (colMap.companyName < row.length) fields['회사명/기관명'] = row[colMap.companyName] ?? ''
    if (colMap.registrationNumber !== undefined && colMap.registrationNumber < row.length) fields['사업자번호/기관번호'] = row[colMap.registrationNumber] ?? ''
    if (colMap.industry !== undefined && colMap.industry < row.length) fields['업종'] = row[colMap.industry] ?? ''
    if (colMap.accountType !== undefined && colMap.accountType < row.length) fields['거래처유형/기관유형'] = row[colMap.accountType] ?? ''
    if (colMap.gpuDemand !== undefined && colMap.gpuDemand < row.length) fields['GPU수요강도'] = row[colMap.gpuDemand] ?? ''
    if (colMap.tier !== undefined && colMap.tier < row.length) fields['Tier'] = row[colMap.tier] ?? ''
    if (colMap.businessJudge !== undefined && colMap.businessJudge < row.length) fields['사업판단'] = row[colMap.businessJudge] ?? ''
    if (colMap.region !== undefined && colMap.region < row.length) fields['소재지'] = row[colMap.region] ?? ''
    if (colMap.contactName !== undefined && colMap.contactName < row.length) fields['담당자'] = row[colMap.contactName] ?? ''
    if (colMap.contactTitle !== undefined && colMap.contactTitle < row.length) fields['직책'] = row[colMap.contactTitle] ?? ''
    if (colMap.contactPhone !== undefined && colMap.contactPhone < row.length) fields['연락처'] = row[colMap.contactPhone] ?? ''
    if (colMap.contactEmail !== undefined && colMap.contactEmail < row.length) fields['이메일'] = row[colMap.contactEmail] ?? ''
    if (colMap.dealTitle !== undefined && colMap.dealTitle < row.length) fields['사업명/품목명'] = row[colMap.dealTitle] ?? ''
    if (colMap.productRecommendation !== undefined && colMap.productRecommendation < row.length) fields['추천제안'] = row[colMap.productRecommendation] ?? ''
    if (colMap.dealValueBillion !== undefined && colMap.dealValueBillion < row.length) fields['예상딜밸류(억)'] = row[colMap.dealValueBillion] ?? ''
    if (colMap.expectedDate !== undefined && colMap.expectedDate < row.length) fields['발주시기'] = row[colMap.expectedDate] ?? ''
    if (colMap.newOrContinue !== undefined && colMap.newOrContinue < row.length) fields['신규/계속'] = row[colMap.newOrContinue] ?? ''
    if (colMap.hwIncluded !== undefined && colMap.hwIncluded < row.length) fields['HW도입'] = row[colMap.hwIncluded] ?? ''
    if (colMap.fundingSource !== undefined && colMap.fundingSource < row.length) fields['재원'] = row[colMap.fundingSource] ?? ''
    if (colMap.procurementStatus !== undefined && colMap.procurementStatus < row.length) fields['발주여부'] = row[colMap.procurementStatus] ?? ''
    if (colMap.fitScore !== undefined && colMap.fitScore < row.length) fields['적합도'] = row[colMap.fitScore] ?? ''
    if (colMap.notes !== undefined && colMap.notes < row.length) fields['비고'] = row[colMap.notes] ?? ''
    fields['source'] = colMap.sourceKind ?? 'private'
    return `행${chunkStartRow + i + 1}: ${JSON.stringify(fields)}`
  }).join('\n')

  const prompt = `${BULK_LEAD_PARSE_PROMPT}\n${rowsText}`
  const { text, usage } = await callGemini(prompt, apiKey, model)

  logTokenUsage({ userId: userId ?? null, feature: 'lead-parse' as AiFeature, model, ...usage })

  let parsed: ParsedLeadData[]
  try {
    const raw = JSON.parse(text)
    parsed = Array.isArray(raw) ? raw as ParsedLeadData[] : []
  } catch {
    // 파싱 실패 시 빈 배열 (각 행을 failed로 처리)
    return rows.map((_, i) => ({ bulk_import_row: chunkStartRow + i + 1 }))
  }

  return parsed.map((item, i) => ({
    ...item,
    bulk_import_row: chunkStartRow + i + 1,
  }))
}

export async function scoreFit(
  accountInfo: { name: string; industry?: string | null; segment?: string | null; size?: string | null; region?: string | null },
  apiKey: string,
  model: string,
  userId?: string | null
): Promise<{ fit_score: number; fit_reason: string }> {
  const prompt = `${FIT_SCORE_PROMPT}\n\n거래처:\n${JSON.stringify(accountInfo, null, 2)}`
  const { text, usage } = await callGemini(prompt, apiKey, model)
  try {
    const parsed = JSON.parse(text) as { fit_score?: number; fit_reason?: string }
    logTokenUsage({ userId: userId ?? null, feature: 'account-fit-score' as AiFeature, model, ...usage })
    return {
      fit_score: typeof parsed.fit_score === 'number' ? Math.min(100, Math.max(0, parsed.fit_score)) : 50,
      fit_reason: typeof parsed.fit_reason === 'string' ? parsed.fit_reason : '',
    }
  } catch {
    throw new Error('Gemini fit score JSON 오류')
  }
}
