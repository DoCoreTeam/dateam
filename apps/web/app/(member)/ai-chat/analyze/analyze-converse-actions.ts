'use server'

// 목록 심층분석 — 완전 대화형(④). 항목(의미블록)별 다회차 지시↔AI 대화 + 항목 확정 스냅샷 + 세션 종합.
// AI 호출은 analyze-item-actions.analyzeItem(analyze-core)을 재사용한다(설정·토큰로깅·상한 일원화).
// 항목 최종 확정본은 ai_analysis_items.result_text에 스냅샷 → 기존 종합·export가 그대로 읽음(무변경 호환).

import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { logDbError } from '@/lib/ai-chat/log-db-error'
import { analyzeItem, synthesizeInsights } from './analyze-item-actions'
import { updateSessionSynth } from './session-item-actions'
import type { AnalyzeItemErr } from './actions'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any

export interface ItemMessage {
  seq: number
  role: 'user' | 'assistant'
  content: string
}

const MAX_USER_TEXT = 4000

/** 세션 소유권 + 현재 grouping_revision + 선택 모델 확인. */
async function ownSession(
  admin: AdminClient,
  sessionId: string,
  userId: string,
): Promise<{ revision: number; model: string | null } | null> {
  const { data } = await admin
    .from('ai_analysis_sessions')
    .select('id, grouping_revision, model')
    .eq('id', sessionId)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .single()
  if (!data) return null
  const row = data as { grouping_revision: number | null; model: string | null }
  return { revision: row.grouping_revision ?? 1, model: row.model }
}

/** 항목 1건의 대화 이력 로드(재열람 = 로드, AI 재호출 없음). */
export async function getItemMessages(
  sessionId: string,
  itemIdx: number,
): Promise<{ ok: true; messages: ItemMessage[] } | AnalyzeItemErr> {
  const auth = await requireAdminApi()
  if (auth.error) return { ok: false, error: '권한이 없습니다' }
  const admin = createAdminClient() as AdminClient

  const own = await ownSession(admin, sessionId, auth.user.id)
  if (!own) return { ok: false, error: '세션을 찾을 수 없습니다' }
  const revision = own.revision

  const { data } = await admin
    .from('ai_analysis_item_messages')
    .select('seq, role, content')
    .eq('session_id', sessionId)
    .eq('item_idx', itemIdx)
    .eq('revision', revision)
    .order('seq', { ascending: true })

  return { ok: true, messages: (data ?? []) as ItemMessage[] }
}

/** 항목에 지시를 보내고 AI 응답을 받는다(다회차). 응답은 result_text에 스냅샷 + status='done'. */
export async function sendItemMessage(
  sessionId: string,
  itemIdx: number,
  userText: string,
): Promise<{ ok: true; assistant: string } | AnalyzeItemErr> {
  const auth = await requireAdminApi()
  if (auth.error) return { ok: false, error: '권한이 없습니다' }
  const admin = createAdminClient() as AdminClient

  const text = (userText ?? '').trim()
  if (!text) return { ok: false, error: '지시 내용을 입력하세요' }
  if (text.length > MAX_USER_TEXT) return { ok: false, error: '지시가 너무 깁니다' }

  const own = await ownSession(admin, sessionId, auth.user.id)
  if (!own) return { ok: false, error: '세션을 찾을 수 없습니다' }
  const revision = own.revision

  const { data: itemRow } = await admin
    .from('ai_analysis_items')
    .select('body_raw, title')
    .eq('session_id', sessionId)
    .eq('idx', itemIdx)
    .eq('revision', revision)
    .single()
  if (!itemRow) return { ok: false, error: '항목을 찾을 수 없습니다' }
  const item = itemRow as { body_raw: string; title: string }
  const itemText = (item.body_raw || item.title || '').trim()
  if (!itemText) return { ok: false, error: '항목 원문이 비어 있습니다' }

  // 이전 대화 로드 → 다음 seq 계산 + 히스토리 컨텍스트.
  const { data: prior } = await admin
    .from('ai_analysis_item_messages')
    .select('seq, role, content')
    .eq('session_id', sessionId)
    .eq('item_idx', itemIdx)
    .eq('revision', revision)
    .order('seq', { ascending: true })
  const history = (prior ?? []) as ItemMessage[]
  const nextSeq = history.length > 0 ? Math.max(...history.map((m) => m.seq)) + 1 : 1

  // 사용자 메시지 먼저 영속(유실0 — AI 실패해도 지시는 남는다).
  const { error: userErr } = await admin.from('ai_analysis_item_messages').insert({
    session_id: sessionId, item_idx: itemIdx, revision, role: 'user', content: text, seq: nextSeq,
  })
  if (userErr) {
    logDbError('sendItemMessage:item_messages.insert', userErr, { sessionId, itemIdx, seq: nextSeq })
    return { ok: false, error: '지시 저장 중 오류가 발생했습니다' }
  }

  // 히스토리 + 새 지시를 하나의 command로 구성해 analyzeItem에 위임.
  const histText = history.map((m) => `[${m.role === 'user' ? '지시' : 'AI'}] ${m.content}`).join('\n\n')
  const customInstruction = histText
    ? `이 항목에 대한 이전 대화:\n${histText}\n\n새 지시: ${text}\n\n위 지시에 따라 이 항목을 분석/작업하고 마크다운으로 답하라(표가 있으면 마크다운 표로 유지).`
    : `${text}\n\n위 지시에 따라 이 항목을 분석/작업하고 마크다운으로 답하라(표가 있으면 마크다운 표로 유지).`

  const ai = await analyzeItem({ itemText, contextText: '', lens: 'summary', customInstruction, model: own.model ?? undefined })
  if (!ai.ok) return { ok: false, error: ai.error }

  // AI 응답 영속 + 항목 확정본 스냅샷(종합·export 대상).
  await admin.from('ai_analysis_item_messages').insert({
    session_id: sessionId, item_idx: itemIdx, revision, role: 'assistant', content: ai.text, seq: nextSeq + 1,
  })
  await admin
    .from('ai_analysis_items')
    .update({ result_text: ai.text, status: 'done' })
    .eq('session_id', sessionId)
    .eq('idx', itemIdx)
    .eq('revision', revision)

  return { ok: true, assistant: ai.text }
}

/** 확정 항목들을 모아 단일 종합 문서 생성 + 세션에 영속. formatInstruction으로 취합 형식(템플릿/샘플)을 지시할 수 있다. */
export async function synthesizeSession(
  sessionId: string,
  formatInstruction?: string,
): Promise<{ ok: true; synthText: string } | AnalyzeItemErr> {
  const auth = await requireAdminApi()
  if (auth.error) return { ok: false, error: '권한이 없습니다' }
  const admin = createAdminClient() as AdminClient

  const own = await ownSession(admin, sessionId, auth.user.id)
  if (!own) return { ok: false, error: '세션을 찾을 수 없습니다' }
  const revision = own.revision

  const { data: rows } = await admin
    .from('ai_analysis_items')
    .select('title, body_raw, result_text, status')
    .eq('session_id', sessionId)
    .eq('revision', revision)
    .eq('status', 'done')
    .order('idx', { ascending: true })
  const done = (rows ?? []) as { title: string; body_raw: string; result_text: string | null }[]
  const entries = done
    .filter((r) => (r.result_text ?? '').trim())
    .map((r) => ({ itemText: r.title || r.body_raw, resultText: r.result_text as string }))
  if (entries.length === 0) return { ok: false, error: '종합할 확정 항목이 없습니다 — 먼저 항목에 지시해 답을 받으세요' }

  await updateSessionSynth(sessionId, { synthStatus: 'running' })
  const synth = await synthesizeInsights(entries, own.model ?? undefined, formatInstruction)
  if (!synth.ok) {
    await updateSessionSynth(sessionId, { synthStatus: 'error' })
    return { ok: false, error: synth.error }
  }
  await updateSessionSynth(sessionId, { synthStatus: 'done', synthText: synth.text, coverage: synth.coverage })
  return { ok: true, synthText: synth.text }
}
