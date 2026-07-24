// 목록 심층분석 v3(그룹핑 재정의) — analyze-runner.ts(drainSession, SSOT)의 그룹단위 워커 헬퍼.
// 300줄 분할 목적의 파일 분리이며 로직 경계: claim(원자적 조건부 갱신)·그룹 1건 재가공·문서 조립.
// 공개 API는 analyze-runner.ts만(drainSession) — 이 파일은 그 내부 구현.
//
// Phase 4 계약 변경: ai_analysis_items는 "항목(1줄)"이 아니라 "그룹"(title+body_raw 전체)이다.
// claim은 세션의 현재 활성 grouping_revision 안에서만 이뤄진다(과거 리비전 재처리 방지).

import { refineGroupItem, type RefineGroupOutcome } from './analyze-core.ts'
import { getProvider } from './registry.ts'
import { logDbError } from './log-db-error.ts'
import {
  assembleDocument,
  buildCriticPrompt,
  appendCriticNotes,
  type GroupRefineOutcome,
} from './grouping/assemble-document.ts'
import type { DocType } from './grouping/classify-doc.ts'
import type { TemplateSpec } from './templates/catalog.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any

const STALL_MS = 10 * 60 * 1000 // claimed_at이 이보다 오래된 running 항목은 재claim 대상(워커 이탈 가정)
const CLAIM_CANDIDATE_MULTIPLIER = 3 // 조건부 갱신 경합 스킵 대비 여유 있게 후보 조회
const DIGEST_MAX_CHARS = 500

export interface SessionRow {
  id: string
  title: string
  command: string
  source_text: string
  control: 'running' | 'paused' | 'cancelled'
  phase: string
  synth_status: string
  doc_type: string | null
  grouping_revision: number
  model: string | null
}

/** ai_analysis_items 1행 = 그룹 1건(Phase 4 계약 — title+body_raw가 심화 입력의 핵심). */
export interface ItemRow {
  id: string
  idx: number
  revision: number
  title: string
  body_raw: string
  tree_path: string
  depth: number
  status: string
}

interface ItemRowWithAttempts extends ItemRow {
  attempts: number
}

/**
 * 세션의 현재 리비전(revision) 안에서 pending 또는 stalled(running & claimed_at < 10분전) 그룹을
 * idx순 최대 limit개 조건부 claim. 다른 리비전의 그룹은 절대 claim하지 않는다.
 */
export async function claimItems(
  admin: AdminClient,
  sessionId: string,
  revision: number,
  limit: number,
): Promise<ItemRow[]> {
  const stallThreshold = new Date(Date.now() - STALL_MS).toISOString()
  const { data: candidates } = await admin
    .from('ai_analysis_items')
    .select('id, idx, revision, title, body_raw, tree_path, depth, status, attempts')
    .eq('session_id', sessionId)
    .eq('revision', revision)
    .or(`status.eq.pending,and(status.eq.running,claimed_at.lt.${stallThreshold})`)
    .order('idx', { ascending: true })
    .limit(limit * CLAIM_CANDIDATE_MULTIPLIER)

  const rows = (candidates ?? []) as ItemRowWithAttempts[]
  const claimed: ItemRow[] = []
  const nowIso = new Date().toISOString()

  for (const c of rows) {
    if (claimed.length >= limit) break
    const { data: updated, error } = await admin
      .from('ai_analysis_items')
      .update({ status: 'running', claimed_at: nowIso, started_at: nowIso, attempts: c.attempts + 1 })
      .eq('id', c.id)
      .eq('status', c.status) // 조건부 — 다른 워커가 먼저 claim했으면 affected 0(멱등 — 재과금 없음)
      .select('id, idx, revision, title, body_raw, tree_path, depth, status')
    if (error || !updated || updated.length === 0) continue // 경합 패 — 스킵
    claimed.push(updated[0] as ItemRow)
  }
  return claimed
}

export interface RunItemCtx {
  apiKey: string
  model: string
  command: string
  docType: DocType
  /** 문서 전체 아웃라인(배치당 1회 계산 — cut-groups.ts serializeOutline). */
  docContext: string
  template?: Pick<TemplateSpec, 'name' | 'fields'>
  signal: AbortSignal
  onDelta?: (itemIdx: number, delta: string) => void
}

/** 그룹 1건 재가공(⑥) → done 영속. 실패 시 throw(runWithConcurrency 재시도용 — 429 등 정상 경로). */
export async function runItem(
  admin: AdminClient,
  item: ItemRow,
  ctx: RunItemCtx,
  emitProgress: () => Promise<void>,
): Promise<void> {
  const outcome: RefineGroupOutcome = await refineGroupItem({
    apiKey: ctx.apiKey,
    model: ctx.model,
    group: { title: item.title, bodyRaw: item.body_raw, treePath: item.tree_path, depth: item.depth },
    docType: ctx.docType,
    docContext: ctx.docContext,
    command: ctx.command,
    template: ctx.template,
    signal: ctx.signal,
    onDelta: (d) => ctx.onDelta?.(item.idx, d),
  })

  await admin
    .from('ai_analysis_items')
    .update({
      status: 'done',
      result_text: outcome.resultText,
      digest_text: outcome.resultText.slice(0, DIGEST_MAX_CHARS),
      finished_at: new Date().toISOString(),
      prompt_tokens: outcome.usage.promptTokens,
      output_tokens: outcome.usage.outputTokens,
    })
    .eq('id', item.id)

  await emitProgress()
}

interface GroupResultRow {
  idx: number
  tree_path: string
  title: string
  depth: number
  status: string
  result_text: string | null
  error_text: string | null
}

/**
 * ⑦ 정합 패스 + 결정론 조립(A3 old synthesizeItems를 그룹 기반 assembleDocument로 대체).
 * 완료(done)/실패(error) 그룹 전부를 순회해 완성 문서를 결정론 조립하고, 비차단 크리틱 1회로
 * "## 검토 노트"를 덧붙인다(크리틱 실패해도 문서는 이미 완성돼 있다 — FR 비차단 원칙).
 * 반환값은 항상 true(조립 시도 완료).
 */
export async function runSynthesis(
  admin: AdminClient,
  sessionId: string,
  session: SessionRow,
  geminiConfig: { apiKey: string; model: string },
  signal: AbortSignal,
): Promise<boolean> {
  await admin
    .from('ai_analysis_sessions')
    .update({ phase: 'synthesizing', synth_status: 'running' })
    .eq('id', sessionId)

  const revision = session.grouping_revision ?? 1
  const { data: rows } = await admin
    .from('ai_analysis_items')
    .select('idx, tree_path, title, depth, status, result_text, error_text')
    .eq('session_id', sessionId)
    .eq('revision', revision)
    .order('idx', { ascending: true })

  const groupRows = (rows ?? []) as GroupResultRow[]
  if (groupRows.length === 0) {
    await admin
      .from('ai_analysis_sessions')
      .update({ phase: 'done', synth_status: 'error' })
      .eq('id', sessionId)
    return true
  }

  const outcomes: GroupRefineOutcome[] = groupRows.map((r) => ({
    idx: r.idx,
    treePath: r.tree_path,
    title: r.title,
    depth: r.depth,
    status: r.status === 'done' ? 'done' : 'error',
    resultText: r.result_text ?? undefined,
    errorText: r.error_text ?? undefined,
  }))

  const docTitle = session.title?.trim() || '심층분석 결과'
  const assembled = assembleDocument(docTitle, outcomes)
  let synthText = assembled.markdown

  // 정합 패스(크리틱) — 비차단. 실패해도 이미 완성된 문서를 그대로 쓴다(부록/재시도 없음).
  try {
    const provider = getProvider('gemini')
    const critic = await provider.streamChat({
      apiKey: geminiConfig.apiKey,
      model: geminiConfig.model,
      turns: [{ role: 'user', content: buildCriticPrompt(docTitle, session.command, synthText) }],
      signal,
      onDelta: () => {},
    })
    synthText = appendCriticNotes(synthText, critic.text)
  } catch (err) {
    logDbError('runSynthesis:critic', err, { sessionId })
  }

  await admin
    .from('ai_analysis_sessions')
    .update({
      phase: 'done',
      synth_status: 'done',
      synth_text: synthText,
      coverage: {
        total: outcomes.length,
        covered: outcomes.filter((o) => o.status === 'done').map((o) => o.idx),
        missing: assembled.missingGroups.map((m) => m.idx),
        appended: [],
      },
    })
    .eq('id', sessionId)

  return true
}
