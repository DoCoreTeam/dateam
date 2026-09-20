// POST /api/rfp/worker/tick — 워커 한 번 돌리기
//
// 화면이 부르는 자리가 아니다. 크론과 외부 스케줄러만 부른다.
// 판정은 `lib/crm/jobs/machine-auth` 한 곳이 한다 — 입구마다 각자 비교하면
// 한쪽만 잠그게 되고, 실제로 그 사고가 이 저장소에서 났다(크론 8시간 403).
//
// 크론이 GET 으로 부르므로 GET 도 연다. 열되 **같은 토큰 판정**을 쓴다.

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { createAdminClient } from '@/lib/supabase/server'
import { isMachineCall, machineAuthUnconfigured } from '@/lib/crm/jobs/machine-auth'
import { claimJobs, finishJob, failJob, reapStaleJobs, workerName, type Job } from '@/lib/rfp/jobs/queue'
import type { JobType } from '@/lib/rfp/jobs/stages'
import { runStage } from '@/lib/rfp/jobs/run-stage'
import { makeStageDeps } from '@/lib/rfp/jobs/deps'
import { runAnalyze } from '@/lib/rfp/analyze/run-analyze'
import { makeHostCaller } from '@/lib/rfp/ai/host-caller'
import { toModels, toPolicy } from '@/lib/rfp/ai/host-providers'
import { getAvailableProviders } from '@/lib/ai-chat/registry'
import { embedTexts } from '@/lib/gemini-embedding'
import type { GatewayStore } from '@/lib/rfp/ai/gateway'
import { recorded, notRecorded } from '@ax/ai-gateway'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** 한 번에 집어 오는 잡 수. 크게 잡으면 한 틱이 타임아웃을 넘긴다 */
const CLAIM_LIMIT = 3

export async function POST(req: NextRequest) { return tick(req) }
export async function GET(req: NextRequest) { return tick(req) }

async function tick(req: NextRequest) {
  if (machineAuthUnconfigured()) {
    // 토큰이 하나도 없으면 «무인증 통과» 가 아니라 «쓸 수 없음» 이다
    return NextResponse.json({ error: '워커 토큰이 설정되지 않았습니다' }, { status: 500 })
  }
  if (!isMachineCall(req)) {
    return NextResponse.json({ error: '워커 토큰이 필요합니다' }, { status: 401 })
  }

  const admin = createAdminClient()
  const db = admin as unknown as Parameters<typeof claimJobs>[0]
  const worker = workerName()

  // 죽은 워커가 잡고 있던 것부터 되살린다. 안 하면 그 잡은 영원히 running 이다
  let revived = 0
  try {
    revived = await reapStaleJobs(db)
  } catch {
    // 되살리기 실패가 이번 틱을 막을 이유는 없다
  }

  let jobs: Job[] = []
  try {
    jobs = await claimJobs(db, { limit: CLAIM_LIMIT, worker })
  } catch (e) {
    return NextResponse.json({ error: describe(e) }, { status: 500 })
  }

  const results: { id: string; jobType: JobType; ok: boolean; error?: string }[] = []
  for (const job of jobs) {
    try {
      const progress = await runJob(admin, job)
      await finishJob(db, job.id, progress)
      results.push({ id: job.id, jobType: job.jobType, ok: true })
    } catch (e) {
      const message = describe(e)
      await failJob(db, job.id, message)
      results.push({ id: job.id, jobType: job.jobType, ok: false, error: message })
    }
  }

  return NextResponse.json({ worker, revived, claimed: jobs.length, results })
}

/**
 * 관리자 설정의 AI 공급자 + RFP 의 등급 정책을 합쳐 모델 목록을 만든다.
 *
 * 키는 호스트가, 「이 모델에 NDA 를 보내도 되나」는 RFP 가 갖는다.
 */
async function loadAi(db: ReturnType<typeof createAdminClient>) {
  // 키는 org_content 의 **한 행(key='META')** 안에 통째로 들어 있다.
  // 행 여러 개로 읽으면 늘 빈 것이 나오고, 그러면 「쓸 모델이 없다」로만 보인다
  const { data: metaRow } = await (db as any)
    .from('org_content').select('value').eq('key', 'META').single()
  const meta = ((metaRow as { value?: unknown } | null)?.value ?? {}) as Record<string, unknown>

  const providers = getAvailableProviders(meta).map((p) => ({
    id: p.id, apiKey: p.apiKey, model: p.model,
  }))

  const { data: policyRows } = await (db as any)
    .from('rfp_ai_models')
    .select('vendor_id, allowed_doc_classes, is_internal, no_training, zero_retention, input_krw_per_mtok, output_krw_per_mtok, multimodal, sort_order, enabled')
  const policies = ((policyRows ?? []) as Record<string, unknown>[]).map(toPolicy)

  return { providers, models: toModels(providers, policies), meta }
}

/**
 * 기록 창구 — 호출과 전송을 남긴다. 남기지 않으면 비용도 유출도 못 센다.
 *
 * ⚠️ 칸 이름을 표에 맞춰 둔다. supabase-js 는 **없는 칸을 오류로 돌려줄 뿐 던지지 않아서**
 *    틀린 이름으로 넣으면 0건이 조용히 쌓인다(실측 2026-09-09: case_id·ok 로 넣어
 *    9번 호출에 기록 0건. 화면에는 비용 0원으로만 보였다).
 *    그래서 여기서는 오류를 **읽고 남긴다.**
 */
function makeStore(db: ReturnType<typeof createAdminClient>): GatewayStore {
  return {
    async recordCall(r) {
      const { error } = await (db as any).from('rfp_llm_calls').insert({
        org_id: r.orgId,
        model_id: uuidOrNull(r.modelId),
        purpose: r.purpose,
        input_tokens: r.inputTokens,
        output_tokens: r.outputTokens,
        cost_krw: r.costKrw,
        latency_ms: r.latencyMs,
        status: r.ok ? 'ok' : 'error',
        error: r.error,
      })
      // 기록 실패가 호출을 막지는 않는다. 다만 조용히 넘어가지도 않는다
      if (error) {
        console.error('[rfp] llm 호출 기록 실패', error)
        return notRecorded(`insert 실패: ${error.message ?? '알 수 없음'}`)
      }
      return recorded(`${r.orgId}:${r.purpose}`)
    },
    async recordTransfer(r) {
      const { error } = await (db as any).from('rfp_external_transfers').insert({
        org_id: r.orgId,
        case_id: r.caseId,
        model_id: uuidOrNull(r.modelId),
        doc_class: r.docClass,
        purpose: r.purpose,
        // 무엇을 몇 개 가렸는지만 센다 — **값은 남기지 않는다**
        token_count: Object.values(r.maskedCounts).reduce((n, v) => n + v, 0),
        redaction_applied: Object.keys(r.maskedCounts).length > 0,
      })
      if (error) {
        console.error('[rfp] 외부 전송 기록 실패', error)
        return notRecorded(`insert 실패: ${error.message ?? '알 수 없음'}`)
      }
      return recorded(`${r.orgId}:${r.purpose}`)
    },
  }
}

/**
 * 잡 하나를 돈다.
 *
 * 순서와 판정은 `lib/rfp/jobs/run-stage` 가 갖는다 — 여기 인라인으로 두면
 * 「다음 잡을 걸었나」를 확인할 방법이 실제 크론뿐이 된다.
 */
async function runJob(db: ReturnType<typeof createAdminClient>, job: Job): Promise<Record<string, unknown>> {
  const ai = await loadAi(db)
  const caller = makeHostCaller({ providers: ai.providers })
  const store = makeStore(db)

  // 임베딩은 있으면 쓰고 없으면 안 쓴다 — 없다고 색인 단계를 실패시키면
  // 검색이 조금 나빠질 일이 파이프라인 전체를 멈추는 일이 된다
  const geminiKey = ai.providers.find((p) => p.id === 'gemini')?.apiKey ?? null
  // 한 건씩이 아니라 묶어서 보낸다 — 조각 수만큼 요청이 나가면 분당 한도를 색인 하나가 다 쓴다
  const embed = geminiKey
    ? (texts: readonly string[]) => embedTexts(texts, geminiKey, null, {
        taskType: 'RETRIEVAL_DOCUMENT', feature: 'memo-embedding',
      })
    : null

  const deps = makeStageDeps({
    db: db as never,
    embed,
    async analyze(kase, docs) {
      const files = await (db as any).from('rfp_document_files')
        .select('id, role').eq('case_id', kase.id).is('deleted_at', null)
      const roleById = new Map(
        ((files.data ?? []) as { id: string; role: string }[]).map((f) => [String(f.id), String(f.role)]),
      )
      const out = await runAnalyze(db as never, {
        orgId: kase.orgId,
        caseId: kase.id,
        docClass: kase.docClass as 'public' | 'restricted' | 'nda',
        parts: docs.map((d) => ({ fileId: d.fileId, role: roleById.get(d.fileId), doc: d.doc })),
        models: ai.models,
        gateway: { store, call: caller },
      })
      return {
        version: out.version, title: out.title,
        failures: out.failures, filledFields: out.filledFields,
      }
    },
  })

  return runStage(deps, job) as Promise<Record<string, unknown>>
}


function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * 기록의 model_id 는 uuid 칸이다.
 *
 * 호스트 폴백 모델(표에 없는 것)은 id 가 'gemini' 같은 이름이라 그대로 넣으면
 * **insert 가 통째로 실패하고 supabase 는 던지지 않는다** — 기록이 조용히 0건이 된다.
 */
function uuidOrNull(v: string): string | null {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : null
}
