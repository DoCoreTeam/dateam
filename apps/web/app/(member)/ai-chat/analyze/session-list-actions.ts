'use server'

// 목록 심층분석 — §C4 세션 목록/CRUD(list/rename/delete/restore) 서버 액션.
// session-actions.ts를 3분할한 것 중 (a) 목록·CRUD 부분(파일당 300줄 제약).
// 나머지: session-item-actions.ts(항목/제어/synth) · session-persist-actions.ts(save/get/이어가기).
// RLS는 150_ai_chat.sql의 ai_conversations/ai_messages(admin+owner) 패턴 재사용(157 마이그레이션 동일 정합).

import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import type { AnalysisLens, AnalyzeItemErr } from './actions'
import type { AnalysisItemStatus, AnalysisSynthStatus } from './session-item-actions'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any

const MAX_TITLE_CHARS = 60

export interface AnalysisSessionSummary {
  id: string
  title: string
  lens: AnalysisLens
  phase: string
  synthStatus: AnalysisSynthStatus
  itemCount: number
  doneCount: number
  createdAt: string
  updatedAt: string
}

interface SessionRow {
  id: string
  title: string
  lens: AnalysisLens
  phase: string
  synth_status: AnalysisSynthStatus
  created_at: string
  updated_at: string
  ai_analysis_items: { status: AnalysisItemStatus }[] | null
}

export type SessionSortKey = 'updated' | 'created'
const SORT_COLUMN: Record<SessionSortKey, 'updated_at' | 'created_at'> = {
  updated: 'updated_at',
  created: 'created_at',
}

const ALLOWED_PHASES = ['idle', 'analyzing', 'synthesizing', 'done'] as const
const ALLOWED_SYNTH_STATUSES = ['pending', 'running', 'done', 'error'] as const

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100

/** 검색어 sanitize — PostgREST `.or()` 필터 문법을 깨는 문자(콤마·괄호)만 제거, ilike 와일드카드는 그대로 허용. */
function sanitizeSearchTerm(raw: string): string {
  return raw.trim().replace(/[,()]/g, '').slice(0, 200)
}

export interface ListAnalysisSessionsParams {
  /** 제목/원문 검색(서버 sanitize, ilike) */
  q?: string
  /** 정렬 기준 — 화이트리스트. 기본 updated */
  sort?: SessionSortKey
  /** 필터 — 화이트리스트만 허용, 그 외 값은 무시. deleted=true면 휴지통(소프트삭제된 세션)만 조회 */
  filter?: { phase?: string; synthStatus?: string; deleted?: boolean }
  /** 커서(정렬 컬럼 값) — 다음 페이지 조회용 */
  cursor?: string
  /** 페이지 크기(기본 30, 최대 100) */
  limit?: number
}

export interface ListAnalysisSessionsOk {
  ok: true
  sessions: AnalysisSessionSummary[]
  nextCursor: string | null
}

/** 세션 목록(§G "이전 분석"·§C4 세션 목록 화면 공용) — 검색·정렬·필터·커서 페이지네이션. 인자 없으면 기존 동작(최근 30개) 유지. */
export async function listAnalysisSessions(
  params?: ListAnalysisSessionsParams,
): Promise<ListAnalysisSessionsOk | AnalyzeItemErr> {
  const auth = await requireAdminApi()
  if (auth.error) return { ok: false, error: '권한이 없습니다' }
  const admin = createAdminClient() as AdminClient

  const sortKey: SessionSortKey = params?.sort === 'created' ? 'created' : 'updated'
  const sortColumn = SORT_COLUMN[sortKey]
  const limit = Math.min(Math.max(params?.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)

  const wantDeleted = params?.filter?.deleted === true

  let query = admin
    .from('ai_analysis_sessions')
    .select('id, title, lens, phase, synth_status, created_at, updated_at, ai_analysis_items(status)')
    .eq('user_id', auth.user.id)
  query = wantDeleted ? query.not('deleted_at', 'is', null) : query.is('deleted_at', null)

  const q = params?.q ? sanitizeSearchTerm(params.q) : ''
  if (q) query = query.or(`title.ilike.%${q}%,source_text.ilike.%${q}%`)

  const phase = params?.filter?.phase
  if (phase && (ALLOWED_PHASES as readonly string[]).includes(phase)) query = query.eq('phase', phase)

  const synthStatus = params?.filter?.synthStatus
  if (synthStatus && (ALLOWED_SYNTH_STATUSES as readonly string[]).includes(synthStatus)) {
    query = query.eq('synth_status', synthStatus)
  }

  if (params?.cursor) query = query.lt(sortColumn, params.cursor)

  const { data, error } = await query.order(sortColumn, { ascending: false }).limit(limit)
  if (error) return { ok: false, error: '이전 분석 목록 조회 중 오류가 발생했습니다' }

  const rows = (data ?? []) as SessionRow[]
  const sessions: AnalysisSessionSummary[] = rows.map((r) => {
    const items = r.ai_analysis_items ?? []
    return {
      id: r.id,
      title: r.title,
      lens: r.lens,
      phase: r.phase,
      synthStatus: r.synth_status,
      itemCount: items.length,
      doneCount: items.filter((i) => i.status === 'done').length,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }
  })

  const nextCursor = rows.length === limit ? rows[rows.length - 1][sortColumn] : null
  return { ok: true, sessions, nextCursor }
}

/** 세션 제목 변경(§C4 CRUD) — owner 검증 후 update. */
export async function renameAnalysisSession(
  sessionId: string,
  title: string,
): Promise<{ ok: true } | AnalyzeItemErr> {
  const auth = await requireAdminApi()
  if (auth.error) return { ok: false, error: '권한이 없습니다' }
  const admin = createAdminClient() as AdminClient

  const trimmed = title.trim().slice(0, MAX_TITLE_CHARS)
  if (!trimmed) return { ok: false, error: '제목을 입력하세요' }

  const { data: owned } = await admin
    .from('ai_analysis_sessions')
    .select('id')
    .eq('id', sessionId)
    .eq('user_id', auth.user.id)
    .is('deleted_at', null)
    .single()
  if (!owned) return { ok: false, error: '세션을 찾을 수 없습니다' }

  const { error } = await admin.from('ai_analysis_sessions').update({ title: trimmed }).eq('id', sessionId)
  if (error) return { ok: false, error: '제목 변경 중 오류가 발생했습니다' }

  return { ok: true }
}

/** 세션 소프트삭제(§C4 CRUD) — owner 검증 후 deleted_at=now(). 되돌리기 가능(restoreAnalysisSession). */
export async function deleteAnalysisSession(sessionId: string): Promise<{ ok: true } | AnalyzeItemErr> {
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
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', sessionId)
  if (error) return { ok: false, error: '삭제 중 오류가 발생했습니다' }

  return { ok: true }
}

/** 소프트삭제된 세션 되돌리기(§C4 CRUD) — owner 검증 후 deleted_at=null. */
export async function restoreAnalysisSession(sessionId: string): Promise<{ ok: true } | AnalyzeItemErr> {
  const auth = await requireAdminApi()
  if (auth.error) return { ok: false, error: '권한이 없습니다' }
  const admin = createAdminClient() as AdminClient

  const { data: owned } = await admin
    .from('ai_analysis_sessions')
    .select('id')
    .eq('id', sessionId)
    .eq('user_id', auth.user.id)
    .not('deleted_at', 'is', null)
    .single()
  if (!owned) return { ok: false, error: '삭제된 세션을 찾을 수 없습니다' }

  const { error } = await admin.from('ai_analysis_sessions').update({ deleted_at: null }).eq('id', sessionId)
  if (error) return { ok: false, error: '되돌리기 중 오류가 발생했습니다' }

  return { ok: true }
}
