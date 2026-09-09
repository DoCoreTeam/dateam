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
import { persistReport, nextVersion } from './persist.ts'
import { parseFields, outputSpec } from './parse-fields.ts'
import { buildInstruction } from '../report/tasks.ts'
import { callWithFallback, NoModelAvailableError, type GatewayDeps } from '../ai/gateway.ts'
import { pickModels, costKrw, type AiModel } from '../ai/models.ts'
import { AI_NOTICE } from '../terms.ts'
import type { DocClass } from '../domain/doc-class.ts'
import type { IrDocument } from '../ir/types.ts'

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
  const { doc, fileIdByBlock } = mergeDocs(input.parts)
  const pick = pickModels(input.models, { docClass: input.docClass })
  if (pick.chain.length === 0) {
    throw new NoModelAvailableError(pick.excluded.map((e) => e.model.displayName))
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
    contextTokens: input.contextTokens ?? 24_000,
    meta: {
      analysisMode: 'base',
      baseVendor: pick.chain[0].displayName,
      crossVendors: [],
      parserQuality: doc.meta.qualityScore,
      aiNotice: AI_NOTICE,
      docClass: input.docClass,
    },
  }, run)

  const { data: versions } = await (db as unknown as {
    from(t: string): { select(c: string): { eq(k: string, v: string): Promise<{ data: unknown }> } }
  }).from('rfp_report_versions').select('version').eq('case_id', input.caseId)
  const version = nextVersion(
    ((versions ?? []) as { version: number }[]).map((r) => Number(r.version)),
  )

  await persistReport(db, {
    orgId: input.orgId,
    caseId: input.caseId,
    runId: null,
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
  }
}

export { costKrw }
