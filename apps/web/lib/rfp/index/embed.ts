/**
 * 청크 임베딩 (설계서 3.3.5)
 *
 * ## 모델 이름을 값과 함께 저장하는 이유
 *
 * 임베딩은 **모델이 바뀌면 이전 값과 비교가 안 된다.** 차원이 같아도 좌표계가 다르다.
 * 그래서 모델을 올리면 전체를 다시 만들어야 하는데, 어느 청크가 어느 모델로 만들어졌는지
 * 모르면 **전부 다시 만드는 수밖에 없다** — 10만 청크면 그게 곧 비용이다.
 *
 * ## 실패를 저장 자체를 막는 데 쓰지 않는다
 *
 * 임베딩이 안 되면 벡터 검색만 못 한다. 키워드 검색은 여전히 된다.
 * 그런데 임베딩 실패로 청크 저장을 막으면 **키워드 검색까지 통째로 죽는다.**
 */

import type { Chunk } from './chunk.ts'

/**
 * 지금 쓰는 모델과 차원.
 *
 * 저장소 SSOT 는 `lib/gemini-embedding.ts` 다. 여기서 그 파일을 import 하지 않는 이유는
 * 그쪽이 `@/lib/token-logger` 를 끌어와 **순수 함수 테스트가 앱 전체 별칭 설정을 요구하게** 되기 때문이다.
 * 대신 가드가 두 파일의 값이 같은지 소스에서 직접 대조한다(chunk.test.ts).
 */
export const EMBEDDING_MODEL = 'gemini-embedding-001'
export const EMBED_DIM = 768

export interface EmbeddedChunk extends Chunk {
  /** 실패하면 null — 저장은 그대로 하고 벡터 검색만 못 한다 */
  embedding: number[] | null
  /** 어느 모델로 만든 값인가. null 이면 아직 임베딩 안 된 것 */
  embeddingModel: string | null
}

/** 한 번에 몇 개씩 부를까. 너무 크면 한 건이 실패할 때 전부 다시 해야 한다 */
export const EMBED_BATCH = 16

export type EmbedFn = (text: string) => Promise<number[] | null>

/**
 * 여러 글을 **한 요청으로** 임베딩하는 창구.
 *
 * 한 건짜리(EmbedFn)만 받으면 «묶어서 보낸다»가 «동시에 보낸다»로 끝난다 —
 * 실제로 그랬다. Promise.all 로 열여섯씩 뿌렸지만 요청 수는 조각 수와 같았고,
 * 분당 한도를 넘긴 것이 그것이다. 돌려주는 배열은 넣은 것과 길이와 순서가 같다.
 */
export type EmbedBatchFn = (texts: readonly string[]) => Promise<(number[] | null)[]>

/**
 * 청크에 임베딩을 붙인다.
 *
 * 실패한 것은 `embedding: null` 로 남긴다 — 다음 실행이 그것만 골라 다시 만든다.
 * 던지면 성공한 것까지 버려지고 같은 비용을 두 번 낸다.
 */
export async function embedChunks(
  chunks: readonly Chunk[],
  embed: EmbedBatchFn,
  model = EMBEDDING_MODEL,
): Promise<EmbeddedChunk[]> {
  const out: EmbeddedChunk[] = []

  for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
    const batch = chunks.slice(i, i + EMBED_BATCH)
    let results: (number[] | null)[]
    try {
      results = await embed(batch.map((c) => c.text))
    } catch {
      // 한 묶음이 죽어도 앞뒤 묶음은 산다. 던지면 성공한 것까지 버려지고 같은 비용을 두 번 낸다
      results = batch.map(() => null)
    }
    batch.forEach((c, k) => {
      const v = isValidVector(results[k]) ? results[k] : null
      out.push({ ...c, embedding: v, embeddingModel: v ? model : null })
    })
  }
  return out
}

/**
 * 한 건짜리 창구를 묶음 창구 모양으로 감싼다.
 *
 * **요청 수는 안 줄어든다.** 묶음을 못 쓰는 자리(시험, 묶음 API 가 없는 공급자)만
 * 쓰라고 둔 것이고, 이름이 그 사실을 말하게 했다 — `embedChunks(chunks, oneByOne(f))`
 * 를 읽으면 한 건씩 나간다는 것이 그 줄에서 보인다.
 */
export function oneByOne(embed: EmbedFn): EmbedBatchFn {
  return async (texts) => Promise.all(texts.map(async (t) => {
    try {
      return await embed(t)
    } catch {
      return null
    }
  }))
}

/** 차원이 다른 벡터는 저장하지 않는다 — 저장하면 검색이 조용히 0건이 된다 */
export function isValidVector(v: number[] | null | undefined): v is number[] {
  return Array.isArray(v) && v.length === EMBED_DIM && v.every((n) => Number.isFinite(n))
}

export interface StoredChunk {
  chunkKey: string
  embeddingModel: string | null
}

/**
 * 모델을 바꿨을 때 다시 만들 대상을 고른다.
 *
 * 「전부 다시」와 「바뀐 것만」의 차이가 곧 비용이다.
 */
export function needsReembedding(
  stored: readonly StoredChunk[],
  currentModel = EMBEDDING_MODEL,
): string[] {
  return stored
    .filter((c) => c.embeddingModel !== currentModel)
    .map((c) => c.chunkKey)
}

/** 임베딩이 붙은 비율 — 낮으면 화면이 「벡터 검색 일부 불가」를 알린다 */
export function embeddingCoverage(chunks: readonly EmbeddedChunk[]): number {
  if (chunks.length === 0) return 0
  return chunks.filter((c) => c.embedding !== null).length / chunks.length
}
