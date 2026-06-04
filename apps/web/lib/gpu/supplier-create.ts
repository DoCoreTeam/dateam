// 공급사 생성 공용 로직 — 수동 추가(POST)와 통합입력 자동생성(quotes)에서 공유.
// ① 웹사이트 도메인 → 로고 URL 자동 산출  ② accounts(is_supplier) 생성·링크(회사=accounts 통합)

const SUPPLIER_OWNER = 'f687c53a-2a1e-4616-9fc4-2c4b52b77d7f' // michaelkim — 마이그레이션 일관 소유자

export function logoFromWebsite(website?: string | null): string | null {
  if (!website) return null
  const m = website.match(/^https?:\/\/(?:www\.)?([^/]+)/)
  return m ? `https://www.google.com/s2/favicons?sz=128&domain=${m[1]}` : null
}

interface SupplierLike {
  id: string; name: string; country?: string | null; website?: string | null
  description?: string | null; color?: string | null; logo_url?: string | null
}

// 공급사에 대응하는 accounts(is_supplier) 보장 + suppliers.account_id 링크. account_id 반환.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ensureSupplierAccount(adminDb: any, s: SupplierLike, ownerUserId?: string): Promise<string | null> {
  try {
    const { data: existing } = await adminDb.from('accounts').select('id').eq('name', s.name).maybeSingle()
    let accountId = existing?.id as string | undefined
    if (accountId) {
      await adminDb.from('accounts').update({ is_supplier: true, color: s.color ?? null, logo_url: s.logo_url ?? null }).eq('id', accountId)
    } else {
      const { data: created } = await adminDb.from('accounts').insert({
        user_id: ownerUserId || SUPPLIER_OWNER, name: s.name, region: s.country ?? null,
        website: s.website ?? null, description: s.description ?? null, color: s.color ?? null,
        logo_url: s.logo_url ?? null, is_supplier: true, is_customer: false, source: 'supplier',
      }).select('id').single()
      accountId = created?.id
    }
    if (accountId) await adminDb.from('suppliers').update({ account_id: accountId }).eq('id', s.id)
    return accountId ?? null
  } catch {
    return null // 링크 실패해도 공급사 생성 자체는 유지(비치명적)
  }
}
