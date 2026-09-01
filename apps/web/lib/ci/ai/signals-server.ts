// lib/ci/ai/signals-server.ts — 이슈 후보를 웹에서 모아 온다 (서버 전용)
//
// **왜 새로 짜지 않았나**: 「모델이 인터넷을 보게 하는 일」은 이 저장소에 이미 있다 —
// `lib/crm/ai/adapters/host.ts` 가 Gemini `google_search` · Claude `web_search` 를 켜고
// 인용(citation)까지 모아 준다. CRM 회사 보강이 그 길로 돌고 있다.
// 여기서 HTTP 호출을 다시 짜면 모델 폴백·한도 판정·타임아웃이 두 벌이 되고,
// 한쪽만 고쳐지는 날이 온다(재사용·단일구현 정책).
//
// 그래서 이 파일이 하는 일은 셋뿐이다: ① 무엇을 찾을지 정하고 ② 어댑터를 부르고
// ③ 받은 것을 **후보로만** 넣는다. 확정은 사람이 한다(CLAUDE.md §5-3).

import { createAdminClient } from '@/lib/supabase/server'
import { loadWorkspaceSetting } from '../settings/load.ts'
import { logTokenUsage } from '@/lib/token-logger'
import { recordSystemEventAsync } from '@/lib/system-log/record'
import { kstTodayKey, kstWallToIso } from '@/lib/datetime/kst'
import { hostAdapter } from '../../crm/ai/adapters/host.ts'
import { resolveSettings, getResolved, type SettingRow } from '../settings/resolve.ts'
import {
  buildSignalPrompt, parseSignalCandidates, resolveSignalQueries,
  SIGNAL_CANDIDATE_MAX, type SignalCandidate, type TopicHint,
} from '../analysis/signals.ts'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** 얼마나 최근 것까지 볼지. 너무 넓으면 «지금»이 아니고, 너무 좁으면 매번 0건이다. */
export const SIGNAL_WINDOW_DAYS = 7

export interface SignalSweepResult {
  ok: boolean
  errorCode?: string
  errorMessage?: string
  /** 무슨 일이 있었는지 사람이 읽는 한 줄. 성공했는데 0건인 것과 실패를 구분한다 */
  note: string
  found: number
  inserted: number
}

/**
 * 호스트가 보관한 AI 설정을 그대로 읽는다.
 *
 * CI 가 키를 따로 받지 않는 이유는 CRM 과 같다 — 같은 키를 두 곳에서 받으면
 * 한쪽만 바꿨을 때 이쪽만 조용히 옛 키로 돈다.
 */
async function readHostMeta(): Promise<Record<string, unknown>> {
  const adminClient = createAdminClient() as any
  const { data } = await adminClient
    .from('org_content').select('value').eq('key', 'META').single()
  return (data?.value ?? {}) as Record<string, unknown>
}

const loadSetting = loadWorkspaceSetting

/**
 * 한 워크스페이스의 이슈 후보를 훑어 담는다.
 *
 * **절대 자동 확정하지 않는다.** 전부 status='candidate' 로 들어가고,
 * 사람이 「이슈 등록」을 눌러야 확정본이 된다. 자동으로 넣으면 근거 없는 줄이
 * 트렌드 화면의 사실처럼 읽히고, 그게 기획의 근거가 된다.
 */
export async function runSignalSweep(workspaceId: string): Promise<SignalSweepResult> {
  const adminClient = createAdminClient() as any

  const enabled = await loadSetting<boolean>(workspaceId, 'signals.enabled')
  if (enabled === false) {
    return { ok: true, note: '이슈 자동 수집이 꺼져 있습니다', found: 0, inserted: 0 }
  }

  const { data: topicRows } = await adminClient
    .from('ci_topics').select('id, name')
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null).is('merged_into_id', null)
    .order('name')
  const topics = ((topicRows ?? []) as TopicHint[])

  const configured = (await loadSetting<string>(workspaceId, 'signals.keywords')) ?? ''
  const queries = resolveSignalQueries(configured, topics)
  if (queries.length === 0) {
    // 찾을 거리가 없으면 억지로 찾지 않는다. 아무 뉴스나 담으면 아무도 안 보는 목록이 된다.
    return {
      ok: true, found: 0, inserted: 0,
      note: '무엇을 찾을지 정해지지 않았습니다 — 주제를 만들거나 설정에서 키워드를 적어 주세요',
    }
  }

  const prompt = buildSignalPrompt({
    queries, topics, todayKst: kstTodayKey(), windowDays: SIGNAL_WINDOW_DAYS,
  })

  let text = ''
  let tokensIn = 0
  let tokensOut = 0
  let model = 'unknown'
  try {
    // 웹 검색을 켠다. 끄면 모델은 학습 시점의 기억으로 답하고, 그 답에는 출처가 없다 —
    // 출처 없는 후보는 이 기능이 스스로 폐기한다(parseSignalCandidates).
    const adapter = await hostAdapter(readHostMeta, 'auto', { webSearch: true })
    model = adapter.model
    const res = await adapter.complete(prompt)
    text = res.text
    tokensIn = res.tokensIn
    tokensOut = res.tokensOut
  } catch (e) {
    // 조용히 0건으로 끝내지 않는다. 「수집이 되는 줄 알았는데 안 되는」 상태가
    // 가장 오래 안 들킨다(주간보고 저장이 2주 동안 그랬다).
    await recordSystemEventAsync({
      source: 'host_ai', feature: 'ci.signals', error: e,
      workspaceId, blocksUser: false, hint: model,
    })
    const msg = e instanceof Error ? e.message : '이슈를 찾아오지 못했습니다'
    return { ok: false, errorCode: 'AI_FAILED', errorMessage: msg, note: msg, found: 0, inserted: 0 }
  }

  logTokenUsage({
    userId: null, feature: 'ci-signals', model,
    provider: 'gemini', promptTokens: tokensIn,
    outputTokens: tokensOut, totalTokens: tokensIn + tokensOut,
  })

  const candidates = parseSignalCandidates(text, topics)
  if (candidates.length === 0) {
    return {
      ok: true, found: 0, inserted: 0,
      note: `검색어 ${queries.length}개를 훑었지만 담을 만한 것이 없었습니다`,
    }
  }

  const inserted = await insertCandidates(workspaceId, candidates)
  return {
    ok: true, found: candidates.length, inserted,
    note: `후보 ${candidates.length}건 중 ${inserted}건을 새로 담았습니다`
      + (candidates.length > inserted ? ' (나머지는 이미 있던 것)' : ''),
  }
}

/**
 * 후보를 담는다. **같은 주소는 한 번만** — DB 의 부분 유니크 인덱스가 최종 방어선이고,
 * 여기서는 그 충돌을 «실패»가 아니라 «이미 있음»으로 읽는다.
 * 한 건이 겹쳤다고 나머지를 버리면 새 후보가 통째로 사라진다.
 */
async function insertCandidates(
  workspaceId: string,
  candidates: SignalCandidate[],
): Promise<number> {
  const adminClient = createAdminClient() as any
  const nowIso = new Date().toISOString()
  let inserted = 0

  for (const c of candidates.slice(0, SIGNAL_CANDIDATE_MAX)) {
    const { error } = await adminClient.from('ci_signals').insert({
      workspace_id: workspaceId,
      kind: c.kind,
      title: c.title,
      url: c.url,
      source: c.source,
      topic_id: c.topicId,
      // 날짜를 모르면 지어내지 않는다 — 수집 시각만 남기고 사건 시각은 비운다
      occurred_at: c.occurredDate ? kstWallToIso(c.occurredDate, '00:00') : null,
      status: 'candidate',
      confidence: c.confidence,
      evidence: { reason: c.reason, url: c.url, source: c.source },
      collected_at: nowIso,
      dedupe_key: c.dedupeKey,
    })
    // 23505 = unique_violation. 같은 주소를 다시 만난 것이지 고장이 아니다.
    if (!error) inserted += 1
    else if (error.code !== '23505') {
      await recordSystemEventAsync({
        source: 'ci_job', feature: 'ci.signals', error,
        workspaceId, blocksUser: false, hint: c.dedupeKey,
      })
    }
  }
  return inserted
}
