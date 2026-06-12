// 회사 정보 AI 자동채움 — 공급사·경쟁사 공통. 회사명(+웹사이트)으로 기본 정보를 추정.
//   §5-3 준수: 결과는 "제안"이며 폼에 미리채움(편집 가능)·저장 단계는 사용자가 수행. 자동 DB 덮어쓰기 금지.
//   Gemini 호출은 gemini-lead.ts와 동일 패턴(responseMimeType json).
import { GEMINI_API_BASE } from '@/lib/gpu/extract-helpers'

const COMPETITOR_TYPE_SET = new Set(['hyperscaler', 'specialist', 'marketplace', 'domestic'])
// http(s) URL만 허용 — javascript:/data: 등 위험 스킴 차단(저장 후 <a href> 렌더 XSS 방지)
function safeUrl(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null
  try { const u = new URL(v.trim()); return (u.protocol === 'http:' || u.protocol === 'https:') ? u.toString() : null }
  catch { return null }
}

export interface CompanyEnrichInput {
  name: string
  website?: string | null
  kind: 'supplier' | 'competitor'
}

export interface CompanyEnrichResult {
  description: string | null
  country: string | null      // ISO-3166 alpha-2 대문자 (KR/US/JP…)
  type: string | null         // competitor: hyperscaler|specialist|marketplace|domestic
  location: string | null     // supplier: 도시/지역
  website: string | null
  pricing_url: string | null
}

const COMPETITOR_TYPES = 'hyperscaler(대형 클라우드)|specialist(전용 GPU 서비스)|marketplace(마켓플레이스)|domestic(국내)'

function buildPrompt(input: CompanyEnrichInput): string {
  const roleHint = input.kind === 'competitor'
    ? `이 회사는 GPU 클라우드 "경쟁사"입니다. type을 다음 중 하나로 분류: ${COMPETITOR_TYPES}.`
    : '이 회사는 우리가 GPU를 매입하는 "공급사"입니다. location에 본사 도시/지역을 넣으세요.'
  return `당신은 GPU 클라우드/데이터센터 업계 정보 전문가입니다. 아래 회사의 공개 정보를 추정해 JSON으로만 반환하세요.

회사명: ${input.name}
${input.website ? `웹사이트: ${input.website}` : ''}
${roleHint}

규칙:
- 확실하지 않은 값은 null. 추측 금지(틀린 정보보다 null이 낫다).
- description: 한국어 1~2문장 회사 소개(본사 국가·주력 GPU/서비스 포함).
- country: ISO-3166-1 alpha-2 대문자 2글자(예: KR, US, JP, TW). 모르면 null.
- website / pricing_url: 알면 정확한 URL, 모르면 null.
- 가격·견적 금액은 절대 포함하지 말 것(정보만).

JSON 스키마(이 키만):
{"description": string|null, "country": string|null, "type": string|null, "location": string|null, "website": string|null, "pricing_url": string|null}

JSON만 반환. 설명 문장 금지.`
}

export interface EnrichResponse {
  result: CompanyEnrichResult
  usage: { promptTokens: number; outputTokens: number; totalTokens: number }
}

export async function enrichCompany(
  input: CompanyEnrichInput, apiKey: string, model: string,
): Promise<EnrichResponse> {
  const url = `${GEMINI_API_BASE}/models/${model}:generateContent`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: buildPrompt(input) }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
    }),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Gemini API error: ${res.status}`)
  const json = await res.json() as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number }
  }
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('Gemini 응답이 비어 있습니다')

  let parsed: Record<string, unknown>
  try { parsed = JSON.parse(text) } catch { throw new Error('Gemini 응답 JSON 파싱 실패') }

  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const country = str(parsed.country)
  const type = str(parsed.type)
  const result: CompanyEnrichResult = {
    description: str(parsed.description),
    // ISO alpha-2만 허용(2글자 영문) — 아니면 null
    country: country && /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : null,
    // type 화이트리스트(서버 정규화 SSOT) — 경쟁사 4종 외엔 null
    type: type && COMPETITOR_TYPE_SET.has(type) ? type : null,
    location: str(parsed.location),
    website: safeUrl(parsed.website),       // http(s)만
    pricing_url: safeUrl(parsed.pricing_url),
  }
  return {
    result,
    usage: {
      promptTokens: json.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
      totalTokens: json.usageMetadata?.totalTokenCount ?? 0,
    },
  }
}
