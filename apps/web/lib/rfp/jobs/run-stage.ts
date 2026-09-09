/**
 * 단계 본체 — 워커가 실제로 하는 일 (설계서 3.5)
 *
 * ## 왜 라우트가 아니라 여기인가
 *
 * 라우트에 두면 검증 수단이 **실제 크론뿐**이다. 여기 두면 가짜 DB 와 가짜 파서로
 * 「다음 잡을 걸었나」「케이스 단계를 올렸나」를 실행해서 확인할 수 있다.
 *
 * ## 멱등이 규칙이다
 *
 * 워커는 죽고, 죽은 워커의 잡은 되살아나 **다시 돈다.** 그래서 각 단계는
 * 「만들기」가 아니라 「있으면 덮고 없으면 만들기」다 — 요구사항·청크는 케이스 단위로
 * 지우고 다시 넣고, IR 은 판 단위로 덮는다.
 *
 * ## 다음 잡은 여기서 건다
 *
 * 파이프라인을 크론이 이어 주면 «크론이 안 돌면 케이스가 중간에 멈춘다» 가 되고,
 * 그 멈춤은 아무 오류도 안 남긴다. 끝낸 단계가 다음을 거는 편이 안 멈춘다.
 */

import type { IrDocument } from '../ir/types.ts'
import type { Job } from './queue.ts'
import { nextJob, dedupeKey, JOB_PRIORITY, JOB_RESULT_STAGE, type JobType } from './stages.ts'

export interface CaseRow {
  id: string
  orgId: string
  docClass: string
  title: string
  titleConfirmed: boolean
}

export interface FileRow {
  id: string
  role: string
  originalName: string
  storagePath: string | null
}

/** 단계가 바깥과 닿는 지점 전부. 테스트가 여기를 통째로 가짜로 바꾼다 */
export interface StageDeps {
  loadCase(caseId: string): Promise<CaseRow | null>
  loadFiles(caseId: string): Promise<FileRow[]>
  /** 원문 → IR. 실패한 파일은 사유와 함께 돌려준다 */
  parseOne(file: FileRow): Promise<{ ok: true; doc: IrDocument } | { ok: false; reason: string }>
  /** IR 을 표와 보관함에 남긴다 */
  saveIr(file: FileRow, doc: IrDocument, version: number): Promise<void>
  /** 앞서 저장한 IR 들을 되읽는다 */
  loadIrDocs(caseId: string): Promise<{ fileId: string; doc: IrDocument }[]>
  saveRequirements(kase: CaseRow, docs: { fileId: string; doc: IrDocument }[]): Promise<number>
  saveChunks(kase: CaseRow, docs: { fileId: string; doc: IrDocument }[]): Promise<number>
  analyze(kase: CaseRow, docs: { fileId: string; doc: IrDocument }[]): Promise<{
    version: number
    title: string | null
    /** 값을 못 채운 태스크와 사유 — 빈 리포트가 왜 비었는지 */
    failures?: { taskId: string; error: string }[]
    filledFields?: number
  }>
  setStage(caseId: string, stage: string): Promise<void>
  setTitle(caseId: string, title: string): Promise<void>
  enqueue(input: { orgId: string; caseId: string; jobType: JobType; dedupeKey: string; priority: number; version: number }): Promise<void>
}

/** 잡 payload 의 판 번호. 없으면 1 — 첫 분석이다 */
export function versionOf(job: Job): number {
  const v = Number((job.payload as Record<string, unknown>)?.version ?? 1)
  return Number.isFinite(v) && v >= 1 ? Math.floor(v) : 1
}

export interface StageResult {
  [key: string]: unknown
}

/**
 * 잡 하나를 돈다.
 *
 * 모르는 종류를 **조용히 성공시키지 않는다** — 성공으로 두면 케이스가 다음 단계로
 * 넘어가고, 아무 일도 안 한 채 리포트가 비어 나온다.
 */
export async function runStage(deps: StageDeps, job: Job): Promise<StageResult> {
  if (!job.caseId) throw new Error('케이스 없는 잡은 돌릴 수 없다')

  const kase = await deps.loadCase(job.caseId)
  if (!kase) throw new Error('케이스를 찾지 못했다')

  const version = versionOf(job)
  let result: StageResult

  switch (job.jobType) {
    case 'parse': result = await runParse(deps, kase, version); break
    case 'structure': result = await runStructure(deps, kase); break
    case 'index': result = await runIndex(deps, kase); break
    case 'analyze': result = await runAnalyze(deps, kase); break
    default: throw new Error(`아직 붙지 않은 단계다: ${job.jobType}`)
  }

  await deps.setStage(kase.id, JOB_RESULT_STAGE[job.jobType])

  // 다음 단계를 여기서 건다. 같은 판이면 같은 키라 두 번 걸리지 않는다
  const next = nextJob(job.jobType)
  if (next) {
    await deps.enqueue({
      orgId: kase.orgId,
      caseId: kase.id,
      jobType: next,
      dedupeKey: dedupeKey(kase.id, next, version),
      priority: JOB_PRIORITY[next],
      version,
    })
  }

  return { ...result, nextJob: next }
}

/** 원문을 읽어 IR 로 만든다 */
async function runParse(deps: StageDeps, kase: CaseRow, version: number): Promise<StageResult> {
  const files = await deps.loadFiles(kase.id)
  if (files.length === 0) throw new Error('읽을 파일이 없다')

  // 바이트가 없는 행은 파싱이 영원히 실패한다. 시도하지 않고 사유로 적는다
  const missing = files.filter((f) => !f.storagePath)
  const readable = files.filter((f) => f.storagePath)

  const failed: { name: string; reason: string }[] = missing.map((f) => ({
    name: f.originalName, reason: 'no_bytes',
  }))
  let parsed = 0

  for (const file of readable) {
    const r = await deps.parseOne(file)
    if (!r.ok) {
      // 한 파일이 안 읽힌다고 케이스 전체를 죽이지 않는다 — 나머지로 분석할 수 있다
      failed.push({ name: file.originalName, reason: r.reason })
      continue
    }
    await deps.saveIr(file, r.doc, version)
    parsed += 1
  }

  // 한 건도 못 읽었으면 실패다. 성공으로 두면 빈 리포트가 「내용 없음」으로 나온다
  if (parsed === 0) {
    throw new Error(`읽을 수 있는 파일이 없다: ${failed.map((f) => `${f.name}(${f.reason})`).join(', ')}`)
  }

  return { parsed, failed }
}

/** IR 에서 요구사항을 뽑는다 */
async function runStructure(deps: StageDeps, kase: CaseRow): Promise<StageResult> {
  const docs = await deps.loadIrDocs(kase.id)
  if (docs.length === 0) throw new Error('파싱 결과가 없다')
  const requirements = await deps.saveRequirements(kase, docs)
  return { requirements }
}

/** 청크와 임베딩 */
async function runIndex(deps: StageDeps, kase: CaseRow): Promise<StageResult> {
  const docs = await deps.loadIrDocs(kase.id)
  if (docs.length === 0) throw new Error('파싱 결과가 없다')
  const chunks = await deps.saveChunks(kase, docs)
  return { chunks }
}

/** 리포트를 채운다 */
async function runAnalyze(deps: StageDeps, kase: CaseRow): Promise<StageResult> {
  const docs = await deps.loadIrDocs(kase.id)
  if (docs.length === 0) throw new Error('파싱 결과가 없다')

  const out = await deps.analyze(kase, docs)

  // 사업명은 공고문에서 나온다. 다만 **사람이 한 번 고친 이름은 덮지 않는다**
  if (out.title && !kase.titleConfirmed && out.title !== kase.title) {
    await deps.setTitle(kase.id, out.title)
  }

  return {
    reportVersion: out.version,
    titleUpdated: Boolean(out.title) && !kase.titleConfirmed,
    // 잡 진행에 남긴다 — 리포트가 비어 나온 이유를 나중에 찾을 수 있어야 한다
    filledFields: out.filledFields ?? null,
    failures: out.failures ?? [],
  }
}
