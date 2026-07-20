'use server'

// 목록 심층분석 — 완성 문서 1급 객체(§FR-11-2) CRUD 서버 액션. 테이블 ai_analysis_documents(마이그 171).
// RLS는 157/171과 동일 owner-only 패턴, 이 게이트도 requireAdminApi(admin+owner 동시 조건)로 애플리케이션단 강제.
// 세션 CRUD(session-list-actions.ts)와 동일 컨벤션: 검색(q, sanitize)·정렬(화이트리스트)·필터(화이트리스트)·
// 커서 페이지네이션. 소프트삭제는 deleted_at.

import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { logDbError } from '@/lib/ai-chat/log-db-error'
import { DOC_TYPES } from '@/lib/ai-chat/grouping/classify-doc'
import type { AnalyzeItemErr } from './actions'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any

const MAX_TITLE_CHARS = 120
const MAX_BODY_CHARS = 400_000
const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100

export interface AnalysisDocumentSummary {
  id: string
  sessionId: string | null
  revision: number
  title: string
  docType: string | null
  createdAt: string
  updatedAt: string
}

export interface AnalysisDocumentDetail extends AnalysisDocumentSummary {
  bodyMd: string
}

interface DocumentRow {
  id: string
  session_id: string | null
  revision: number
  title: string
  body_md: string
  doc_type: string | null
  created_at: string
  updated_at: string
}

function toSummary(r: DocumentRow): AnalysisDocumentSummary {
  return {
    id: r.id,
    sessionId: r.session_id,
    revision: r.revision,
    title: r.title,
    docType: r.doc_type,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

/** 검색어 sanitize — PostgREST `.or()` 필터 문법을 깨는 문자(콤마·괄호)만 제거. */
function sanitizeSearchTerm(raw: string): string {
  return raw.trim().replace(/[,()]/g, '').slice(0, 200)
}

export type DocumentSortKey = 'updated' | 'created'
const SORT_COLUMN: Record<DocumentSortKey, 'updated_at' | 'created_at'> = {
  updated: 'updated_at',
  created: 'created_at',
}

export interface CreateDocumentInput {
  /** 파생 출처 세션(§FR-11-2 재열람·재가공 링크). 없으면 null(세션 무관 저장). */
  sessionId: string | null
  title: string
  bodyMd: string
  docType?: string | null
  /** 생략 시 같은 세션의 기존 문서 최대 revision+1을 자동 계산(§01-architecture "문서 히스토리"). */
  revision?: number
}

/** 완성 문서 저장(§FR-11-2 배출 경로 2·§FR-10 조립 결과 1급 객체화). */
export async function createDocument(
  input: CreateDocumentInput,
): Promise<{ ok: true; id: string } | AnalyzeItemErr> {
  const auth = await requireAdminApi()
  if (auth.error) return { ok: false, error: '권한이 없습니다' }
  const admin = createAdminClient() as AdminClient

  const bodyMd = input.bodyMd.trim()
  if (!bodyMd) return { ok: false, error: '저장할 내용이 없습니다' }
  if (bodyMd.length > MAX_BODY_CHARS) return { ok: false, error: '문서가 너무 큽니다' }

  // 제목·유형·리비전은 **세션에서 서버가 직접 읽는다**(권위 있는 값).
  // 클라이언트가 넘긴 props를 그대로 믿으면 (a) 실측 사고처럼 첫 그룹 제목("1. 개요")이
  // 문서 제목이 되고 doc_type이 비며 (b) revision이 그룹핑 리비전과 어긋나 추적이 깨진다.
  // revision은 "이 문서가 어느 그룹핑 리비전에서 나왔는가"를 뜻한다(추적용, 문서 판번호 아님).
  let sessionTitle = ''
  let sessionDocType: string | null = null
  let revision = 1
  if (input.sessionId) {
    const { data: sess } = await admin
      .from('ai_analysis_sessions')
      .select('title, doc_type, grouping_revision')
      .eq('id', input.sessionId)
      .eq('user_id', auth.user.id)
      .is('deleted_at', null)
      .maybeSingle()
    const s = sess as { title: string | null; doc_type: string | null; grouping_revision: number | null } | null
    if (!s) return { ok: false, error: '세션을 찾을 수 없습니다' }
    sessionTitle = (s.title ?? '').trim()
    sessionDocType = s.doc_type
    revision = s.grouping_revision ?? 1
  }

  const title =
    (sessionTitle || input.title.trim()).slice(0, MAX_TITLE_CHARS) || '제목 없음'

  const { data, error } = await admin
    .from('ai_analysis_documents')
    .insert({
      user_id: auth.user.id,
      session_id: input.sessionId,
      revision,
      title,
      body_md: bodyMd,
      doc_type: sessionDocType ?? input.docType ?? null,
    })
    .select('id')
    .single()
  if (error || !data) {
    logDbError('createDocument:insert', error, { sessionId: input.sessionId })
    return { ok: false, error: '문서 저장 중 오류가 발생했습니다' }
  }

  return { ok: true, id: (data as { id: string }).id }
}

export interface ListDocumentsParams {
  q?: string
  sort?: DocumentSortKey
  filter?: { docType?: string; deleted?: boolean }
  cursor?: string
  limit?: number
}

export interface ListDocumentsOk {
  ok: true
  documents: AnalysisDocumentSummary[]
  nextCursor: string | null
}

/** 문서 라이브러리 목록(§FR-11-2) — 검색·정렬·필터·커서 페이지네이션, owner 필터 default-deny. */
export async function listDocuments(
  params?: ListDocumentsParams,
): Promise<ListDocumentsOk | AnalyzeItemErr> {
  const auth = await requireAdminApi()
  if (auth.error) return { ok: false, error: '권한이 없습니다' }
  const admin = createAdminClient() as AdminClient

  const sortKey: DocumentSortKey = params?.sort === 'created' ? 'created' : 'updated'
  const sortColumn = SORT_COLUMN[sortKey]
  const limit = Math.min(Math.max(params?.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
  const wantDeleted = params?.filter?.deleted === true

  let query = admin
    .from('ai_analysis_documents')
    .select('id, session_id, revision, title, body_md, doc_type, created_at, updated_at')
    .eq('user_id', auth.user.id)
  query = wantDeleted ? query.not('deleted_at', 'is', null) : query.is('deleted_at', null)

  const q = params?.q ? sanitizeSearchTerm(params.q) : ''
  if (q) query = query.or(`title.ilike.%${q}%,body_md.ilike.%${q}%`)

  const docType = params?.filter?.docType
  if (docType && (DOC_TYPES as readonly string[]).includes(docType)) query = query.eq('doc_type', docType)

  if (params?.cursor) query = query.lt(sortColumn, params.cursor)

  const { data, error } = await query.order(sortColumn, { ascending: false }).limit(limit)
  if (error) {
    logDbError('listDocuments:select', error)
    return { ok: false, error: '문서 목록 조회 중 오류가 발생했습니다' }
  }

  const rows = (data ?? []) as DocumentRow[]
  const documents = rows.map(toSummary)
  const nextCursor = rows.length === limit ? rows[rows.length - 1][sortColumn] : null
  return { ok: true, documents, nextCursor }
}

/** 문서 1건 상세(본문 포함) 조회 — owner 검증. */
export async function getDocument(
  id: string,
): Promise<{ ok: true; document: AnalysisDocumentDetail } | AnalyzeItemErr> {
  const auth = await requireAdminApi()
  if (auth.error) return { ok: false, error: '권한이 없습니다' }
  const admin = createAdminClient() as AdminClient

  const { data } = await admin
    .from('ai_analysis_documents')
    .select('id, session_id, revision, title, body_md, doc_type, created_at, updated_at')
    .eq('id', id)
    .eq('user_id', auth.user.id)
    .is('deleted_at', null)
    .single()
  if (!data) return { ok: false, error: '문서를 찾을 수 없습니다' }

  const row = data as DocumentRow
  return { ok: true, document: { ...toSummary(row), bodyMd: row.body_md } }
}

/** 제목·본문 수정(§FR-11-2 재가공) — owner 검증 후 update. */
export async function updateDocument(
  id: string,
  input: { title?: string; bodyMd?: string },
): Promise<{ ok: true } | AnalyzeItemErr> {
  const auth = await requireAdminApi()
  if (auth.error) return { ok: false, error: '권한이 없습니다' }
  const admin = createAdminClient() as AdminClient

  const patch: Record<string, string> = {}
  if (input.title !== undefined) {
    const t = input.title.trim().slice(0, MAX_TITLE_CHARS)
    if (!t) return { ok: false, error: '제목을 입력하세요' }
    patch.title = t
  }
  if (input.bodyMd !== undefined) {
    const b = input.bodyMd.trim()
    if (!b) return { ok: false, error: '본문을 입력하세요' }
    if (b.length > MAX_BODY_CHARS) return { ok: false, error: '문서가 너무 큽니다' }
    patch.body_md = b
  }
  if (Object.keys(patch).length === 0) return { ok: true }

  const { data: owned } = await admin
    .from('ai_analysis_documents')
    .select('id')
    .eq('id', id)
    .eq('user_id', auth.user.id)
    .is('deleted_at', null)
    .single()
  if (!owned) return { ok: false, error: '문서를 찾을 수 없습니다' }

  const { error } = await admin.from('ai_analysis_documents').update(patch).eq('id', id)
  if (error) {
    logDbError('updateDocument:update', error, { id })
    return { ok: false, error: '문서 수정 중 오류가 발생했습니다' }
  }
  return { ok: true }
}

/** 소프트삭제 — owner 검증 후 deleted_at=now(). */
export async function deleteDocument(id: string): Promise<{ ok: true } | AnalyzeItemErr> {
  const auth = await requireAdminApi()
  if (auth.error) return { ok: false, error: '권한이 없습니다' }
  const admin = createAdminClient() as AdminClient

  const { data: owned } = await admin
    .from('ai_analysis_documents')
    .select('id')
    .eq('id', id)
    .eq('user_id', auth.user.id)
    .is('deleted_at', null)
    .single()
  if (!owned) return { ok: false, error: '문서를 찾을 수 없습니다' }

  const { error } = await admin
    .from('ai_analysis_documents')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
  if (error) {
    logDbError('deleteDocument:update', error, { id })
    return { ok: false, error: '삭제 중 오류가 발생했습니다' }
  }
  return { ok: true }
}

/** 소프트삭제 되돌리기 — owner 검증 후 deleted_at=null. */
export async function restoreDocument(id: string): Promise<{ ok: true } | AnalyzeItemErr> {
  const auth = await requireAdminApi()
  if (auth.error) return { ok: false, error: '권한이 없습니다' }
  const admin = createAdminClient() as AdminClient

  const { data: owned } = await admin
    .from('ai_analysis_documents')
    .select('id')
    .eq('id', id)
    .eq('user_id', auth.user.id)
    .not('deleted_at', 'is', null)
    .single()
  if (!owned) return { ok: false, error: '삭제된 문서를 찾을 수 없습니다' }

  const { error } = await admin.from('ai_analysis_documents').update({ deleted_at: null }).eq('id', id)
  if (error) {
    logDbError('restoreDocument:update', error, { id })
    return { ok: false, error: '되돌리기 중 오류가 발생했습니다' }
  }
  return { ok: true }
}
