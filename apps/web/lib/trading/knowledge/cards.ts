import 'server-only'

/**
 * 지식 카드 — 만들고 읽는 자리
 *
 * 판정은 `card-policy.ts` 가 하고 호출은 `ai-call.ts` 가 한다.
 * 여기는 DB 왕복과 순서만 맡는다.
 *
 * **읽기는 늘 as-of 를 지난다** — 오늘 쓴 카드가 석 달 전 판단에 섞이면 그 백테스트는
 * 미래를 보고 친 것이다.
 */

import { createAdminClient } from '@/lib/supabase/server'
import { callKnowledge } from './ai-call.ts'
import { applyAsOf } from './as-of.ts'
import {
  parseDraft, isRejection, nextRevision, buildCardPrompt,
  type CardDraft, type CardSource,
} from './card-policy.ts'

export interface KnowledgeCard {
  id: string
  topic: string
  revision: number
  title: string
  body: string
  sources: CardSource[]
  availableAt: Date
}

interface RawCard {
  id: string
  topic: string
  revision: number
  title: string
  body: string
  sources: CardSource[]
  available_at: string
}

/** 그 시각에 볼 수 있던 카드만. 주제마다 가장 높은 판 하나 */
export async function cardsAsOf(asOf: Date, limit = 50): Promise<KnowledgeCard[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await applyAsOf(
    admin
      .from('trading_knowledge_cards')
      .select('id, topic, revision, title, body, sources, available_at')
      .order('topic', { ascending: true })
      .order('revision', { ascending: false })
      .limit(limit * 4),
    asOf,
  )
  if (error) throw new Error(`지식 카드를 읽지 못했습니다: ${error.message}`)

  const best = new Map<string, KnowledgeCard>()
  for (const raw of (data ?? []) as RawCard[]) {
    if (best.has(raw.topic)) continue
    best.set(raw.topic, {
      id: raw.id,
      topic: raw.topic,
      revision: raw.revision,
      title: raw.title,
      body: raw.body,
      sources: Array.isArray(raw.sources) ? raw.sources : [],
      availableAt: new Date(raw.available_at),
    })
  }
  return [...best.values()].slice(0, limit)
}

async function latestRevision(topic: string): Promise<number | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from('trading_knowledge_cards')
    .select('revision')
    .eq('topic', topic)
    .order('revision', { ascending: false })
    .limit(1)
  if (error) throw new Error(`카드 판을 읽지 못했습니다: ${error.message}`)
  const row = (data ?? [])[0] as { revision: number } | undefined
  return row ? row.revision : null
}

export type MakeCardResult =
  | { made: true; cardId: string; revision: number }
  /** **왜 안 만들었는지가 반드시 있다.** 조용히 넘어가지 않는다 */
  | { made: false; reason: string; userMessage: string }

export interface MakeCardInput {
  topic: string
  /** 확인된 사실. 여기 없는 것은 카드에 못 들어간다 */
  facts: readonly string[]
  model?: string | null
  promptVersion: string
}

/** 카드 하나를 만든다. 근거가 없으면 안 만들고 그 사실을 돌려준다 */
export async function makeCard(input: MakeCardInput): Promise<MakeCardResult> {
  if (input.facts.length === 0) {
    return {
      made: false, reason: 'no_facts',
      userMessage: '확인된 사실이 없어 카드를 만들지 않았습니다',
    }
  }

  const call = await callKnowledge({
    purpose: 'knowledge_card',
    prompt: buildCardPrompt(input.topic, input.facts),
    model: input.model,
    json: true,
    maxOutputTokens: 4096,
  })
  if (!call.ok) return { made: false, reason: call.reason, userMessage: call.userMessage }

  let raw: unknown
  try {
    raw = JSON.parse(call.text)
  } catch {
    return { made: false, reason: 'bad_json', userMessage: 'AI 응답을 읽지 못했습니다' }
  }

  const parsed = parseDraft(input.topic, raw)
  if (isRejection(parsed)) {
    return { made: false, reason: parsed.reason, userMessage: parsed.userMessage }
  }
  return saveCardDraft(parsed, call.model, input.promptVersion)
}

/**
 * 이미 글이 있는 초안을 카드로 넣는다.
 *
 * 설정 도우미처럼 **AI 를 이미 한 번 부른** 자리가 쓴다. `makeCard` 를 다시 부르면
 * 같은 글을 만들려고 AI 를 두 번 부르게 되고, 예산이 두 배로 나간다.
 */
export async function saveCardDraft(
  draft: CardDraft, model: string, promptVersion: string,
): Promise<MakeCardResult> {
  const revision = nextRevision(await latestRevision(draft.topic))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin.from('trading_knowledge_cards').insert({
    topic: draft.topic,
    revision,
    title: draft.title,
    body: draft.body,
    sources: draft.sources,
    model,
    prompt_version: promptVersion,
    // `available_at` 을 **안 적는다.** DB 기본값 `now()` 가 쓴 시각을 박는다 —
    // 앱이 값을 넘길 수 있게 두면 「그때도 알았던 것으로 해 두자」가 생긴다
  }).select('id')

  if (error) {
    // 같은 판이 이미 있다 = 다른 실행이 먼저 만들었다. 오류가 아니다
    if (error.code === '23505' || /duplicate key/i.test(error.message)) {
      return { made: false, reason: 'already_made', userMessage: '이미 만든 카드입니다' }
    }
    return { made: false, reason: `save_failed:${error.message}`.slice(0, 300), userMessage: '카드를 저장하지 못했습니다' }
  }
  const id = (data ?? [])[0]?.id as string | undefined
  if (!id) return { made: false, reason: 'no_id_returned', userMessage: '카드를 저장하지 못했습니다' }
  return { made: true, cardId: id, revision }
}
