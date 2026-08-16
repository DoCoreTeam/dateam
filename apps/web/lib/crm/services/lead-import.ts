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

/** 아직 안 옮긴 리드가 몇 건인지 — 이관의 진척이다 */
export async function countPendingLeads(): Promise<{ pending: number; migrated: number }> {
  const { createAdminClient } = await import('../../supabase/server.ts')
  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const a = admin as any
  const [{ count: pending }, { count: migrated }] = await Promise.all([
    a.from('lead_intakes').select('id', { count: 'exact', head: true }).is('crm_migrated_at', null),
    a.from('lead_intakes').select('id', { count: 'exact', head: true }).not('crm_migrated_at', 'is', null),
  ])
  return { pending: pending ?? 0, migrated: migrated ?? 0 }
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
