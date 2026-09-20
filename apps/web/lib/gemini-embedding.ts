// Gemini 임베딩 — text-embedding-004 (768차원)
// 메모(daily_logs.entry_type='note') 의미 클러스터링용
import { logTokenUsage } from '@/lib/token-logger'
import type { AiFeature } from '@/types/database'
import { guardedVector, guardedVectors, type AiLedger } from '@/lib/ai/guarded-call'
import { serverAiLedger } from '@/lib/ai/ledger'
import { serverKnownNames } from '@/lib/ai/known-names'
import { withProviderKeys, type KeyRotationDeps } from '@/lib/ai/key-rotation'

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
    /** 안 주면 구성원과 주소록 이름 전체 */
    knownNames?: readonly string[]
    /** 안 주면 서버 원장 */
    ledger?: AiLedger
    /** Gemini 키 여러 개. 안 주면 표에서 읽는다 */
    keys?: KeyRotationDeps
  },
): Promise<EmbedResult | null> {
  const trimmed = text.trim()
  if (!trimmed || !apiKey) return null

  const taskType = opts?.taskType ?? 'CLUSTERING'
  const feature: AiFeature = opts?.feature ?? 'memo-embedding'

  try {
    // 벡터는 되돌릴 수 없다 — 안 가리고 보내면 개인정보가 **숫자로 남의 서버에 남는다**
    const out = await withProviderKeys('gemini', apiKey, async (key, entry) => guardedVector<number[]>(
      trimmed.slice(0, 2000),
      {
        surface: feature, purpose: `embed:${taskType}`, actorId: userId ?? null,
        providerId: 'gemini', modelName: EMBED_MODEL, keyRef: entry.label,
        knownNames: opts?.knownNames ?? await serverKnownNames(),
      },
      opts?.ledger ?? serverAiLedger(),
      async (maskedText) => {
        const url = `${GEMINI_API_BASE}/models/${EMBED_MODEL}:embedContent`
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({
            model: `models/${EMBED_MODEL}`,
            content: { parts: [{ text: maskedText }] },
            taskType,
            outputDimensionality: EMBED_DIM,
          }),
          cache: 'no-store',
          signal: AbortSignal.timeout(60_000),
        })
        if (!res.ok) {
          console.error('[gemini-embedding] API error', res.status, res.statusText)
          /*
            **한도와 인증은 던진다.** 그래야 다음 키로 넘어간다 —
            여기서 null 을 돌려주면 「키가 마름」과 「임베딩 못 만듦」이 같은 값이 되고,
            등록된 다음 키는 한 번도 안 쓰인다.
            그 밖의 실패는 지금대로 null 이다(메모 저장 자체는 막지 않는다).
          */
          if (res.status === 429 || res.status === 401 || res.status === 403) {
            throw new Error(`Gemini 임베딩 오류 (${res.status})`)
          }
          return null
        }
        const json = (await res.json()) as { embedding?: { values?: number[] } }
        const values = json.embedding?.values
        if (!values || values.length !== EMBED_DIM) return null
        // 임베딩은 토큰 사용량을 별도 반환하지 않음 — 대략 추정(문자수/4)
        return { value: values, tokens: Math.ceil(maskedText.length / 4) }
      },
    ), opts?.keys)
    if (!out) return null

    const estTokens = out.tokens ?? 0
    logTokenUsage({
      userId: userId ?? null,
      feature,
      model: EMBED_MODEL,
      promptTokens: estTokens,
      outputTokens: 0,
      totalTokens: estTokens,
    })

    return { embedding: out.value, tokens: estTokens }
  } catch (e) {
    console.error('[gemini-embedding] failed', e)
    return null
  }
}

/** 한 요청에 담는 최대 건수. 벤더 상한(100)보다 낮게 잡아 여유를 둔다 */
export const EMBED_BATCH_MAX = 50

/**
 * 여러 글을 **한 요청으로** 임베딩한다.
 *
 * ## 왜 필요한가
 *
 * 벤더 한도는 요청 수로 센다. 건마다 부르면 조각 수만큼 요청이 나간다 —
 * 실측 2026-09-20 분당 한도 100 에 110회가 나갔고, 그 대부분이 색인이었다.
 * `Promise.all` 로 끊어 뿌리는 것은 동시에 보낼 뿐 요청 수는 그대로다.
 *
 * ## 실패는 건 단위로 남긴다
 *
 * 묶음 안 한 건이 못 오면 그 자리만 null 이고 나머지는 산다. 통째로 버리면
 * 조각 하나 때문에 문서 전체를 다시 만들게 되고, 다시 만드는 동안 또 한도를 쓴다.
 * **돌려주는 배열의 순서와 길이는 넣은 것과 같다** — 자리로 맞춰 쓰는 쪽이 있다.
 */
export async function embedTexts(
  texts: readonly string[],
  apiKey: string,
  userId?: string | null,
  opts?: {
    taskType?: 'CLUSTERING' | 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY'
    feature?: AiFeature
    knownNames?: readonly string[]
    ledger?: AiLedger
    /** Gemini 키 여러 개. 안 주면 표에서 읽는다 */
    keys?: KeyRotationDeps
  },
): Promise<(number[] | null)[]> {
  if (texts.length === 0) return []
  if (!apiKey) return texts.map(() => null)

  const taskType = opts?.taskType ?? 'RETRIEVAL_DOCUMENT'
  const feature: AiFeature = opts?.feature ?? 'memo-embedding'
  const knownNames = opts?.knownNames ?? await serverKnownNames()
  const ledger = opts?.ledger ?? serverAiLedger()

  const out: (number[] | null)[] = []
  for (let i = 0; i < texts.length; i += EMBED_BATCH_MAX) {
    const slice = texts.slice(i, i + EMBED_BATCH_MAX).map((t) => t.trim().slice(0, 2000))
    try {
      const got = await withProviderKeys('gemini', apiKey, async (key, entry) => guardedVectors<number[]>(
        slice,
        {
          surface: feature, purpose: `embed_batch:${taskType}`, actorId: userId ?? null,
          providerId: 'gemini', modelName: EMBED_MODEL, keyRef: entry.label, knownNames,
        },
        ledger,
        async (maskedTexts) => {
          const url = `${GEMINI_API_BASE}/models/${EMBED_MODEL}:batchEmbedContents`
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
            body: JSON.stringify({
              requests: maskedTexts.map((t) => ({
                model: `models/${EMBED_MODEL}`,
                content: { parts: [{ text: t }] },
                taskType,
                outputDimensionality: EMBED_DIM,
              })),
            }),
            cache: 'no-store',
            signal: AbortSignal.timeout(60_000),
          })
          if (!res.ok) {
            console.error('[gemini-embedding] batch API error', res.status, res.statusText)
            // 한도와 인증은 던져 다음 키로 간다. 여기서 null 로 덮으면 묶음 전체가
            // 조용히 비고, 등록된 다음 키는 한 번도 안 쓰인다
            if (res.status === 429 || res.status === 401 || res.status === 403) {
              throw new Error(`Gemini 임베딩 오류 (${res.status})`)
            }
            return maskedTexts.map(() => null)
          }
          const json = (await res.json()) as { embeddings?: { values?: number[] }[] }
          const rows = json.embeddings ?? []
          // 자리로 맞춘다. 벤더가 덜 주면 뒤가 빈 것이지 앞이 밀리는 것이 아니다
          return maskedTexts.map((t, k) => {
            const values = rows[k]?.values
            if (!values || values.length !== EMBED_DIM) return null
            return { value: values, tokens: Math.ceil(t.length / 4) }
          })
        },
      ), opts?.keys)
      out.push(...got.map((g) => g?.value ?? null))

      const estTokens = got.reduce((n, g) => n + (g?.tokens ?? 0), 0)
      logTokenUsage({
        userId: userId ?? null, feature, model: EMBED_MODEL,
        promptTokens: estTokens, outputTokens: 0, totalTokens: estTokens,
      })
    } catch (e) {
      console.error('[gemini-embedding] batch failed', e)
      out.push(...slice.map(() => null))
    }
  }
  return out
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
