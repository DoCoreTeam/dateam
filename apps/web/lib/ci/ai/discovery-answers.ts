// lib/ci/ai/discovery-answers.ts — 저장된 발견 답을 읽고 쓴다 (서버 전용)
//
// 지문을 만드는 규칙은 순수 계층(analysis/contrast-key.ts)에 있고, 여기는 그것을
// DB 와 주고받기만 한다. 규칙과 왕복을 한 파일에 두면 규칙을 확인하려고 Supabase 를
// 세워야 하고, 그렇게 세운 시험은 규칙이 아니라 연결을 본다.

import { createAdminClient } from '@/lib/supabase/server'
import type { StoredAnswer } from '../analysis/contrast-key.ts'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 이 지문들 중 이미 답이 있는 것을 가져온다.
 *
 * ## 실패하면 빈 표를 준다
 *
 * 저장을 못 읽은 것은 «답이 없다»와 결과가 같다 — 그냥 다시 묻는다. 여기서 던지면
 * 저장 하나가 삐끗했다고 발견 기능 전체가 죽는다. 비싸지지만 죽지는 않는 쪽을 고른다.
 *
 * ## 왜 나눠서 묻나
 *
 * `in()` 에 수백 개를 한 번에 넣으면 URL 길이 상한에 걸려 조용히 잘린다. 잘리면
 * 「답이 없다」로 읽혀 그만큼 다시 묻게 되고, 아무도 그 사실을 모른다.
 */
const IN_CHUNK = 100

export async function loadAnswers(
  workspaceId: string,
  keys: readonly string[],
): Promise<Map<string, StoredAnswer>> {
  const out = new Map<string, StoredAnswer>()
  if (keys.length === 0) return out

  try {
    const adminClient = createAdminClient() as any
    for (let i = 0; i < keys.length; i += IN_CHUNK) {
      const chunk = keys.slice(i, i + IN_CHUNK)
      const { data, error } = await adminClient
        .from('ci_discovery_answers')
        .select('contrast_key, found, statement, observation, kind')
        .eq('workspace_id', workspaceId)
        .in('contrast_key', chunk)

      // supabase-js 는 오류를 던지지 않고 돌려준다. 안 읽으면 조용히 0건이 된다
      if (error) {
        console.error('[ci-discover] 저장된 답 읽기 실패', error.message ?? error)
        return out
      }
      for (const r of (data ?? []) as any[]) {
        out.set(r.contrast_key, {
          found: Boolean(r.found),
          statement: r.statement ?? '',
          observation: r.observation ?? '',
          kind: r.kind ?? 'other',
        })
      }
    }
  } catch (e) {
    console.error('[ci-discover] 저장된 답 읽기 실패', e instanceof Error ? e.message : e)
  }
  return out
}

/**
 * 방금 받은 답을 적는다.
 *
 * ## 저장 실패가 사용자의 일을 막지 않는다
 *
 * 못 적었으면 다음번에 다시 묻게 될 뿐이다. 그 비용 때문에 이미 받은 답을 버리는 것은
 * 앞뒤가 바뀐 일이다. 다만 조용히 넘기지는 않는다 — 계속 못 적고 있으면 절감이
 * 통째로 사라지는데 화면에는 아무 표시도 안 나기 때문이다.
 */
export async function saveAnswer(input: {
  workspaceId: string
  contrastKey: string
  promptVersion: number
  winnerContentId: string
  answer: StoredAnswer
  modelName?: string | null
}): Promise<void> {
  try {
    const adminClient = createAdminClient() as any
    const { error } = await adminClient
      .from('ci_discovery_answers')
      .upsert({
        workspace_id: input.workspaceId,
        contrast_key: input.contrastKey,
        prompt_version: input.promptVersion,
        winner_content_id: input.winnerContentId,
        found: input.answer.found,
        statement: input.answer.statement,
        observation: input.answer.observation,
        kind: input.answer.kind,
        model_name: input.modelName ?? null,
      }, { onConflict: 'workspace_id,contrast_key' })

    if (error) console.error('[ci-discover] 답 저장 실패', error.message ?? error)
  } catch (e) {
    console.error('[ci-discover] 답 저장 실패', e instanceof Error ? e.message : e)
  }
}
