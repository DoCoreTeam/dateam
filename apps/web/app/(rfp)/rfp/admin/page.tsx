// /rfp/admin — 관리자 설정
//
// **admin 이 아니면 여기서 막힌다.** 레이아웃은 임직원 전체를 들여보내므로
// 이 화면이 스스로 한 번 더 본다 — 메뉴에서 안 보이는 것과 못 여는 것은 다르다.

import G2bServices from './G2bServices'
import { G2B_KEY_FIELD } from '@/lib/rfp/g2b/client'
import NotificationSettings from './NotificationSettings'
import PageHeader from '@/components/ui/PageHeader'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { RFP_ADMIN, RFP_LIST } from '@/lib/rfp/terms'
import VendorSettings, { type VendorRow } from '@/components/rfp/VendorSettings'
import RuleSettings from '@/components/rfp/RuleSettings'
import TransferLog, { type TransferRow } from '@/components/rfp/TransferLog'
import UsageDashboard from '@/components/rfp/UsageDashboard'
import { RULE_COLS, toRule, type AnomalyRule } from '@/lib/rfp/anomaly/rules'
import { toPolicy, toModels } from '@/lib/rfp/ai/host-providers'
import { getAvailableProviders } from '@/lib/ai-chat/registry'
import { createAdminClient } from '@/lib/supabase/server'
import styles from '../../rfp.module.css'
import { toPlan, summarize, currentPeriod, type UsageRow } from '@/lib/rfp/tenant/usage'

export const dynamic = 'force-dynamic'

/** 호스트가 키를 두는 자리 — RFP 는 읽기만 한다 */
async function readHostMeta(): Promise<Record<string, unknown>> {
  const admin = createAdminClient() as never as {
    from(t: string): { select(c: string): { eq(k: string, v: string): { single(): Promise<{ data: unknown }> } } }
  }
  const { data } = await admin.from('org_content').select('value').eq('key', 'META').single()
  return ((data as { value?: unknown } | null)?.value ?? {}) as Record<string, unknown>
}

interface Q {
  from(t: string): {
    select(c: string): {
      limit(n: number): Promise<{ data: unknown }>
      eq(col: string, v: string): { maybeSingle(): Promise<{ data: unknown }> }
      order(col: string, o: { ascending: boolean }): { limit(n: number): Promise<{ data: unknown }> }
    }
  }
  rpc(fn: string, args?: Record<string, unknown>): Promise<{ data: unknown }>
}

export default async function RfpAdminPage() {
  // 메뉴에서 안 보이는 것과 못 여는 것은 다르다 — 주소를 직접 쳐도 막혀야 한다.
  // 판정은 저장소 SSOT 한 곳이 한다(다른 관리자 화면과 같은 함수)
  await requireAdmin()

  const db = await createClient()
  const q = db as never as Q
  const { data: orgId } = await q.rpc('rfp_default_org')

  const [{ data: policies }, { data: rules }, { data: transfers }, { data: usage }, { data: members }] =
    await Promise.all([
      q.from('rfp_ai_models').select('vendor_id, is_internal, allowed_doc_classes, no_training, zero_retention, input_krw_per_mtok, output_krw_per_mtok, multimodal, sort_order').limit(50),
      q.from('rfp_anomaly_rules').select(RULE_COLS).limit(50),
      q.from('rfp_external_transfers').select('id, case_id, model_id, doc_class, purpose, created_at')
        .order('created_at', { ascending: false }).limit(50),
      q.from('rfp_usage_ledger').select('org_id, period, kind, units, cost_krw').limit(200),
      q.from('rfp_org_members').select('profile_id').limit(500),
    ])

  const org = orgId ? await q.from('rfp_orgs').select('id, name, plan_id').eq('id', String(orgId)).maybeSingle() : null
  const orgRow = (org?.data ?? null) as { name?: string; plan_id?: string } | null

  const planRow = orgRow?.plan_id
    ? (await q.from('rfp_plans')
        .select('id, name, monthly_case_limit, monthly_ai_krw, max_members, cross_verify, assistant')
        .eq('id', orgRow.plan_id).maybeSingle()).data
    : null

  // 키는 **관리자 설정 한 곳**에서, 「어느 등급까지 보낼 수 있나」는 RFP 표에서 온다.
  // 실제로 분석에 쓰이는 사슬을 그대로 보여 준다 — 화면과 워커가 다른 것을 보면
  // 「화면에는 쓸 수 있다는데 분석은 죽는」 일이 난다(실측 2026-09-09).
  const meta = await readHostMeta()
  const hosts = getAvailableProviders(meta).map((p) => ({ id: p.id, apiKey: p.apiKey, model: p.model }))
  const models = toModels(hosts, ((policies as Record<string, unknown>[] | null) ?? []).map(toPolicy))

  const vendors: VendorRow[] = models.map((m) => ({
    id: m.id,
    name: m.vendorId,
    modelName: m.modelName,
    isInternal: m.internal,
    hasKey: true,
    allowedDocClasses: m.allowedDocClasses,
  }))

  const rows: UsageRow[] = ((usage as Record<string, unknown>[] | null) ?? []).map((r) => ({
    orgId: String(r.org_id),
    period: String(r.period),
    kind: r.kind as UsageRow['kind'],
    units: Number(r.units ?? 0),
    costKrw: Number(r.cost_krw ?? 0),
  }))

  const savedRules: AnomalyRule[] = ((rules as Record<string, unknown>[] | null) ?? []).map(toRule)

  return (
    <main className="page-inner">
      <PageHeader title={RFP_ADMIN.title} back={{ href: '/rfp', label: RFP_LIST.title }} />
      <div className={styles.stack}>
      <UsageDashboard
        plan={planRow ? toPlan(planRow as Record<string, unknown>) : null}
        usage={summarize(rows, currentPeriod())}
        members={((members as unknown[] | null) ?? []).length}
        orgName={orgRow?.name ?? ''}
      />
      <VendorSettings vendors={vendors} />
      <RuleSettings saved={savedRules} />
      <TransferLog rows={((transfers as TransferRow[] | null) ?? [])} />
      <NotificationSettings />
      <G2bServices hasServiceKey={typeof meta[G2B_KEY_FIELD] === 'string' && String(meta[G2B_KEY_FIELD]).trim().length > 0} />
      </div>
    </main>
  )
}
