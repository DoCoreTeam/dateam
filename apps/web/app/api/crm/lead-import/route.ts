// GET  /api/crm/lead-import — 아직 안 옮긴 리드 목록 + 남은 개수
// POST /api/crm/lead-import — 고른 리드를 CRM 으로 옮긴다
// DELETE /api/crm/lead-import?leadId=… — 이관 표시를 되돌린다
//
// 1,517건을 한 번에 밀지 않는다. 사람이 보고 고른 것만 옮기고, 옮긴 것에 자국을 남긴다.
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { createAdminClient } from '@/lib/supabase/server'
import { getCrmDb } from '@/lib/crm/db/client'
import {
  importLead, markLeadMigrated, unmarkLeadMigrated, countPendingLeads, planImport,
} from '@/lib/crm/services/lead-import'
import type { ParsedLead } from '@/lib/crm/services/lead-import'
import { CrmError } from '@/lib/crm/domain/errors'

const PAGE = 20

export async function GET(req: NextRequest) {
  return withCrmApi('READONLY', async () => {
    const admin = createAdminClient()
    const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') ?? PAGE) || PAGE, 100)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (admin as any)
      .from('lead_intakes')
      .select('id, created_at, status, parsed_data, original_file_name')
      .is('crm_migrated_at', null)
      // 적합도가 높은 것부터 — 1,517건을 위에서부터 훑을 때 쓸모 있는 것이 먼저 나와야 한다
      .order('created_at', { ascending: false })
      .limit(limit)

    const rows = (data ?? []) as {
      id: string; created_at: string; status: string; parsed_data: ParsedLead | null
    }[]

    const counts = await countPendingLeads()

    return {
      items: rows.map((r) => ({
        id: r.id,
        createdAt: r.created_at,
        status: r.status,
        plan: planImport(r.parsed_data),
        parsed: r.parsed_data,
      })),
      ...counts,
    }
  })
}

export async function POST(req: NextRequest) {
  return withCrmApi('MEMBER', async ({ session }) => {
    const body = await readJson(req)
    const leadId = typeof body.leadId === 'string' ? body.leadId.trim() : ''
    if (!leadId) throw new CrmError('VALIDATION_FAILED', '옮길 리드를 골라 주세요.', { field: 'leadId' })

    const admin = createAdminClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (admin as any)
      .from('lead_intakes').select('id, parsed_data, crm_migrated_at').eq('id', leadId).maybeSingle()
    const lead = data as { id: string; parsed_data: ParsedLead | null; crm_migrated_at: string | null } | null

    if (!lead) throw new CrmError('NOT_FOUND', '리드를 찾을 수 없습니다.')
    if (lead.crm_migrated_at) throw new CrmError('CONFLICT', '이미 옮긴 리드입니다.')
    if (!lead.parsed_data) throw new CrmError('VALIDATION_FAILED', '읽어낸 내용이 없는 리드입니다.')

    /**
     * 딜까지 만들지는 **사람이 정한다.**
     * 리드 1,517건이 전부 딜이 되면 파이프라인이 쓰레기로 찬다 —
     * 회사·담당자만 남기고 딜은 실제로 이야기가 시작된 것만 만든다.
     */
    let pipelineId: string | undefined
    let stageId: string | undefined
    if (body.createDeal === true) {
      const db = getCrmDb(session.workspaceId)
      const pipeline = await db.crmPipeline.findFirst({
        where: { isDefault: true }, select: { id: true },
      })
      const stage = await db.crmStage.findFirst({
        where: { pipelineId: pipeline?.id, kind: 'OPEN' },
        orderBy: { position: 'asc' }, select: { id: true },
      })
      if (!pipeline || !stage) {
        throw new CrmError('VALIDATION_FAILED', '기본 파이프라인이 없어 딜을 만들 수 없습니다.')
      }
      pipelineId = pipeline.id
      stageId = stage.id
    }

    const result = await importLead(
      session.workspaceId, session.memberId, leadId, lead.parsed_data, { pipelineId, stageId },
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
