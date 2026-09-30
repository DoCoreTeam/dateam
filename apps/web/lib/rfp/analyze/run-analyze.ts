/**
 * 분석 한 판 — IR 여러 개 → 리포트 한 장
 *
 * ## 문서를 하나로 합치는 이유
 *
 * 케이스 하나에 제안요청서·과업내용서·서식이 함께 온다. 태스크를 파일마다 돌리면
 * 「사업 기간」이 파일 수만큼 나오고 어느 것이 맞는지 아무도 모른다.
 * **본문 파일을 앞에 두고 이어 붙여** 한 문서로 본다 — 앞의 값이 이긴다.
 *
 * ## 등급 관문은 게이트웨이가 지킨다
 *
 * 여기서는 사슬을 고르고 부르기만 한다. 「이 모델에 보내도 되나」는
 * `callWithFallback` 안에서 호출 직전에 매번 다시 본다 — 폴백이 곧 유출이 되지 않게.
 */

import { runBase, type TaskRunner } from './run-base.ts'
import { persistReport, nextVersion, recordAnalysisRun } from './persist.ts'
import { parseFields, outputSpec } from './parse-fields.ts'
import { buildInstruction } from '../report/tasks.ts'
import { callWithFallback, NoModelAvailableError, type GatewayDeps } from '../ai/gateway.ts'
import { mergeRules, toRule, RULE_COLS, type AnomalyRule } from '../anomaly/rules.ts'
import { applyRuleLayer } from '../anomaly/merge.ts'
import { applyFitLayer } from '../fit/assess.ts'
import { isUsableForAssessment } from '../fit/draft.ts'
import { loadProfile } from '../db/profile.ts'
import { pickModels, costKrw, type AiModel } from '../ai/models.ts'
import { AI_NOTICE, RFP_PROFILE } from '../terms.ts'
import type { DocClass } from '../domain/doc-class.ts'
import type { IrDocument } from '../ir/types.ts'
import type { ValueNode } from '../report/schema.ts'

/** 본문이 앞이다. 같은 값이 여럿이면 앞의 것이 이긴다 */
export const ROLE_ORDER = ['main', 'scope', 'notice', 'special_terms', 'proposal_guide', 'qna', 'amendment', 'forms', 'etc']

export interface DocPart {
  fileId: string
  role?: string
  doc: IrDocument
}

export interface MergedDoc {
  doc: IrDocument
  /** blockId → 어느 파일에서 나왔나. 근거가 원문으로 돌아가려면 필요하다 */
  fileIdByBlock: Map<string, string>
}

/** 여러 IR 을 한 문서로 — 블록 ID 는 파일마다 이미 달라서 그대로 이어 붙인다 */
export function mergeDocs(parts: readonly DocPart[]): MergedDoc {
  const sorted = Array.from(parts).sort(
    (a, b) => roleRank(a.role) - roleRank(b.role),
  )

  const fileIdByBlock = new Map<string, string>()
  const blocks: IrDocument['blocks'] = []
  const sections: IrDocument['sections'] = []
  const tables: IrDocument['tables'] = []
  const figures: IrDocument['figures'] = []
  const pages: IrDocument['pages'] = []
  const warnings: string[] = []

  for (const part of sorted) {
    for (const b of part.doc.blocks) {
      fileIdByBlock.set(b.blockId, part.fileId)
      blocks.push(b)
    }
    sections.push(...part.doc.sections)
    tables.push(...(part.doc.tables ?? []))
    figures.push(...(part.doc.figures ?? []))
    pages.push(...(part.doc.pages ?? []))
    warnings.push(...(part.doc.meta?.warnings ?? []))
  }

  const first = sorted[0]?.doc
  return {
    doc: {
      meta: {
        fileRole: 'main',
        format: first?.meta?.format ?? 'unknown',
        pageCount: pages.length,
        parser: first?.meta?.parser ?? 'unknown',
        parserVersion: first?.meta?.parserVersion ?? '',
        // 여러 파일이면 **가장 나쁜 품질**이 이 케이스의 품질이다
        qualityScore: Math.min(...sorted.map((p) => p.doc.meta?.qualityScore ?? 0), 100),
        warnings,
      },
      pages, sections, blocks, tables, figures,
    },
    fileIdByBlock,
  }
}

function roleRank(role: string | undefined): number {
  const i = ROLE_ORDER.indexOf(role ?? 'etc')
  return i < 0 ? ROLE_ORDER.length : i
}

export interface AnalyzeInput {
  orgId: string
  caseId: string
  docClass: DocClass
  parts: readonly DocPart[]
  models: readonly AiModel[]
  gateway: Omit<GatewayDeps, 'now'>
  /** 한 번에 넣을 원문 토큰 — 모델 컨텍스트에서 답 몫을 뺀 값 */
  contextTokens?: number
}

export interface AnalyzeOutput {
  version: number
  title: string | null
  groundingRate: number
  costKrw: number
  /** 등급 때문에 못 쓴 모델 — 「왜 분석이 얕나」를 설명한다 */
  excluded: string[]
  /** 값을 못 채운 태스크와 그 사유 — 없으면 빈 배열 */
  failures: { taskId: string; error: string }[]
  filledFields: number
}

/** 한도를 모르는 모델에 보낼 크기. 작게 잡는다 — 크게 잡으면 413 으로만 죽는다 */
export const UNKNOWN_LIMIT_TOKENS = 6_000

/** 한도를 알아도 답 몫을 남긴다 */
export const INPUT_RATIO = 0.6

/** 한도가 아주 큰 모델이라도 이보다 크게 보내지 않는다 — 비용이 문서 크기에 비례한다 */
export const MAX_CONTEXT_TOKENS = 24_000

/**
 * 사슬에 보낼 원문 크기.
 *
 * **가장 작은 모델이 정한다.** 1순위 모델 기준으로 잡으면 폴백이 작은 모델에 닿는 순간
 * 그 태스크만 413 으로 죽고, 화면에는 「쓸 수 있는 모델이 없다」로만 보인다.
 */
export function contextBudget(chain: readonly AiModel[]): number {
  const limits = chain.map((m) => m.maxInputTokens ?? UNKNOWN_LIMIT_TOKENS)
  const smallest = limits.length > 0 ? Math.min(...limits) : UNKNOWN_LIMIT_TOKENS
  return Math.max(1_000, Math.min(MAX_CONTEXT_TOKENS, Math.floor(smallest * INPUT_RATIO)))
}

/** 리포트에서 사업명을 집어낸다. 태스크 fields 이름과 맞춰 둔다 */
export function titleFrom(report: { overview: Record<string, { value: unknown }> }): string | null {
  for (const key of ['projectName', 'title', 'businessName']) {
    const v = report.overview?.[key]?.value
    if (typeof v === 'string' && v.trim().length > 1) return v.trim().slice(0, 300)
  }
  return null
}

export async function runAnalyze(
  db: Parameters<typeof persistReport>[0],
  input: AnalyzeInput,
): Promise<AnalyzeOutput> {
  const startedAt = new Date().toISOString()
  const startedMs = Date.now()
  const { doc, fileIdByBlock } = mergeDocs(input.parts)
  const pick = pickModels(input.models, { docClass: input.docClass })
  if (pick.chain.length === 0) {
    throw new NoModelAvailableError(
      pick.excluded.map((e) => e.model.displayName),
      `등급 ${input.docClass} 로 쓸 수 있는 모델이 없다 (후보 ${input.models.length}개)`,
    )
  }

  let spent = 0

  const run: TaskRunner = async (task, prompt) => {
    const full = [buildInstruction(task), outputSpec(task), '', prompt].join('\n')
    const out = await callWithFallback(pick.chain, {
      orgId: input.orgId,
      caseId: input.caseId,
      docClass: input.docClass,
      purpose: `analyze:${task.id}`,
      prompt: full,
    }, input.gateway)

    spent += out.meta.costKrw
    return {
      fields: parseFields({
        text: out.text, task, vendor: out.meta.modelName, fileIdByBlock,
      }),
      costKrw: out.meta.costKrw,
    }
  }

  const base = await runBase({
    doc,
    // **사슬에서 가장 작은 모델에 맞춘다.** 상수로 보내면 작은 모델에서만 413 이 나고,
    // 폴백이 그 모델에 닿는 순간 태스크가 통째로 죽는다(실측 2026-09-09: Groq 7,000 한도에 46,671 전송).
    contextTokens: input.contextTokens ?? contextBudget(pick.chain),
    // 예산을 파일마다 나눠 쓴다 — 안 나누면 첫 파일이 다 쓰고 나머지가 빠진다
    groupOf: (blockId) => fileIdByBlock.get(blockId) ?? 'unknown',
    meta: {
      analysisMode: 'base',
      baseVendor: pick.chain[0].displayName,
      crossVendors: [],
      parserQuality: doc.meta.qualityScore,
      aiNotice: AI_NOTICE,
      docClass: input.docClass,
    },
  }, run)

  // 규칙 층을 여기서 돌린다. AI 만 돌면 「규칙이 확정한 것」과 「AI 가 의심하는 것」이
  // 한 무더기로 섞여, 사용자가 어디에 시간을 들여야 하는지 알 수 없다
  base.report.anomalies = applyRuleLayer(
    mergeRules(await loadRules(db, input.orgId)), doc, base.report,
  )

  const { data: versions } = await (db as unknown as {
    from(t: string): { select(c: string): { eq(k: string, v: string): Promise<{ data: unknown }> } }
  }).from('rfp_report_versions').select('version').eq('case_id', input.caseId)
  const version = nextVersion(
    ((versions ?? []) as { version: number }[]).map((r) => Number(r.version)),
  )

  // 적합도도 여기서 낸다. 규칙 층과 같은 이유다 — assess 를 부르는 곳이 자기 시험뿐이라
  // 리포트의 적합도 칸은 늘 비어 있었다. 판 번호가 정해진 뒤라야 「어느 판을 보고 판정했나」를 적는다
  base.report.fit = await withFitLayer(db, base.report, version)

  // 이력을 먼저 적고 그 id 를 리포트에 싣는다. 안 실으면 「이 리포트가 어느 실행에서 나왔나」를
  // 되물을 길이 없다 — run_id 는 지금까지 늘 null 이었다
  const runId = await recordAnalysisRun(db, {
    orgId: input.orgId,
    caseId: input.caseId,
    mode: 'base',
    baseModelId: pick.chain[0].id,
    crossModelIds: [],
    costKrw: spent,
    durationMs: Date.now() - startedMs,
    // 태스크가 하나라도 실패했으면 성공이라 적지 않는다. 다 실패해도 리포트는 나온다
    status: base.outcomes.some((o) => !o.ok) ? 'failed' : 'succeeded',
    startedAt,
    fallbackApplied: [],
  })

  await persistReport(db, {
    orgId: input.orgId,
    caseId: input.caseId,
    runId,
    report: base.report,
    version,
    schemaId: null,
  })

  return {
    version,
    title: titleFrom(base.report as never),
    groundingRate: base.groundingRate,
    costKrw: spent,
    excluded: pick.excluded.map((e) => `${e.model.displayName}:${e.reason}`),
    // 리포트가 비어 나오는 것과 «내용이 없는 문서»를 화면이 구분할 수 있어야 한다.
    // 사유를 안 남기면 둘이 똑같이 보이고, 실제로 그래서 9번 호출이 전부 실패한 것을 못 봤다
    failures: base.outcomes.filter((o) => !o.ok).map((o) => ({
      taskId: o.taskId, error: o.error ?? '',
    })),
    filledFields: base.outcomes.reduce((n, o) => n + Object.keys(o.fields).length, 0),
  }
}

export { costKrw }

/** 조직이 고친 규칙만 가져온다. 못 읽으면 빈 목록 — mergeRules 가 기본값으로 채운다 */
async function loadRules(db: unknown, orgId: string): Promise<AnomalyRule[]> {
  try {
    const { data, error } = await (db as {
      from(t: string): { select(c: string): { eq(k: string, v: string): Promise<{ data: unknown; error: unknown }> } }
    }).from('rfp_anomaly_rules').select(RULE_COLS).eq('org_id', orgId)
    if (error || !Array.isArray(data)) return []
    return (data as Record<string, unknown>[]).map(toRule)
  } catch {
    return []
  }
}

/**
 * 회사 프로필을 읽어 적합도를 낸다.
 *
 * 프로필을 못 읽어도 분석을 세우지 않는다 — 리포트는 이미 다 만들어졌고,
 * 적합도 한 칸 때문에 그것을 버리면 사용자가 잃는 것이 훨씬 크다.
 * 대신 왜 판정이 없는지를 그 칸에 적어 화면이 그대로 말하게 한다.
 */
async function withFitLayer(
  db: unknown,
  report: { anomalies: unknown[] } & Parameters<typeof applyFitLayer>[0]['report'],
  reportVersion: number,
): Promise<Record<string, ValueNode<unknown>> | null> {
  let profile: Awaited<ReturnType<typeof loadProfile>> = null
  try {
    profile = await loadProfile(db as never)
  } catch {
    // 못 읽은 것과 없는 것은 다르지만, 둘 다 「지어내지 않는다」로 간다
    profile = null
  }

  const out = applyFitLayer({
    profile,
    usable: profile ? isUsableForAssessment(profile) : false,
    report,
    anomalies: (report.anomalies ?? []).flatMap((a) => {
      const row = a as { severity?: unknown }
      return typeof row?.severity === 'string' ? [{ severity: row.severity }] : []
    }),
    reportVersion,
  })

  /**
   * 리포트의 적합도 칸은 값 노드 모음이다. 판정을 못 했으면 사유를 그 모양으로 담는다.
   *
   * 판정값은 confirmed 다 — 저장된 프로필과 리포트에서 규칙으로 계산한 값이지 모델의 짐작이 아니다.
   * 못 했다는 안내는 unconfirmed 다 — 근거가 있어서 적은 것이 아니라 근거가 없어서 적은 것이다.
   */
  const node = (value: unknown, grounding: 'confirmed' | 'unconfirmed'): ValueNode<unknown> => ({
    value, evidence: [], confidence: null, grounding,
    vendor: null, verification: 'single',
  })

  if (out.blocked) {
    const none = out.blocked === 'no_profile'
    return {
      blocked: node(out.blocked, 'unconfirmed'),
      title: node(none ? RFP_PROFILE.fitBlockedNoProfile : RFP_PROFILE.fitBlockedDraft, 'unconfirmed'),
      desc: node(none ? RFP_PROFILE.fitBlockedDesc : RFP_PROFILE.fitBlockedDraftDesc, 'unconfirmed'),
      cta: node(RFP_PROFILE.fitBlockedCta, 'unconfirmed'),
    }
  }

  const a = out.assessment
  if (!a) return null
  return {
    verdict: node(a.verdict, 'confirmed'),
    conditional: node(a.conditional, 'confirmed'),
    score: node(a.score, 'confirmed'),
    parts: node(a.parts, 'confirmed'),
    hardChecks: node(a.hardChecks, 'confirmed'),
    summary: node(a.summary, 'confirmed'),
    gaps: node(a.gaps, 'confirmed'),
    profileVersion: node(a.profileVersion, 'confirmed'),
    reportVersion: node(a.reportVersion, 'confirmed'),
  }
}
