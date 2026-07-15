'use server'

// 목록 심층분석 — §G 분석 착수 전 영속 저장(세션+항목) / 세션 상세 조회 / §F AI채팅 연계.
// session-actions.ts를 3분할한 것 중 (c) save/get/continueInChat 부분(파일당 300줄 제약).
// 나머지: session-list-actions.ts(목록·CRUD) · session-item-actions.ts(항목/제어/synth).
// RLS는 150_ai_chat.sql의 ai_conversations/ai_messages(admin+owner) 패턴 재사용(157 마이그레이션 동일 정합).

import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { getDefaultProvider } from '@/lib/ai-chat/registry'
import type { AnalysisLens, AnalyzeItemErr } from './actions'
import type { AnalysisItemStatus } from './session-item-actions'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any

const MAX_TITLE_CHARS = 60

async function readMeta(admin: AdminClient): Promise<Record<string, unknown>> {
  const { data } = await admin.from('org_content').select('value').eq('key', 'META').single()
  return (data?.value as Record<string, unknown>) ?? {}
}

/** 검수 완료 후 분석 착수 직전 세션+항목 일괄 저장(§G 유실0 — 분석 시작 전에 원문·항목을 먼저 영속화). */
export async function saveAnalysisSession(input: {
  sourceText: string
  lens: AnalysisLens
  sourceKind: string
  items: { text: string }[]
  command?: string
}): Promise<{ ok: true; sessionId: string } | AnalyzeItemErr> {
  const auth = await requireAdminApi()
  if (auth.error) return { ok: false, error: '권한이 없습니다' }
  const admin = createAdminClient() as AdminClient

  if (input.items.length === 0) return { ok: false, error: '저장할 항목이 없습니다' }

  const title = (input.items[0]?.text ?? '목록 심층분석').trim().slice(0, MAX_TITLE_CHARS) || '목록 심층분석'

  const { data: session, error: sessionErr } = await admin
    .from('ai_analysis_sessions')
    .insert({
      user_id: auth.user.id,
      title,
      source_text: input.sourceText,
      lens: input.lens,
      source_kind: input.sourceKind,
      command: input.command?.trim() ?? '',
    })
    .select('id')
    .single()
  if (sessionErr || !session) return { ok: false, error: '세션 저장 중 오류가 발생했습니다' }
  const sessionId = (session as { id: string }).id

  const itemRows = input.items.map((it, idx) => ({
    session_id: sessionId,
    idx,
    item_text: it.text,
  }))
  const { error: itemsErr } = await admin.from('ai_analysis_items').insert(itemRows)
  if (itemsErr) return { ok: false, error: '항목 저장 중 오류가 발생했습니다' }

  return { ok: true, sessionId }
}

export interface AnalysisSessionDetail {
  id: string
  sourceText: string
  lens: AnalysisLens
  sourceKind: string
  items: { idx: number; text: string; status: AnalysisItemStatus; resultText: string | null }[]
}

/** 세션 1건 상세 조회(§G "이어하기") — 항목은 idx asc(추출 당시 순서 보존). */
export async function getAnalysisSession(
  sessionId: string,
): Promise<{ ok: true; session: AnalysisSessionDetail } | AnalyzeItemErr> {
  const auth = await requireAdminApi()
  if (auth.error) return { ok: false, error: '권한이 없습니다' }
  const admin = createAdminClient() as AdminClient

  const { data: sessionRow } = await admin
    .from('ai_analysis_sessions')
    .select('id, source_text, lens, source_kind')
    .eq('id', sessionId)
    .eq('user_id', auth.user.id)
    .is('deleted_at', null)
    .single()
  if (!sessionRow) return { ok: false, error: '세션을 찾을 수 없습니다' }

  const { data: itemRows } = await admin
    .from('ai_analysis_items')
    .select('idx, item_text, status, result_text')
    .eq('session_id', sessionId)
    .order('idx', { ascending: true })

  const s = sessionRow as { id: string; source_text: string; lens: AnalysisLens; source_kind: string }
  const items = (itemRows ?? []) as {
    idx: number
    item_text: string
    status: AnalysisItemStatus
    result_text: string | null
  }[]

  return {
    ok: true,
    session: {
      id: s.id,
      sourceText: s.source_text,
      lens: s.lens,
      sourceKind: s.source_kind,
      items: items.map((it) => ({
        idx: it.idx,
        text: it.item_text,
        status: it.status,
        resultText: it.result_text,
      })),
    },
  }
}

/** 분석 결과를 새 AI채팅 대화의 첫 사용자 메시지로 이어감(admin/ai-chat/actions.ts createConversation과 동일 스키마 재사용). */
export async function continueInChat(input: {
  itemText: string
  resultText: string
}): Promise<{ ok: true; conversationId: string } | AnalyzeItemErr> {
  const auth = await requireAdminApi()
  if (auth.error) return { ok: false, error: '권한이 없습니다' }
  const admin = createAdminClient() as AdminClient

  const itemText = input.itemText.trim()
  const resultText = input.resultText.trim()
  if (!itemText || !resultText) return { ok: false, error: '이어갈 분석 결과가 없습니다' }

  const meta = await readMeta(admin)
  const def = getDefaultProvider(meta)
  if (!def) return { ok: false, error: 'AI 프로바이더가 설정되지 않았습니다' }

  const title = itemText.slice(0, MAX_TITLE_CHARS) || '목록 심층분석 이어가기'

  const { data: conv, error: convErr } = await admin
    .from('ai_conversations')
    .insert({ user_id: auth.user.id, provider: def.id, model: def.model, title })
    .select('id')
    .single()
  if (convErr || !conv) return { ok: false, error: '대화 생성 중 오류가 발생했습니다' }
  const conversationId = (conv as { id: string }).id

  const content = `${itemText}\n\n---\n[이전 분석 결과]\n${resultText}\n\n---\n이 내용을 이어서 논의하고 싶습니다.`

  const { error: msgErr } = await admin
    .from('ai_messages')
    .insert({ conversation_id: conversationId, role: 'user', content })
  if (msgErr) return { ok: false, error: '메시지 저장 중 오류가 발생했습니다' }

  return { ok: true, conversationId }
}
