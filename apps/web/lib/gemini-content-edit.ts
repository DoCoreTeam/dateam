import { logTokenUsage } from '@/lib/token-logger'
import type { AiFeature } from '@/types/database'

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

export interface ColumnSchema {
  key: string
  label: string
  type?: string
}

export async function aiEditContentSection(
  sectionName: string,
  columns: ColumnSchema[],
  currentData: Record<string, unknown>[],
  userPrompt: string,
  apiKey: string,
  model: string,
  userId?: string | null
): Promise<Record<string, unknown>[]> {
  const url = `${GEMINI_API_BASE}/models/${model}:generateContent`

  const schemaDesc = columns
    .map((c) => `  - "${c.key}" (${c.label}${c.type === 'tags' ? ', 문자열 배열' : c.type === 'number' ? ', 숫자' : ', 문자열'})`)
    .join('\n')

  const systemPrompt = `당신은 기업 내부 데이터 편집 전문가입니다.
"${sectionName}" 섹션의 데이터를 사용자 요청에 따라 수정하고, 동일한 JSON 배열 형식으로 반환하세요.

데이터 스키마 (각 행의 필드):
${schemaDesc}

절대 규칙:
1. 위 스키마의 필드만 사용 (다른 필드 추가 금지)
2. tags 타입 필드는 반드시 문자열 배열(string[])로 반환
3. number 타입 필드는 숫자(따옴표 없이)로 반환
4. 스키마에 없는 내용 창작 금지 — 사용자가 지정한 변경만 적용
5. 변경하지 않은 행은 원본 그대로 유지
6. 행 삭제 요청 시 해당 행을 배열에서 제거

반환: 순수 JSON 배열만. 설명·마크다운 코드블록 없이.`

  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `${systemPrompt}\n\n현재 데이터:\n${JSON.stringify(currentData, null, 2)}\n\n사용자 요청: ${userPrompt}`,
          },
        ],
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

  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number }
  }
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('Gemini 응답이 비어 있습니다')

  logTokenUsage({
    userId: userId ?? null,
    feature: 'content-ai-edit' as AiFeature,
    model,
    promptTokens: json.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
    totalTokens: json.usageMetadata?.totalTokenCount ?? 0,
  })

  const parsed = JSON.parse(text)
  if (!Array.isArray(parsed)) throw new Error('Gemini 응답 형식이 올바르지 않습니다')

  // Sanitize: only allowed schema keys + enforce types
  return parsed.map((item: unknown) => {
    if (typeof item !== 'object' || item === null) return {}
    const row = item as Record<string, unknown>
    return Object.fromEntries(
      columns.map((c) => {
        let val = row[c.key]
        if (c.type === 'tags') {
          if (!Array.isArray(val)) {
            val = typeof val === 'string' && val ? val.split(',').map((s) => s.trim()) : []
          }
        } else if (c.type === 'number') {
          const n = Number(val)
          val = Number.isFinite(n) ? n : 0
        } else {
          val = typeof val === 'string' ? val : val != null ? String(val) : ''
        }
        return [c.key, val]
      })
    )
  })
}
