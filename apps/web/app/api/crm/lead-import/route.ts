// GET    /api/crm/lead-import — 큐 목록 + 남은 개수 (+ preview=1 이면 일괄 미리보기)
// POST   /api/crm/lead-import — 옮기기(단건·일괄) / 큐에서 내리기 / 되돌리기
// DELETE /api/crm/lead-import?leadId=… — 이관 표시를 되돌린다
//
// **v0.7.540 에서 바뀐 것**: 예전 큐는 사람이 끝낼 수 없었다.
//   ① 목록이 20건에서 끊기고 그 다음을 볼 방법이 없었다(offset 없음)
//   ② 큐에서 나가는 길이 "한 건씩 옮기기" 하나뿐이었다
//   ③ 정렬 주석은 "적합도 순"인데 코드는 created_at 이었다
//   380건짜리 큐에서 이 셋이 겹치면 그 화면은 아무도 끝내지 못한다.
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { createAdminClient } from '@/lib/supabase/server'
import { getCrmDb } from '@/lib/crm/db/client'
import {
  importLead, importLeadsBulk, markLeadMigrated, unmarkLeadMigrated,
  countPendingLeads, planImport, previewBulkImport, skipLeads, unskipLeads,
  BULK_IMPORT_MAX,
} from '@/lib/crm/services/lead-import'
import type { ParsedLead } from '@/lib/crm/services/lead-import'
import { CrmError } from '@/lib/crm/domain/errors'

const PAGE = 20
const MAX_PAGE = 100
/** 미리보기는 목록보다 크게 잡는다 — "전체 미리보기"가 실제로 전체여야 뜻이 있다 */
const PREVIEW_MAX = 500

type LeadRow = {
  id: string
  created_at: string
  status: string
  fit_score: number | null
  parsed_data: ParsedLead | null
  crm_skipped_at: string | null
  crm_skip_reason: string | null
}

const SELECT_COLS =
  'id, created_at, status, fit_score, parsed_data, original_file_name, crm_skipped_at, crm_skip_reason'

/** 목록의 어느 칸을 보고 있나. 큐가 기본이고, 내린 것·옮긴 것도 볼 수 있어야 되돌릴 수 있다 */
type View = 'queue' | 'skipped' | 'migrated'

function viewOf(raw: string | null): View {
  return raw === 'skipped' || raw === 'migrated' ? raw : 'queue'
}

/**
 * 목록 조건 — **큐의 정의는 여기 한 곳에만 있다.**
 * 화면과 카운트가 다른 정의를 쓰면 "N건 남음"과 목록 길이가 서로를 반박한다.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyView(q: any, view: View) {
  if (view === 'migrated') return q.not('crm_migrated_at', 'is', null)
  if (view === 'skipped') return q.is('crm_migrated_at', null).not('crm_skipped_at', 'is', null)
  return q.is('crm_migrated_at', null).is('crm_skipped_at', null)
}

export async function GET(req: NextRequest) {
  return withCrmApi('READONLY', async ({ session }) => {
    const admin = createAdminClient()
    const sp = req.nextUrl.searchParams
    const view = viewOf(sp.get('view'))
    const q = sp.get('q')?.trim() ?? ''
    // 정렬: 적합도 순이 기본이다(주석과 코드를 일치시켰다). 최신순도 고를 수 있다.
    const sort = sp.get('sort') === 'recent' ? 'recent' : 'fit'

    // ── 일괄 미리보기 ────────────────────────────────────────────────────
    if (sp.get('preview') === '1') {
      const idsParam = sp.get('leadIds')?.trim()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let pq = (admin as any).from('lead_intakes').select('id, parsed_data')
      if (idsParam) {
        const ids = idsParam.split(',').map((s) => s.trim()).filter(Boolean).slice(0, PREVIEW_MAX)
        if (ids.length === 0) throw new CrmError('VALIDATION_FAILED', '미리 볼 리드를 골라 주세요.')
        pq = pq.in('id', ids)
      } else {
        // 고른 게 없으면 "큐 전체"를 미리 본다 — 사용자가 가장 먼저 알고 싶은 숫자다
        pq = applyView(pq, view).limit(PREVIEW_MAX)
      }
      const { data, error } = await pq
      if (error) throw new CrmError('CONFLICT', `미리보기를 만들지 못했습니다: ${error.message}`)
      const leads = ((data ?? []) as { id: string; parsed_data: ParsedLead | null }[])
        .map((r) => ({ id: r.id, parsed: r.parsed_data }))
      const preview = await previewBulkImport(session.workspaceId, leads)
      return { preview, truncated: leads.length >= PREVIEW_MAX }
    }

    // ── 목록 ─────────────────────────────────────────────────────────────
    const limit = Math.min(Number(sp.get('limit') ?? PAGE) || PAGE, MAX_PAGE)
    const offset = Math.max(Number(sp.get('offset') ?? 0) || 0, 0)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (admin as any).from('lead_intakes').select(SELECT_COLS, { count: 'exact' })
    query = applyView(query, view)
    if (q) {
      // 380건에서 눈으로 찾지 않는다. 회사명·담당자명으로 좁힌다.
      const safe = q.replace(/[%,]/g, ' ')
      query = query.or(
        `parsed_data->>company_name.ilike.%${safe}%,parsed_data->>contact_name.ilike.%${safe}%`,
      )
    }
    query = sort === 'fit'
      ? query.order('fit_score', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false })
      : query.order('created_at', { ascending: false })

    const { data, count, error } = await query.range(offset, offset + limit - 1)
    if (error) throw new CrmError('CONFLICT', `목록을 불러오지 못했습니다: ${error.message}`)

    const rows = (data ?? []) as LeadRow[]
    const counts = await countPendingLeads()

    return {
      items: rows.map((r) => ({
        id: r.id,
        createdAt: r.created_at,
        status: r.status,
        fitScore: r.fit_score,
        skippedAt: r.crm_skipped_at,
        skipReason: r.crm_skip_reason,
        plan: planImport(r.parsed_data),
        parsed: r.parsed_data,
      })),
      view,
      total: count ?? rows.length,
      offset,
      limit,
      hasMore: offset + rows.length < (count ?? 0),
      bulkMax: BULK_IMPORT_MAX,
      ...counts,
    }
  })
}

/** 딜을 만들 파이프라인·첫 단계를 찾는다 — 없으면 딜 없이 회사·인물만 옮긴다 */
async function resolveDealTarget(workspaceId: string) {
  const db = getCrmDb(workspaceId)
  const pipeline = await db.crmPipeline.findFirst({ where: { isDefault: true }, select: { id: true } })
  const stage = await db.crmStage.findFirst({
    where: { pipelineId: pipeline?.id, kind: 'OPEN' },
    orderBy: { position: 'asc' }, select: { id: true },
  })
  if (!pipeline || !stage) {
    throw new CrmError('VALIDATION_FAILED', '기본 파이프라인이 없어 딜을 만들 수 없습니다.')
  }
  return { pipelineId: pipeline.id, stageId: stage.id }
}

export async function POST(req: NextRequest) {
  return withCrmApi('MEMBER', async ({ session }) => {
    const body = await readJson(req)
    const action = typeof body.action === 'string' ? body.action : 'import'

    // ── 큐에서 내리기 / 되돌리기 ────────────────────────────────────────
    if (action === 'skip' || action === 'unskip') {
      const ids = Array.isArray(body.leadIds)
        ? body.leadIds.filter((x: unknown): x is string => typeof x === 'string')
        : []
      if (action === 'unskip') return unskipLeads(ids)
      const reason = typeof body.reason === 'string' ? body.reason : ''
      return skipLeads(ids, reason)
    }

    if (action !== 'import') {
      throw new CrmError('VALIDATION_FAILED', '알 수 없는 요청입니다.', { field: 'action' })
    }

    /**
     * 딜까지 만들지는 **사람이 정한다.**
     * 380건이 전부 딜이 되면 파이프라인이 쓰레기로 찬다 —
     * 회사·담당자만 남기고 딜은 실제로 이야기가 시작된 것만 만든다.
     */
    let dealTarget: { pipelineId: string; stageId: string } | Record<string, never> = {}
    if (body.createDeal === true) dealTarget = await resolveDealTarget(session.workspaceId)

    const admin = createAdminClient()

    // ── 일괄 ────────────────────────────────────────────────────────────
    if (Array.isArray(body.leadIds)) {
      const ids = Array.from(new Set(
        body.leadIds.filter((x: unknown): x is string => typeof x === 'string')
          .map((s: string) => s.trim()).filter(Boolean),
      ))
      if (ids.length === 0) {
        throw new CrmError('VALIDATION_FAILED', '옮길 리드를 골라 주세요.', { field: 'leadIds' })
      }
      if (ids.length > BULK_IMPORT_MAX) {
        throw new CrmError('VALIDATION_FAILED',
          `한 번에 ${BULK_IMPORT_MAX}건까지 옮길 수 있어요. 나눠서 눌러 주세요.`, { field: 'leadIds' })
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (admin as any).from('lead_intakes')
        .select('id, parsed_data, crm_migrated_at').in('id', ids)
      const rows = (data ?? []) as { id: string; parsed_data: ParsedLead | null; crm_migrated_at: string | null }[]
      // 이미 옮긴 것은 조용히 건너뛴다 — 두 번 누른 것이 오류로 보이면 안 된다
      const todo = rows.filter((r) => !r.crm_migrated_at).map((r) => ({ id: r.id, parsed: r.parsed_data }))
      const result = await importLeadsBulk(session.workspaceId, session.memberId, todo, dealTarget)
      return { ...result, alreadyMigrated: rows.length - todo.length }
    }

    // ── 단건 (기존 호출부 호환) ─────────────────────────────────────────
    const leadId = typeof body.leadId === 'string' ? body.leadId.trim() : ''
    if (!leadId) throw new CrmError('VALIDATION_FAILED', '옮길 리드를 골라 주세요.', { field: 'leadId' })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (admin as any)
      .from('lead_intakes').select('id, parsed_data, crm_migrated_at').eq('id', leadId).maybeSingle()
    const lead = data as { id: string; parsed_data: ParsedLead | null; crm_migrated_at: string | null } | null

    if (!lead) throw new CrmError('NOT_FOUND', '리드를 찾을 수 없습니다.')
    if (lead.crm_migrated_at) throw new CrmError('CONFLICT', '이미 옮긴 리드입니다.')
    if (!lead.parsed_data) throw new CrmError('VALIDATION_FAILED', '읽어낸 내용이 없는 리드입니다.')

    const result = await importLead(
      session.workspaceId, session.memberId, leadId, lead.parsed_data, dealTarget,
    )
    await markLeadMigrated(leadId, result)
    return result
  })
}

export async function DELETE(req: NextRequest) {
  return withCrmApi('MEMBER', async () => {
    const leadId = req.nextUrl.searchParams.get('leadId')?.trim()
    if (!leadId) throw new CrmError('VALIDATION_FAILED', '되돌릴 리드를 골라 주세요.', { field: 'leadId' })
    await unmarkLeadMigrated(leadId)
    return { ok: true }
  })
}
