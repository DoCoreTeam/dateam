'use server'

// 목록 심층분석 — §G 분석 착수 전 영속 저장(세션+항목) / 세션 상세 조회 / §F AI채팅 연계.
// session-actions.ts를 3분할한 것 중 (c) save/get 부분(파일당 300줄 제약).
// 나머지: session-list-actions.ts(목록·CRUD) · session-item-actions.ts(항목/제어/synth).
// RLS는 150_ai_chat.sql의 ai_conversations/ai_messages(admin+owner) 패턴 재사용(157 마이그레이션 동일 정합).

import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import type { AnalysisLens, AnalyzeItemErr } from './actions'
import type { AnalysisItemStatus } from './session-item-actions'
import { logDbError } from '@/lib/ai-chat/log-db-error'

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
  if (sessionErr || !session) {
    logDbError('saveAnalysisSession:sessions.insert', sessionErr)
    return { ok: false, error: '세션 저장 중 오류가 발생했습니다' }
  }
  const sessionId = (session as { id: string }).id

  const itemRows = input.items.map((it, idx) => ({
    session_id: sessionId,
    idx,
    item_text: it.text,
  }))
  const { error: itemsErr } = await admin.from('ai_analysis_items').insert(itemRows)
  if (itemsErr) {
    logDbError('saveAnalysisSession:items.insert', itemsErr, { sessionId })
    return { ok: false, error: '항목 저장 중 오류가 발생했습니다' }
  }

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
    .select('id, source_text, lens, source_kind, grouping_revision')
    .eq('id', sessionId)
    .eq('user_id', auth.user.id)
    .is('deleted_at', null)
    .single()
  if (!sessionRow) return { ok: false, error: '세션을 찾을 수 없습니다' }

  const sess = sessionRow as {
    id: string
    source_text: string
    lens: AnalysisLens
    source_kind: string
    grouping_revision: number | null
  }

  // 현재 리비전 그룹만 로드 — 재그룹핑 시 이전 리비전 행이 보존되므로 필터하지 않으면
  // 구·신 그룹이 한 목록에 섞여 보인다(실측 사고: 리비전1 3건 + 리비전2 5건 = 8건 노출).
  const { data: itemRows } = await admin
    .from('ai_analysis_items')
    .select('idx, item_text, title, status, result_text')
    .eq('session_id', sessionId)
    .eq('revision', sess.grouping_revision ?? 1)
    .order('idx', { ascending: true })

  const s = sess
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
