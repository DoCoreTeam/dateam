'use server'

// 목록 심층분석 재정의 — 그룹핑 서버액션 (①~④ + 재그룹핑).
//
// ★ 이 파일이 존재하는 이유(이번 재정의의 본질):
//   기존 extractItems는 formData에서 'text'/'file'만 읽었고 추출 프롬프트가 상수로 고정돼 있었다.
//   그래서 사용자가 무엇을 지시하든 항목 나누기에는 아무 영향이 없었다.
//   여기서는 command를 반드시 받아 유형판정·절단 양쪽에 주입한다.

import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { createAdminClient } from '@/lib/supabase/server'
import { callGeminiOnce, parseJsonObject, ZERO_USAGE } from '@/lib/ai-chat/analyze-gemini'
import { logDbError } from '@/lib/ai-chat/log-db-error'
import { runGrouping, runRegroup, type JsonAiCaller } from '@/lib/ai-chat/grouping/pipeline'
import { DOC_TYPE_LABEL, DOC_TYPES, docTypeFromCommand, type DocType } from '@/lib/ai-chat/grouping/classify-doc'
import type { Group, DocMetaEntry, UnassignedLine } from '@/lib/ai-chat/grouping/types'
import type { ChatUsage } from '@/lib/ai-chat/provider'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any

/** 붙여넣기 상한 — 초과 시 절단하지 않고 에러(유실0 원칙). */
const MAX_SOURCE_CHARS = 300_000
/**
 * 지시 길이 상한. 지시는 그룹마다 프롬프트에 반복 주입되므로(refine-group),
 * 길이 × 그룹 수로 토큰이 곱연산 증가한다 — 비용 방어를 위해 캡을 둔다.
 */
const MAX_COMMAND_CHARS = 2_000

export interface GroupingOk {
  ok: true
  sessionId: string
  revision: number
  docType: DocType
  docTypeLabel: string
  docTypeSource: 'ai' | 'instruction'
  groups: Group[]
  meta: DocMetaEntry[]
  unassignedLines: UnassignedLine[]
  coverageOk: boolean
  cutReason: string
  cutFallback: boolean
  usage: ChatUsage
}
export interface GroupingErr {
  ok: false
  error: string
}
export type GroupingResultPayload = GroupingOk | GroupingErr

/** 누적 토큰을 모으면서 AI를 호출하는 caller를 만든다. AI 실패는 던지지 않고 null 반환(폴백 유도). */
function makeAiCaller(userId: string, acc: { usage: ChatUsage }): JsonAiCaller {
  return async (prompt: string) => {
    try {
      const res = await callGeminiOnce(userId, prompt)
      acc.usage = {
        promptTokens: acc.usage.promptTokens + res.usage.promptTokens,
        outputTokens: acc.usage.outputTokens + res.usage.outputTokens,
        totalTokens: acc.usage.totalTokens + res.usage.totalTokens,
      }
      return parseJsonObject(res.text)
    } catch (err) {
      // AI 실패가 파이프라인을 막지 않는다 — 결정론 폴백으로 계속 진행한다.
      logDbError('grouping:ai', err, { promptHead: prompt.slice(0, 80) })
      return null
    }
  }
}

/** 문서명·프로젝트명·제목 성격의 메타 키(제목 후보로 쓴다). */
const TITLE_META_KEY_RE = /(문서\s*명|프로젝트\s*명|제목|title|project|name)/i

/**
 * 세션 제목 도출 — 목록에서 "무슨 문서인지" 알아볼 수 있어야 한다.
 * 우선순위: ① H1 헤딩 → ② 문서명/프로젝트명 메타 값 → ③ 첫 그룹 제목 → ④ 메타 아닌 첫 줄.
 *
 * 왜 이 순서인가: front-matter 메타로 시작하고 H1이 없는 문서(예: "프로젝트명: 제타 클론"으로
 * 시작하는 기획서)는 첫 비공백 줄을 쓰면 "- 문서 버전: v0.1.0"이 제목이 되어 식별 불가다(실측 사고).
 * 그런 문서는 대개 프로젝트명 메타에 진짜 이름이 있으므로 그것을 제목으로 승격한다.
 */
function titleFrom(text: string, groups: Group[], meta: DocMetaEntry[]): string {
  // ① H1 (레벨1 헤딩) — 문서 대표 제목
  const h1 = text.split('\n').find((l) => /^#\s+\S/.test(l))
  if (h1) return h1.replace(/^#+\s*/, '').trim().slice(0, 120)

  // ② 문서명/프로젝트명 메타 — H1 없는 문서의 진짜 이름
  const nameMeta = meta.find((m) => TITLE_META_KEY_RE.test(m.key))
  if (nameMeta?.value?.trim()) return nameMeta.value.trim().slice(0, 120)

  // ③ 임의 헤딩(H2~) → ④ 첫 그룹 제목
  const anyHeading = text.split('\n').find((l) => /^#{2,6}\s+\S/.test(l))
  if (anyHeading) return anyHeading.replace(/^#+\s*/, '').trim().slice(0, 120)

  const firstGroup = groups[0]?.title?.trim()
  if (firstGroup) return firstGroup.replace(/^[-*•]\s*/, '').slice(0, 120)

  const metaLines = new Set(meta.map((m) => m.lineNo))
  const fallback = text.split('\n').find((l, i) => l.trim() && !metaLines.has(i))
  return fallback?.replace(/^[-*•#]+\s*/, '').trim().slice(0, 120) || '제목 없는 분석'
}

async function persistGroups(
  admin: AdminClient,
  sessionId: string,
  revision: number,
  groups: Group[],
): Promise<string | null> {
  const rows = groups.map((g, idx) => ({
    session_id: sessionId,
    idx,
    revision,
    item_text: g.title,
    title: g.title,
    body_raw: g.bodyRaw,
    source_span: g.sourceSpan,
    tree_path: g.treePath,
    depth: g.depth,
    origin: g.origin,
  }))
  if (rows.length === 0) return null
  const { error } = await admin.from('ai_analysis_items').insert(rows)
  if (error) {
    logDbError('persistGroups:items.insert', error, { sessionId, revision, count: rows.length })
    return '그룹 저장 중 오류가 발생했습니다'
  }
  return null
}

/**
 * ①~④ 실행 + 세션/그룹 영속.
 * @param sourceText 원문 (파일 업로드는 기존 extractItems가 텍스트로 만든 뒤 여기로 넘긴다)
 * @param command    사용자 자유 지시 — 비어 있어도 동작하나, 이 값이 전 단계를 지배한다
 */
export async function analyzeDocument(
  sourceText: string,
  command: string,
  sourceHtml?: string,
): Promise<GroupingResultPayload> {
  const auth = await requireAdminApi()
  if (auth.error) return { ok: false, error: '권한이 없습니다' }

  const text = (sourceText ?? '').trim()
  if (!text) return { ok: false, error: '분석할 내용을 입력하세요' }
  if (text.length > MAX_SOURCE_CHARS) {
    return { ok: false, error: `내용이 너무 깁니다 (${MAX_SOURCE_CHARS.toLocaleString()}자 이하)` }
  }
  if ((command ?? '').length > MAX_COMMAND_CHARS) {
    return { ok: false, error: `지시가 너무 깁니다 (${MAX_COMMAND_CHARS.toLocaleString()}자 이하)` }
  }

  const acc = { usage: ZERO_USAGE }
  const result = await runGrouping(text, command ?? '', makeAiCaller(auth.user.id, acc))

  const admin = createAdminClient() as AdminClient
  const { data: session, error: sessionErr } = await admin
    .from('ai_analysis_sessions')
    .insert({
      user_id: auth.user.id,
      title: titleFrom(text, result.groups, result.meta),
      source_text: text,
      source_html: sourceHtml && sourceHtml.trim() ? sourceHtml : null, // R1-2 원본 HTML 무손실 보존
      source_format: sourceHtml && sourceHtml.trim() ? 'html' : 'plain',
      source_kind: 'text',
      command: (command ?? '').trim(),
      doc_type: result.docType,
      doc_type_source: result.docTypeSource,
      doc_meta: result.meta,
      grouping_revision: 1,
      unassigned_lines: result.coverage.unassignedLines,
    })
    .select('id')
    .single()
  if (sessionErr || !session) {
    logDbError('analyzeDocument:sessions.insert', sessionErr)
    return { ok: false, error: '세션 저장 중 오류가 발생했습니다' }
  }
  const sessionId = (session as { id: string }).id

  const persistErr = await persistGroups(admin, sessionId, 1, result.groups)
  if (persistErr) return { ok: false, error: persistErr } // guard-ok: persistGroups가 이미 logDbError로 원문 기록

  return {
    ok: true,
    sessionId,
    revision: 1,
    docType: result.docType,
    docTypeLabel: DOC_TYPE_LABEL[result.docType],
    docTypeSource: result.docTypeSource,
    groups: result.groups,
    meta: result.meta,
    unassignedLines: result.coverage.unassignedLines,
    coverageOk: result.coverage.ok,
    cutReason: result.cut.reason,
    cutFallback: result.cut.fallback,
    usage: acc.usage,
  }
}

function isDocType(v: unknown): v is DocType {
  return typeof v === 'string' && (DOC_TYPES as readonly string[]).includes(v)
}

/**
 * 재그룹핑 — 원문은 그대로 두고 절단만 다시. 새 리비전으로 기록하고 이전 리비전은 보존한다(FR-7).
 * @param newCommand 새 지시 ("카테고리 단위로 크게 묶어" 등)
 * @param docTypeOverride 사용자가 유형을 바꾼 경우
 */
export async function regroupSession(
  sessionId: string,
  newCommand: string,
  docTypeOverride?: string,
): Promise<GroupingResultPayload> {
  const auth = await requireAdminApi()
  if (auth.error) return { ok: false, error: '권한이 없습니다' }
  if ((newCommand ?? '').length > MAX_COMMAND_CHARS) {
    return { ok: false, error: `지시가 너무 깁니다 (${MAX_COMMAND_CHARS.toLocaleString()}자 이하)` }
  }

  const admin = createAdminClient() as AdminClient
  const { data: row, error: loadErr } = await admin
    .from('ai_analysis_sessions')
    .select('id, source_text, doc_type, grouping_revision')
    .eq('id', sessionId)
    .eq('user_id', auth.user.id)
    .is('deleted_at', null)
    .single()
  if (loadErr || !row) {
    logDbError('regroupSession:sessions.select', loadErr, { sessionId })
    return { ok: false, error: '세션을 찾을 수 없습니다' }
  }

  const session = row as { source_text: string; doc_type: string | null; grouping_revision: number }
  // 유형 결정 우선순위: 명시 override > 재지시 문장에서 도출(예: "회의록으로 다시 묶어") > 기존 유형.
  // 이 중간 단계가 드롭다운을 대체한다 — 유형도 지시로 바꾼다(계약 D: 지시가 전 단계를 지배).
  const fromCmd = docTypeFromCommand(newCommand ?? '')
  const docType: DocType = isDocType(docTypeOverride)
    ? docTypeOverride
    : (fromCmd ?? (isDocType(session.doc_type) ? session.doc_type : 'other'))
  const docTypeChanged = isDocType(docTypeOverride) || fromCmd !== null
  const nextRevision = (session.grouping_revision ?? 1) + 1

  const acc = { usage: ZERO_USAGE }
  const result = await runRegroup(
    session.source_text,
    newCommand ?? '',
    docType,
    makeAiCaller(auth.user.id, acc),
  )

  const persistErr = await persistGroups(admin, sessionId, nextRevision, result.groups)
  if (persistErr) return { ok: false, error: persistErr } // guard-ok: persistGroups가 이미 logDbError로 원문 기록

  const { error: updErr } = await admin
    .from('ai_analysis_sessions')
    .update({
      grouping_revision: nextRevision,
      command: (newCommand ?? '').trim(),
      doc_type: docType,
      doc_meta: result.meta,
      unassigned_lines: result.coverage.unassignedLines,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionId)
  if (updErr) {
    logDbError('regroupSession:sessions.update', updErr, { sessionId, nextRevision })
    return { ok: false, error: '재그룹핑 저장 중 오류가 발생했습니다' }
  }

  return {
    ok: true,
    sessionId,
    revision: nextRevision,
    docType,
    docTypeLabel: DOC_TYPE_LABEL[docType],
    docTypeSource: docTypeChanged ? 'instruction' : 'ai',
    groups: result.groups,
    meta: result.meta,
    unassignedLines: result.coverage.unassignedLines,
    coverageOk: result.coverage.ok,
    cutReason: result.cut.reason,
    cutFallback: result.cut.fallback,
    usage: acc.usage,
  }
}
