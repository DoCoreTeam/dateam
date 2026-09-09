/**
 * 기본 모드 분석 실행 (설계서 3.6)
 *
 * ## 태스크 아홉을 하나로 합치는 자리
 *
 * 각 태스크는 자기 섹션만 보고 자기 칸만 채운다. 여기서 합칠 때 두 가지를 지킨다.
 *
 * ① **한 태스크가 실패해도 나머지는 남긴다.** 예산 태스크가 죽었다고 일정까지 버리면
 *    사용자는 아무것도 못 얻는다. 실패한 칸은 비워 두고 사유를 meta 에 적는다.
 * ② **근거 대조와 규칙 검증을 통과한 값만** 확인으로 표시한다.
 *    모델이 채운 그대로 저장하면 화면의 확인 배지가 아무 뜻도 없어진다.
 *
 * ## 리포트는 불변이다
 *
 * v1 을 고치지 않고 v2 를 만든다. 「그때 리포트에는 5억이라 적혀 있었다」를
 * 나중에 보여 줄 수 없으면 교차검증도 정정공고 비교도 근거를 잃는다.
 */

import type { IrDocument } from '../ir/types.ts'
import { EXTRACT_TASKS, taskById, type ExtractTask, type TaskId } from '../report/tasks.ts'
import { estimateTokens, routeSections, renderBatch, planFallback } from '../report/routing.ts'
import { emptyReport, type Report, type ReportMeta, type ValueNode } from '../report/schema.ts'
import { groundValue, groundingRate, type BlockText } from '../report/grounding.ts'
import { checkSchedule, checkBudget, compareWithG2b, type RuleFinding, type G2bMeta } from '../report/rule-verify.ts'

export interface TaskOutcome {
  taskId: TaskId
  ok: boolean
  /** 태스크가 채운 필드들 */
  fields: Record<string, ValueNode<unknown>>
  error: string | null
  /** 컨텍스트를 나눠 여러 번 물었나 */
  batches: number
  costKrw: number
}

/** 태스크 하나를 실제로 부르는 함수 — 게이트웨이가 끼워진다 */
export type TaskRunner = (
  task: ExtractTask,
  prompt: string,
) => Promise<{ fields: Record<string, ValueNode<unknown>>; costKrw: number }>

export interface RunBaseInput {
  doc: IrDocument
  contextTokens: number
  meta: Omit<ReportMeta, 'costKrw' | 'durationMs' | 'generatedAt' | 'fallbackApplied'>
  /** 나라장터가 준 값. 없으면 대조를 건너뛴다 */
  g2b?: G2bMeta | null
  /**
   * 블록이 어느 파일에서 왔나.
   *
   * 주면 예산을 **파일마다 나눠** 쓴다. 안 주면 앞에서부터 채우고,
   * 그러면 파일이 여럿일 때 뒤 파일이 통째로 빠진다.
   */
  groupOf?: (blockId: string) => string
  now?: () => number
}

export interface RunBaseResult {
  report: Report
  outcomes: TaskOutcome[]
  ruleFindings: RuleFinding[]
  /** 근거가 확인된 값의 비율 */
  groundingRate: number
}

/**
 * 태스크 아홉을 돌려 리포트 하나를 만든다.
 *
 * 태스크는 서로를 안 본다 — 순서를 바꿔도 결과가 같아야 다시 돌릴 때 안전하다.
 */
export async function runBase(input: RunBaseInput, run: TaskRunner): Promise<RunBaseResult> {
  const now = input.now ?? (() => Date.now())
  const started = now()
  const outcomes: TaskOutcome[] = []
  const blocks: BlockText[] = input.doc.blocks.map((b) => ({ blockId: b.blockId, text: b.text }))

  for (const task of EXTRACT_TASKS) {
    outcomes.push(await runTask(task, input, run, blocks))
  }

  const report = assemble(outcomes, {
    ...input.meta,
    costKrw: outcomes.reduce((n, o) => n + o.costKrw, 0),
    durationMs: now() - started,
    generatedAt: new Date(now()).toISOString(),
    fallbackApplied: outcomes.some((o) => o.batches > 1),
  })

  const ruleFindings = verifyRules(report, input.g2b ?? null)
  const nodes = allNodes(report)

  return { report, outcomes, ruleFindings, groundingRate: groundingRate(nodes) }
}

async function runTask(
  task: ExtractTask, input: RunBaseInput, run: TaskRunner, blocks: readonly BlockText[],
): Promise<TaskOutcome> {
  const plan = routeSections(input.doc, task, input.contextTokens)
  // 관련 섹션이 없으면 문서 전체로 한 번 본다 — 라우팅이 틀릴 수 있다
  const batches = plan.empty
    ? [renderWholeDoc(input.doc, input.contextTokens, input.groupOf)]
    : plan.batches.map((b) => renderBatch(b))

  const fields: Record<string, ValueNode<unknown>> = {}
  let costKrw = 0

  try {
    for (const prompt of batches) {
      const out = await run(task, prompt)
      costKrw += out.costKrw
      for (const [key, node] of Object.entries(out.fields)) {
        // 나중 묶음이 앞 묶음을 덮지 않는다 — 값이 있는 쪽을 남긴다
        if (fields[key]?.value !== undefined && fields[key]?.value !== null) continue
        fields[key] = node
      }
    }

    // 라우팅으로 못 찾은 필드에만 전체 문맥으로 한 번 더
    const filled = new Set(Object.entries(fields).filter(([, v]) => v.value !== null).map(([k]) => k))
    const fb = planFallback(task, filled, plan.empty)
    if (fb.needed) {
      const out = await run(task, renderWholeDoc(input.doc, input.contextTokens, input.groupOf))
      costKrw += out.costKrw
      for (const [key, node] of Object.entries(out.fields)) {
        if (fields[key]?.value !== undefined && fields[key]?.value !== null) continue
        fields[key] = node
      }
    }

    // 근거 대조 — 모델이 채운 그대로 저장하면 확인 배지가 아무 뜻도 없어진다
    for (const [key, node] of Object.entries(fields)) {
      fields[key] = groundValue(node, blocks).node
    }

    return { taskId: task.id, ok: true, fields, error: null, batches: batches.length, costKrw }
  } catch (e) {
    // 한 태스크가 죽었다고 나머지를 버리면 사용자는 아무것도 못 얻는다
    return {
      taskId: task.id, ok: false, fields, batches: batches.length, costKrw,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

/**
 * 관련 섹션을 못 찾았을 때의 폴백 — 문서 전체를 본다.
 *
 * **예산을 지킨다.** 예전에는 통째로 보냈고, 그래서 라우팅이 빗나간 태스크만
 * 413 으로 죽었다(실측 2026-09-09: 한도 7,000 인 모델에 46,671 전송, 9개 중 8개 실패).
 * 앞쪽부터 담는 이유는 공고문이 개요·예산·일정을 앞에 두기 때문이다.
 */
export function renderWholeDoc(
  doc: IrDocument, budgetTokens = Infinity, groupOf?: (blockId: string) => string,
): string {
  // **파일마다 몫을 준다.** 앞에서부터 채우면 첫 파일이 예산을 다 쓰고
  // 뒤 파일은 **한 번도 안 보낸다** — 실측 2026-09-09: 제안요청서 419블록이 예산을 소진해
  // 공고서 19블록(추정가격·제출마감·평가기준이 든)이 분석에 통째로 빠졌다.
  const groups = splitByGroup(doc.blocks, groupOf)
  const share = budgetTokens === Infinity ? Infinity : budgetTokens / groups.length

  const parts: string[] = []
  for (const group of groups) {
    let used = 0
    for (const b of group) {
      const piece = `[블록 ${b.blockId}]\n${b.text}`
      const cost = estimateTokens(piece)
      if (used + cost > share) break
      parts.push(piece)
      used += cost
    }
  }

  // 예산이 한 블록도 못 담을 만큼 작으면 첫 블록은 잘라서라도 넣는다 —
  // 빈 프롬프트를 보내면 모델이 「원문이 없다」고 답하고 그게 값으로 저장된다
  if (parts.length === 0 && doc.blocks.length > 0) {
    const first = doc.blocks[0]
    return `[블록 ${first.blockId}]\n${first.text}`.slice(0, Math.max(200, budgetTokens * 2))
  }
  return parts.join('\n\n')
}

/** 블록을 파일별로 나눈다. 나눌 기준이 없으면 한 무리다 */
function splitByGroup(
  blocks: readonly IrDocument['blocks'][number][], groupOf?: (blockId: string) => string,
): IrDocument['blocks'][number][][] {
  if (!groupOf) return blocks.length > 0 ? [Array.from(blocks)] : []
  const byKey = new Map<string, IrDocument['blocks'][number][]>()
  for (const b of blocks) {
    const key = groupOf(b.blockId)
    byKey.set(key, [...(byKey.get(key) ?? []), b])
  }
  return Array.from(byKey.values())
}

/** 태스크 결과를 리포트 칸으로 옮긴다 */
export function assemble(outcomes: readonly TaskOutcome[], meta: ReportMeta): Report {
  const report = emptyReport(meta)

  for (const o of outcomes) {
    const task = taskById(o.taskId)
    if (o.taskId === 'anomalies') {
      const candidates = o.fields.candidates?.value
      report.anomalies = Array.isArray(candidates) ? candidates : []
      continue
    }
    if (o.taskId === 'requirements') {
      // 요구사항은 범위 칸에 붙는다 — 태스크는 아홉이고 칸은 열하나다.
      // 못 뽑았으면 칸을 만들지 않는다 — 빈 노드를 두면 「요구사항 없음」과 구분이 안 된다
      if (o.fields.requirements) report.scope.requirements = o.fields.requirements
      continue
    }
    const target = task.target as Exclude<keyof Report, 'anomalies' | 'comparisons' | 'meta' | 'fit'>
    const bucket = report[target] as Record<string, ValueNode<unknown>>
    for (const [key, node] of Object.entries(o.fields)) bucket[key] = node
  }

  return report
}

/** 리포트 안의 모든 값 노드 */
export function allNodes(report: Report): ValueNode<unknown>[] {
  const buckets = [
    report.overview, report.scope, report.schedule, report.budget,
    report.constraints, report.checklist, report.evaluation,
  ]
  return buckets.flatMap((b) => Object.values(b))
}

/** 산술과 외부 메타 대조 — 리포트가 다 채워진 뒤에 한 번 */
export function verifyRules(report: Report, g2b: G2bMeta | null): RuleFinding[] {
  const num = (bucket: Record<string, ValueNode<unknown>>, key: string): number | null => {
    const v = bucket[key]?.value
    return typeof v === 'number' ? v : null
  }
  const str = (bucket: Record<string, ValueNode<unknown>>, key: string): string | null => {
    const v = bucket[key]?.value
    return typeof v === 'string' ? v : null
  }
  const bool = (bucket: Record<string, ValueNode<unknown>>, key: string): boolean | null => {
    const v = bucket[key]?.value
    return typeof v === 'boolean' ? v : null
  }

  const findings: RuleFinding[] = [
    ...checkSchedule({
      start: str(report.schedule, 'start'),
      end: str(report.schedule, 'end'),
      durationMonths: num(report.schedule, 'durationMonths'),
      proposalDeadline: str(report.schedule, 'proposalDeadline'),
      bidOpenDate: str(report.schedule, 'bidOpenDate'),
      noticeDate: null,
    }),
    ...checkBudget({
      totalAmount: num(report.budget, 'totalAmount'),
      vatIncluded: bool(report.budget, 'vatIncluded'),
      mentions: mentionsOf(report.budget),
    }),
  ]

  if (g2b) {
    findings.push(...compareWithG2b(g2b, {
      title: str(report.overview, 'title'),
      agency: str(report.overview, 'agency'),
      budgetAmount: num(report.budget, 'totalAmount'),
      proposalDeadline: str(report.schedule, 'proposalDeadline'),
    }))
  }
  return findings
}

function mentionsOf(budget: Record<string, ValueNode<unknown>>): number[] {
  const v = budget.mentions?.value
  if (!Array.isArray(v)) return []
  return v
    .map((m) => (typeof m === 'number' ? m : (m as { amount?: unknown })?.amount))
    .filter((n): n is number => typeof n === 'number')
}
