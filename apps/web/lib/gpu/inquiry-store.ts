// GPU 문의 읽기와 기록 — 계산과 글은 inquiry.ts, 여기는 DB 만
// 읽기는 회원 세션 클라이언트(RLS 그대로), 기록(gpu_audit_logs)만 서비스롤, 부르는 창구가 사람 확인을 먼저 한다

import { getGpuBoard } from './board-data.ts'
import { buildInquiry, matchOrg, type Inquiry, type InquiryContact, type InquiryOrgIn, type InquiryRecordIn } from './inquiry.ts'
import { recordGpuAudit } from './audit.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

interface SupplierRow { id: string; name: string | null; website: string | null; account_id: string | null }
interface CompetitorRow { name: string | null; short_name: string | null; aliases: string[] | null; website_url: string | null; supplier_id: string | null }
interface ContactRow { name: string | null; title: string | null; email: string | null; phone: string | null; mobile: string | null }

async function readOrgs(db: Db): Promise<InquiryOrgIn[]> {
  const [{ data: suppliers, error: se }, { data: competitors, error: ce }] = await Promise.all([
    db.from('suppliers').select('id, name, website, account_id'),
    db.from('competitors').select('name, short_name, aliases, website_url, supplier_id').is('deleted_at', null),
  ])
  if (se) throw se
  if (ce) throw ce
  const byId = new Map<string, SupplierRow>(((suppliers ?? []) as SupplierRow[]).map((s) => [s.id, s]))
  const fromSuppliers = [...byId.values()].map((s) => ({
    names: [s.name ?? ''], supplier_id: s.id, account_id: s.account_id, website: s.website,
  }))
  const fromCompetitors = ((competitors ?? []) as CompetitorRow[]).map((c) => {
    const linked = c.supplier_id ? byId.get(c.supplier_id) : undefined
    return {
      names: [c.name ?? '', c.short_name ?? '', ...(c.aliases ?? [])].filter(Boolean),
      supplier_id: c.supplier_id,
      account_id: linked?.account_id ?? null,
      website: c.website_url ?? linked?.website ?? null,
    }
  })
  return [...fromSuppliers, ...fromCompetitors]
}

async function readContacts(db: Db, accountId: string | null): Promise<InquiryContact[]> {
  if (!accountId) return []
  const { data, error } = await db
    .from('contacts')
    .select('name, title, email, phone, mobile')
    .eq('account_id', accountId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return ((data ?? []) as ContactRow[]).map((c) => ({
    name: c.name ?? '',
    title: c.title,
    email: c.email,
    phone: c.mobile ?? c.phone,
  }))
}

export type InquiryLookup = { ok: true; inquiry: Inquiry } | { ok: false; status: 404; code: 'no_product' | 'no_vendor' }

/** 상품 하나가 든 모델 줄의 가장 싼 공급사와 그 연락처 */
export async function getInquiry(db: Db, productId: string): Promise<InquiryLookup> {
  const board = await getGpuBoard(db)
  const row = board.rows.find((r) => r.products.some((p) => p.id === productId))
  if (!row) return { ok: false, status: 404, code: 'no_product' }
  const offer = row.vendors.find((v) => v.krw != null)
  if (!offer) return { ok: false, status: 404, code: 'no_vendor' }
  const org = matchOrg(offer.vendor, await readOrgs(db))
  const inquiry = buildInquiry({ row, product_id: productId, org, contacts: await readContacts(db, org?.account_id ?? null) })
  return inquiry ? { ok: true, inquiry } : { ok: false, status: 404, code: 'no_vendor' }
}

/** 문의한 사실을 이력에 남긴다 — 상품이 있는지 먼저 본다 */
export async function recordInquiry(db: Db, admin: Db, actor: string, input: InquiryRecordIn): Promise<{ ok: boolean }> {
  const { data, error } = await db.from('gpu_products').select('id, model_name').eq('id', input.product_id).maybeSingle()
  if (error) throw error
  if (!data) return { ok: false }
  await recordGpuAudit(admin, {
    actor,
    actionType: 'inquiry_sent',
    productId: input.product_id,
    detail: { vendor: input.vendor, channel: input.channel, model: data.model_name },
  })
  return { ok: true }
}
