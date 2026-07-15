'use server'

// 목록 심층분석 — §G 항목 상태 갱신 / 사용자 제어(pause·cancel) / 종합(synth) 영속 서버 액션.
// session-actions.ts를 3분할한 것 중 (b) 항목/제어/synth 부분(파일당 300줄 제약).
// 나머지: session-list-actions.ts(목록·CRUD) · session-persist-actions.ts(save/get/이어가기).
//
// getSessionExtras: 예전에는 client-session.ts가 브라우저 Supabase 클라이언트로 직접 조회했으나
// (CLAUDE.md "Don't gate admin access in the client alone" 위반) — requireAdminApi 서버액션으로
// 전환. RLS는 150_ai_chat.sql의 ai_conversations/ai_messages(admin+owner) 패턴과 동일 정합.

import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import type { AnalyzeItemErr } from './actions'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any

export type AnalysisItemStatus = 'pending' | 'running' | 'done' | 'error'

/** 항목 1건 분석 상태·결과 갱신(§G 유실0 — 분석 완료 즉시 저장, 화면 새로고침에도 보존). */
export async function updateAnalysisItem(input: {
  sessionId: string
  idx: number
  status: AnalysisItemStatus
  resultText?: string
}): Promise<{ ok: true } | AnalyzeItemErr> {
  const auth = await requireAdminApi()
  if (auth.error) return { ok: false, error: '권한이 없습니다' }
  const admin = createAdminClient() as AdminClient

  // owner 검증(세션이 본인 소유인지) — RLS도 동일 조건을 강제하지만 명시적 404 메시지를 위해 선확인
  const { data: owned } = await admin
    .from('ai_analysis_sessions')
    .select('id')
    .eq('id', input.sessionId)
    .eq('user_id', auth.user.id)
    .is('deleted_at', null)
    .single()
  if (!owned) return { ok: false, error: '세션을 찾을 수 없습니다' }

  const { error } = await admin
    .from('ai_analysis_items')
    .update({ status: input.status, result_text: input.resultText ?? null })
    .eq('session_id', input.sessionId)
    .eq('idx', input.idx)
  if (error) return { ok: false, error: '항목 갱신 중 오류가 발생했습니다' }

  return { ok: true }
}

export type AnalysisSessionControl = 'running' | 'paused' | 'cancelled'

/** 사용자 임의중단/재개(§ v2 오케스트레이터 배선) — owner 검증 후 control만 갱신. */
export async function setSessionControl(
  sessionId: string,
  control: AnalysisSessionControl,
): Promise<{ ok: true } | AnalyzeItemErr> {
  const auth = await requireAdminApi()
  if (auth.error) return { ok: false, error: '권한이 없습니다' }
  const admin = createAdminClient() as AdminClient

  const { data: owned } = await admin
    .from('ai_analysis_sessions')
    .select('id')
    .eq('id', sessionId)
    .eq('user_id', auth.user.id)
    .is('deleted_at', null)
    .single()
  if (!owned) return { ok: false, error: '세션을 찾을 수 없습니다' }

  const { error } = await admin.from('ai_analysis_sessions').update({ control }).eq('id', sessionId)
  if (error) return { ok: false, error: '세션 제어 갱신 중 오류가 발생했습니다' }

  return { ok: true }
}

export type AnalysisSynthStatus = 'pending' | 'running' | 'done' | 'error'

/** 종합(synth) 결과 영속(§ v2 유실0 — 브라우저 종료에도 종합 결과 보존). owner 검증 후 갱신. */
export async function updateSessionSynth(
  sessionId: string,
  input: {
    synthStatus: AnalysisSynthStatus
    synthText?: string
    coverage?: { total: number; covered: number[]; missing: number[]; appended: number[] }
  },
): Promise<{ ok: true } | AnalyzeItemErr> {
  const auth = await requireAdminApi()
  if (auth.error) return { ok: false, error: '권한이 없습니다' }
  const admin = createAdminClient() as AdminClient

  const { data: owned } = await admin
    .from('ai_analysis_sessions')
    .select('id')
    .eq('id', sessionId)
    .eq('user_id', auth.user.id)
    .is('deleted_at', null)
    .single()
  if (!owned) return { ok: false, error: '세션을 찾을 수 없습니다' }

  const { error } = await admin
    .from('ai_analysis_sessions')
    .update({
      synth_status: input.synthStatus,
      synth_text: input.synthText ?? null,
      coverage: input.coverage ?? null,
    })
    .eq('id', sessionId)
  if (error) return { ok: false, error: '종합 결과 저장 중 오류가 발생했습니다' }

  return { ok: true }
}

export interface SessionCoverage {
  total: number
  covered: number[]
  missing: number[]
  appended: number[]
}

export interface SessionExtras {
  phase: string
  control: AnalysisSessionControl
  synthStatus: AnalysisSynthStatus
  synthText: string | null
  coverage: SessionCoverage | null
  command: string
}

interface ExtrasRow {
  phase: string | null
  control: AnalysisSessionControl | null
  synth_status: AnalysisSynthStatus | null
  synth_text: string | null
  coverage: SessionCoverage | null
  command: string | null
}

/** 세션 확장필드(phase/control/synth_status/synth_text/coverage/command) 조회 — owner 검증 서버액션. */
export async function getSessionExtras(sessionId: string): Promise<SessionExtras | null> {
  const auth = await requireAdminApi()
  if (auth.error) return null
  const admin = createAdminClient() as AdminClient

  const { data, error } = await admin
    .from('ai_analysis_sessions')
    .select('phase, control, synth_status, synth_text, coverage, command')
    .eq('id', sessionId)
    .eq('user_id', auth.user.id)
    .is('deleted_at', null)
    .single()

  if (error || !data) return null
  const row = data as ExtrasRow
  return {
    phase: row.phase ?? 'idle',
    control: row.control ?? 'running',
    synthStatus: row.synth_status ?? 'pending',
    synthText: row.synth_text ?? null,
    coverage: row.coverage ?? null,
    command: row.command ?? '',
  }
}
