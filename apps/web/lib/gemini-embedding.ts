// Gemini 임베딩 — text-embedding-004 (768차원)
// 메모(daily_logs.entry_type='note') 의미 클러스터링용
import { logTokenUsage } from '@/lib/token-logger'
import type { AiFeature } from '@/types/database'

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'
const EMBED_MODEL = 'gemini-embedding-001'
export const EMBED_DIM = 768

interface EmbedResult {
  embedding: number[]
  tokens: number
}

/**
 * 단일 텍스트 임베딩 생성. 실패 시 null 반환(메모 저장 자체는 막지 않음).
 * opts 기본값(taskType='CLUSTERING', feature='memo-embedding')은 기존 메모 경로 동작 불변(회귀 0).
 */
export async function embedText(
  text: string,
  apiKey: string,
  userId?: string | null,
  opts?: {
    taskType?: 'CLUSTERING' | 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY'
    feature?: AiFeature
  },
): Promise<EmbedResult | null> {
  const trimmed = text.trim()
  if (!trimmed || !apiKey) return null

  const taskType = opts?.taskType ?? 'CLUSTERING'
  const feature: AiFeature = opts?.feature ?? 'memo-embedding'

  try {
    const url = `${GEMINI_API_BASE}/models/${EMBED_MODEL}:embedContent`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        model: `models/${EMBED_MODEL}`,
        content: { parts: [{ text: trimmed.slice(0, 2000) }] },
        taskType,
        outputDimensionality: EMBED_DIM,
      }),
      cache: 'no-store',
    })
    if (!res.ok) {
      console.error('[gemini-embedding] API error', res.status, res.statusText)
      return null
    }
    const json = (await res.json()) as { embedding?: { values?: number[] } }
    const values = json.embedding?.values
    if (!values || values.length !== EMBED_DIM) return null

    // 임베딩은 토큰 사용량을 별도 반환하지 않음 — 대략 추정(문자수/4)
    const estTokens = Math.ceil(trimmed.length / 4)
    logTokenUsage({
      userId: userId ?? null,
      feature,
      model: EMBED_MODEL,
      promptTokens: estTokens,
      outputTokens: 0,
      totalTokens: estTokens,
    })

    return { embedding: values, tokens: estTokens }
  } catch (e) {
    console.error('[gemini-embedding] failed', e)
    return null
  }
}

/** pgvector 리터럴 문자열로 변환: [0.1,0.2,...] */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`
}

/** 코사인 유사도 (정규화 안 된 벡터 대응) */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}
