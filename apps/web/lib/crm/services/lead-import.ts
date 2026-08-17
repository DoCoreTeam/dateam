/**
 * 리드 인테이크 → 영업 CRM 이관 (dacrm 정정판)
 *
 * **왜 필요했나**: 기존 "프로젝트관리"의 거래처·담당자·영업기회 14건은 이미 CRM 으로 옮겼는데,
 * **리드 인테이크 1,517건**만 갈 곳이 없어서 옛 메뉴를 못 치우고 있었다.
 * 두 시스템이 계속 나란히 있으면 사용자는 같은 거래처를 두 곳에서 보고
 * 어느 쪽이 정본인지 매번 헷갈린다.
 *
 * **한꺼번에 밀어 넣지 않는다.** 1,517건을 일괄로 옮기면 잘못됐을 때 되돌릴 방법이 없고,
 * 그중 상당수는 중복이거나 이미 죽은 리드다. 사람이 골라서 옮기고, 옮긴 것에 자국을 남긴다
 * (`lead_intakes.crm_migrated_at`). 자국이 있으면 "얼마나 남았나"를 화면이 말할 수 있다.
 *
 * 이관은 **되돌릴 수 있다** — 자국과 연결만 지우면 리드는 그대로 남는다.
 * CRM 쪽에 만들어진 회사·인물·딜은 CRM 의 휴지통 규칙을 따른다.
 */

import { withCrmTx } from '../db/tx.ts'
import { writeAudit } from '../db/audit.ts'
import { normalizeDomain, normalizeEmail, normalizePhone, normalizeText } from '../domain/normalize.ts'
import { CrmError } from '../domain/errors.ts'

/** 리드가 담고 있는 것 — 실데이터에서 확인한 모양 그대로 */
export interface ParsedLead {
  company_name?: string | null
  contact_name?: string | null
  contact_email?: string | null
  contact_phone?: string | null
  contact_title?: string | null
  region?: string | null
  segment?: string | null
  deal_description?: string | null
  deal_value_billion?: number | null
  product_recommendation?: string | null
  gpu_demand_intensity?: string | null
  fit_score?: number | null
}

export interface ImportPlan {
  /** 옮길 수 있나 — 회사 이름이 없으면 못 옮긴다 */
  ok: boolean
  /** 왜 못 옮기는지 — 사람이 읽고 고칠 수 있게 */
  reason?: string
  companyName?: string
  personName?: string | null
  dealName?: string | null
  /** 억 원 → minor(원). 금액은 BigInt 문자열로 다룬다 */
  amountMinor?: string | null
}

/**
 * 옮기기 전에 무엇이 만들어질지 먼저 보여 준다.
 *
 * 미리보기 없이 1,517건을 옮기면 사용자는 무엇이 생길지 모른 채 버튼을 눌러야 한다.
 * 그건 이관이 아니라 도박이다.
 */
export function planImport(parsed: ParsedLead | null): ImportPlan {
  const companyName = normalizeText(parsed?.company_name)
  if (!companyName) {
    return { ok: false, reason: '회사 이름이 없어 옮길 수 없습니다. 리드를 먼저 채워 주세요.' }
  }

  const personName = normalizeText(parsed?.contact_name)
  const desc = normalizeText(parsed?.deal_description)
  const product = normalizeText(parsed?.product_recommendation)

  // 억 원 단위로 들어온다(실데이터 `deal_value_billion`). KRW 는 minor 가 곧 원이다.
  const billion = typeof parsed?.deal_value_billion === 'number' ? parsed.deal_value_billion : null
  const amountMinor = billion && billion > 0
    ? String(Math.round(billion * 100_000_000))
    : null

  return {
    ok: true,
    companyName,
    personName,
    // 딜 이름은 "무엇을 파는가"가 드러나야 목록에서 구분된다
    dealName: product ? `${companyName} · ${product}` : desc ? `${companyName} 도입 검토` : null,
    amountMinor,
  }
}

export interface ImportResult {
  companyId: string
  personId: string | null
  dealId: string | null
  /** 새로 만든 게 아니라 이미 있던 것에 붙었나 — 화면이 "이미 있어서 연결했어요"라고 말한다 */
  reusedCompany: boolean
}

/**
 * 리드 하나를 CRM 으로 옮긴다.
 *
 * 중복은 **만들지 않고 붙인다.** 같은 회사가 이미 있으면 그것을 쓴다 —
 * 이관하다가 회사가 두 배가 되면 그 다음에 병합하느라 더 큰 일이 된다.
 */
export async function importLead(
  workspaceId: string,
  actorId: string | null,
  leadId: string,
  parsed: ParsedLead,
  opts: { pipelineId?: string; stageId?: string } = {},
): Promise<ImportResult> {
  const plan = planImport(parsed)
  if (!plan.ok) throw new CrmError('VALIDATION_FAILED', plan.reason ?? '옮길 수 없는 리드입니다.')

  const email = normalizeEmail(parsed.contact_email)
  const phone = normalizePhone(parsed.contact_phone)
  // 리드에는 도메인 칸이 없다 — 메일 주소에서 읽어낸다(개인 메일이면 회사 도메인이 아니라 안 쓴다)
  const domain = email && !/(gmail|naver|daum|hanmail|kakao|outlook|hotmail|yahoo)\./i.test(email)
    ? normalizeDomain(email.split('@')[1])
    : null

  return withCrmTx(workspaceId, async (tx) => {
    // ── 회사: 도메인 → 이름 순으로 찾고, 없으면 만든다 ──
    let companyId: string | null = null
    let reusedCompany = false

    if (domain) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hit = await (tx as any).crmCompany.findFirst({ where: { domain }, select: { id: true } })
      if (hit) { companyId = hit.id; reusedCompany = true }
    }
    if (!companyId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hit = await (tx as any).crmCompany.findFirst({
        where: { name: plan.companyName }, select: { id: true },
      })
      if (hit) { companyId = hit.id; reusedCompany = true }
    }
    if (!companyId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const created = await (tx as any).crmCompany.create({
        data: {
          name: plan.companyName!,
          domain,
          region: normalizeText(parsed.region),
          // 세그먼트는 CRM 에 칸이 없다 — 버리지 않고 설명에 남긴다
          descriptionMd: normalizeText(parsed.segment) ? `세그먼트: ${parsed.segment}` : null,
        },
        select: { id: true },
      })
      companyId = created.id
    }

    // ── 인물 ──
    let personId: string | null = null
    if (email) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hit = await (tx as any).crmPerson.findFirst({ where: { email }, select: { id: true } })
      if (hit) personId = hit.id
    }
    if (!personId && plan.personName) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const created = await (tx as any).crmPerson.create({
        data: {
          name: plan.personName, email, phone,
          title: normalizeText(parsed.contact_title),
          companyId,
        },
        select: { id: true },
      })
      personId = created.id
    }

    // ── 딜: 파이프라인이 지정됐을 때만 ──
    let dealId: string | null = null
    if (opts.pipelineId && opts.stageId && plan.dealName) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const created = await (tx as any).crmDeal.create({
        data: {
          name: plan.dealName,
          companyId,
          pipelineId: opts.pipelineId,
          stageId: opts.stageId,
          amountMinor: plan.amountMinor ? BigInt(plan.amountMinor) : null,
          currency: 'KRW',
          status: 'OPEN',
        },
        select: { id: true },
      })
      dealId = created.id

      // 첫 진입도 이동이다 — 이 기록이 없으면 "언제 이 단계에 들어왔나"를 알 수 없다
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (tx as any).crmStageHistory.create({
        data: { dealId, fromStageId: null, toStageId: opts.stageId, movedById: actorId, movedAt: new Date() },
      })

      if (personId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (tx as any).crmDealContact.create({
          data: { dealId, personId, role: 'OTHER' },
        })
      }
    }

    /**
     * 리드 원문을 활동으로 남긴다.
     *
     * 이관은 요약이다 — 요약만 남기면 "왜 이 회사를 넣었지"의 근거가 사라진다.
     * 원문이 남아 있어야 나중에 다시 읽고 판단할 수 있다.
     */
    const note = [
      parsed.deal_description,
      parsed.product_recommendation ? `제안: ${parsed.product_recommendation}` : null,
      parsed.gpu_demand_intensity ? `수요 강도: ${parsed.gpu_demand_intensity}` : null,
      parsed.fit_score !== null && parsed.fit_score !== undefined ? `적합도: ${parsed.fit_score}` : null,
    ].filter(Boolean).join('\n')

    if (note) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (tx as any).crmActivity.create({
        data: {
          type: 'NOTE', occurredAt: new Date(),
          title: '리드에서 옮김',
          body: note,
          companyId, personId, dealId,
          source: 'IMPORT', createdById: actorId,
        },
      })
    }

    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'lead.imported',
      targetType: 'company', targetId: companyId!,
      afterJson: { leadId, personId, dealId, reusedCompany },
    })

    return { companyId: companyId!, personId, dealId, reusedCompany }
  })
}

/** 옮긴 자국을 리드에 남긴다 — 남은 개수를 세려면 이 자국이 있어야 한다 */
export async function markLeadMigrated(
  leadId: string,
  result: ImportResult,
): Promise<void> {
  const { createAdminClient } = await import('../../supabase/server.ts')
  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any).from('lead_intakes').update({
    crm_company_id: result.companyId,
    crm_person_id: result.personId,
    crm_deal_id: result.dealId,
    crm_migrated_at: new Date().toISOString(),
  }).eq('id', leadId)

  // 자국을 못 남기면 같은 리드를 또 옮기게 된다 — 삼키지 않는다
  if (error) throw new CrmError('CONFLICT', `이관 표시를 남기지 못했습니다: ${error.message}`)
}

/**
 * 큐에 몇 건 남았는지 — 이관의 진척이다.
 *
 * **큐의 정의는 하나다**: 아직 안 옮겼고(`crm_migrated_at IS NULL`)
 * 아직 안 내린 것(`crm_skipped_at IS NULL`). 화면·API·인덱스가 같은 정의를 쓴다.
 * 정의가 갈리면 "N건 남음"과 실제 목록 길이가 서로를 반박한다.
 */
export async function countPendingLeads(): Promise<{
  pending: number; migrated: number; skipped: number
}> {
  const { createAdminClient } = await import('../../supabase/server.ts')
  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const a = admin as any
  const [{ count: pending }, { count: migrated }, { count: skipped }] = await Promise.all([
    a.from('lead_intakes').select('id', { count: 'exact', head: true })
      .is('crm_migrated_at', null).is('crm_skipped_at', null),
    a.from('lead_intakes').select('id', { count: 'exact', head: true })
      .not('crm_migrated_at', 'is', null),
    a.from('lead_intakes').select('id', { count: 'exact', head: true })
      .is('crm_migrated_at', null).not('crm_skipped_at', 'is', null),
  ])
  return { pending: pending ?? 0, migrated: migrated ?? 0, skipped: skipped ?? 0 }
}

// ── 큐에서 내리기 ─────────────────────────────────────────────────────────

/**
 * 옮길 값어치가 없는 리드를 큐에서 내린다.
 *
 * **왜 필요한가**: 예전에는 큐에서 나가는 길이 "CRM 으로 옮기기" 하나뿐이었다.
 * 그래서 회사 이름조차 없는 리드가 영원히 남았고, 큐는 **끝낼 수 없는 큐**였다.
 * 끝낼 수 없는 목록은 사람이 곧 안 본다.
 *
 * **삭제가 아니다.** 원문은 그대로 있고 자국만 남는다 — 되돌리면 큐로 돌아온다.
 */
export async function skipLeads(
  leadIds: readonly string[],
  reason: string,
): Promise<{ skipped: number }> {
  const ids = Array.from(new Set(leadIds.map((s) => s.trim()).filter(Boolean)))
  if (ids.length === 0) {
    throw new CrmError('VALIDATION_FAILED', '내릴 리드를 골라 주세요.', { field: 'leadIds' })
  }
  const { createAdminClient } = await import('../../supabase/server.ts')
  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any).from('lead_intakes').update({
    crm_skipped_at: new Date().toISOString(),
    crm_skip_reason: normalizeText(reason) ?? '사용자가 큐에서 내림',
  }).in('id', ids).is('crm_migrated_at', null).select('id')

  if (error) throw new CrmError('CONFLICT', `큐에서 내리지 못했습니다: ${error.message}`)
  return { skipped: (data ?? []).length }
}

/** 되돌리기 — 자국만 지운다. 리드는 큐로 돌아온다 */
export async function unskipLeads(leadIds: readonly string[]): Promise<{ restored: number }> {
  const ids = Array.from(new Set(leadIds.map((s) => s.trim()).filter(Boolean)))
  if (ids.length === 0) {
    throw new CrmError('VALIDATION_FAILED', '되돌릴 리드를 골라 주세요.', { field: 'leadIds' })
  }
  const { createAdminClient } = await import('../../supabase/server.ts')
  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any).from('lead_intakes')
    .update({ crm_skipped_at: null, crm_skip_reason: null })
    .in('id', ids).select('id')
  if (error) throw new CrmError('CONFLICT', `되돌리지 못했습니다: ${error.message}`)
  return { restored: (data ?? []).length }
}

// ── 일괄 이관 ─────────────────────────────────────────────────────────────

export interface BulkPreviewRow {
  leadId: string
  ok: boolean
  reason?: string
  companyName?: string
  personName?: string | null
  amountMinor?: string | null
  /** 이 회사가 CRM 에 이미 있나 — 새로 생기는 게 아니라 붙는다 */
  companyExists?: boolean
  /** 고른 목록 안에서 같은 회사가 또 있나 (첫 건에만 false) */
  duplicateInBatch?: boolean
}

export interface BulkPreview {
  total: number
  /** 옮길 수 있는 건수 */
  importable: number
  /** 못 옮기는 건수 — 이유별로 묶어서 보여 준다 */
  blocked: number
  blockedReasons: { reason: string; count: number }[]
  /** 새로 생길 회사 수 (같은 회사 여러 건은 1로 센다) */
  newCompanies: number
  /** 이미 있어서 붙을 회사 수 */
  existingCompanies: number
  newPersons: number
  /** 딜을 함께 만들 때 생길 딜 수와 합계 금액(원) */
  deals: number
  totalAmountMinor: string
  rows: BulkPreviewRow[]
}

/**
 * 옮기기 **전에** 무엇이 생길지 통째로 보여 준다.
 *
 * **왜 통계까지 내나**: 380건을 한 줄씩 읽게 하면 그건 미리보기가 아니다.
 * 사람이 버튼을 누르기 전에 알아야 하는 건 세 가지뿐이다 —
 * 회사가 몇 개 새로 생기나, 몇 건이 못 넘어가나, 왜 못 넘어가나.
 */
export async function previewBulkImport(
  workspaceId: string,
  leads: readonly { id: string; parsed: ParsedLead | null }[],
): Promise<BulkPreview> {
  const rows: BulkPreviewRow[] = []
  const blockedMap = new Map<string, number>()

  // 회사 존재 여부를 한 번에 조회한다 — 리드마다 물으면 380번 왕복한다
  const names = new Set<string>()
  for (const l of leads) {
    const n = normalizeText(l.parsed?.company_name)
    if (n) names.add(n)
  }
  const { getCrmDb } = await import('../db/client.ts')
  const db = getCrmDb(workspaceId)
  const existing = names.size
    ? await db.crmCompany.findMany({
      where: { name: { in: Array.from(names) } }, select: { name: true },
    })
    : []
  const existingNames = new Set(existing.map((c: { name: string }) => c.name))

  const seenInBatch = new Set<string>()
  let importable = 0
  let newPersons = 0
  let deals = 0
  let totalAmount = BigInt(0)

  for (const l of leads) {
    const plan = planImport(l.parsed ?? null)
    if (!plan.ok) {
      const reason = plan.reason ?? '옮길 수 없습니다.'
      blockedMap.set(reason, (blockedMap.get(reason) ?? 0) + 1)
      rows.push({ leadId: l.id, ok: false, reason })
      continue
    }
    importable += 1
    const name = plan.companyName!
    const dup = seenInBatch.has(name)
    seenInBatch.add(name)
    if (plan.personName) newPersons += 1
    if (plan.dealName) {
      deals += 1
      if (plan.amountMinor) totalAmount += BigInt(plan.amountMinor)
    }
    rows.push({
      leadId: l.id, ok: true,
      companyName: name,
      personName: plan.personName ?? null,
      amountMinor: plan.amountMinor ?? null,
      companyExists: existingNames.has(name),
      duplicateInBatch: dup,
    })
  }

  // 같은 회사가 목록에 여러 번 있어도 회사는 하나만 생긴다
  let newCompanies = 0
  let existingCompanies = 0
  Array.from(seenInBatch).forEach((n) => {
    if (existingNames.has(n)) existingCompanies += 1
    else newCompanies += 1
  })

  return {
    total: leads.length,
    importable,
    blocked: leads.length - importable,
    blockedReasons: Array.from(blockedMap.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
    newCompanies,
    existingCompanies,
    newPersons,
    deals,
    totalAmountMinor: String(totalAmount),
    rows,
  }
}

export interface BulkImportResult {
  requested: number
  imported: number
  failed: { leadId: string; message: string }[]
  companiesCreated: number
  companiesReused: number
  personsCreated: number
  dealsCreated: number
}

/**
 * 고른 리드를 한 번에 옮긴다.
 *
 * **한 건이 실패해도 나머지는 옮긴다.** 리드마다 트랜잭션이 따로다 —
 * 380건을 한 트랜잭션에 묶으면 380번째에서 터졌을 때 379건이 통째로 사라진다.
 * 실패한 건은 이유와 함께 돌려주고 큐에 그대로 남긴다(다시 시도할 수 있다).
 *
 * **상한을 둔다.** 한 번에 무제한으로 돌리면 요청이 시간 초과로 끊기고,
 * 그때 무엇이 들어갔는지 아무도 모른다. 화면이 나눠서 여러 번 부른다.
 */
export const BULK_IMPORT_MAX = 100

export async function importLeadsBulk(
  workspaceId: string,
  actorId: string | null,
  leads: readonly { id: string; parsed: ParsedLead | null }[],
  opts: { pipelineId?: string; stageId?: string } = {},
): Promise<BulkImportResult> {
  if (leads.length > BULK_IMPORT_MAX) {
    throw new CrmError('VALIDATION_FAILED',
      `한 번에 ${BULK_IMPORT_MAX}건까지 옮길 수 있어요. 나눠서 눌러 주세요.`)
  }

  const failed: { leadId: string; message: string }[] = []
  let imported = 0
  let companiesCreated = 0
  let companiesReused = 0
  let personsCreated = 0
  let dealsCreated = 0

  for (const lead of leads) {
    try {
      if (!lead.parsed) throw new CrmError('VALIDATION_FAILED', '읽어낸 내용이 없는 리드입니다.')
      const result = await importLead(workspaceId, actorId, lead.id, lead.parsed, opts)
      await markLeadMigrated(lead.id, result)
      imported += 1
      if (result.reusedCompany) companiesReused += 1
      else companiesCreated += 1
      if (result.personId) personsCreated += 1
      if (result.dealId) dealsCreated += 1
    } catch (e) {
      // 한 건의 실패가 나머지를 죽이지 않는다. 다만 조용히 넘어가지도 않는다.
      failed.push({
        leadId: lead.id,
        message: e instanceof Error ? e.message : String(e),
      })
    }
  }

  return {
    requested: leads.length,
    imported, failed,
    companiesCreated, companiesReused, personsCreated, dealsCreated,
  }
}

/** 되돌리기 — 자국과 연결만 지운다. 리드도 CRM 레코드도 그대로 남는다 */
export async function unmarkLeadMigrated(leadId: string): Promise<void> {
  const { createAdminClient } = await import('../../supabase/server.ts')
  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any).from('lead_intakes').update({
    crm_company_id: null, crm_person_id: null, crm_deal_id: null, crm_migrated_at: null,
  }).eq('id', leadId)
  if (error) throw new CrmError('CONFLICT', `되돌리지 못했습니다: ${error.message}`)
}
