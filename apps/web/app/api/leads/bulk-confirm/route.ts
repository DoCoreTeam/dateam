import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import type { ParsedLeadData } from '@/lib/gemini-lead'

interface BulkConfirmBody {
  intakeIds: string[]
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as BulkConfirmBody
  const { intakeIds } = body

  if (!intakeIds?.length) {
    return NextResponse.json({ error: '등록할 항목이 없습니다' }, { status: 400 })
  }

  const adminClient = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adm = adminClient as any

  // 본인 소유 확인 후 lead_intakes 조회
  const { data: intakes, error: fetchErr } = await adm
    .from('lead_intakes')
    .select('id, parsed_data')
    .in('id', intakeIds)
    .eq('user_id', user.id)
    .eq('status', 'completed')

  if (fetchErr) {
    console.error('[bulk-confirm fetch]', fetchErr)
    return NextResponse.json({ error: '데이터 조회 실패' }, { status: 500 })
  }

  let created = 0
  let skipped = 0
  const errors: string[] = []

  const ALLOWED_SEGMENTS = new Set(['엔터프라이즈', 'SMB', '공공', '스타트업'])

  for (const intake of (intakes ?? [])) {
    const parsed = intake.parsed_data as ParsedLeadData
    if (!parsed?.company_name?.trim()) { skipped++; continue }

    try {
      // 1. Account upsert (회사명+user_id 기준)
      const { data: existingAccount } = await adm
        .from('accounts')
        .select('id')
        .eq('user_id', user.id)
        .eq('name', parsed.company_name.trim())
        .maybeSingle()

      let accountId: string | null = existingAccount?.id ?? null

      if (!accountId) {
        const rawSegment = parsed.segment ?? null
        const segment = rawSegment && ALLOWED_SEGMENTS.has(rawSegment) ? rawSegment : null
        const { data: newAccount, error: accErr } = await adm.from('accounts').insert({
          user_id: user.id,
          name: parsed.company_name.trim(),
          industry: parsed.industry ?? null,
          segment,
          size: parsed.size ?? null,
          region: parsed.region ?? null,
          website: parsed.website ?? null,
          phone: parsed.company_phone ?? null,
          address: parsed.address ?? null,
          fit_score: parsed.fit_score ?? null,
          description: parsed.deal_description ?? null,
          account_type: parsed.account_type ?? null,
          gpu_demand_intensity: parsed.gpu_demand_intensity ?? null,
        }).select('id').single()
        if (accErr) throw accErr
        accountId = newAccount.id
      }

      // 2. Contact upsert (이메일+user_id 기준, 이메일 없으면 이름+account_id 기준)
      let contactId: string | null = null
      if (parsed.contact_name?.trim()) {
        let existingContact = null
        if (parsed.contact_email?.trim()) {
          const { data: byEmail } = await adm
            .from('contacts')
            .select('id')
            .eq('user_id', user.id)
            .eq('email', parsed.contact_email.trim().toLowerCase())
            .maybeSingle()
          existingContact = byEmail
        }

        if (existingContact?.id) {
          contactId = existingContact.id
        } else {
          const { data: newContact, error: conErr } = await adm.from('contacts').insert({
            user_id: user.id,
            account_id: accountId,
            name: parsed.contact_name.trim(),
            title: parsed.contact_title ?? null,
            department: parsed.contact_department ?? null,
            email: parsed.contact_email?.trim().toLowerCase() ?? null,
            phone: parsed.contact_phone ?? null,
            mobile: parsed.contact_mobile ?? null,
            role: parsed.contact_role ?? null,
          }).select('id').single()
          if (conErr) throw conErr
          contactId = newContact.id
        }
      }

      // 3. Deal insert
      const dealTitle = parsed.deal_title?.trim()
        || `${parsed.company_name.trim()} 신규 협력`
      const { error: dealErr } = await adm.from('deals').insert({
        user_id: user.id,
        account_id: accountId,
        contact_id: contactId,
        title: dealTitle,
        description: parsed.deal_description ?? null,
        stage: '신규',
        value: parsed.deal_value_billion ? parsed.deal_value_billion * 100000000 : null,
        lead_type: parsed.lead_type ?? null,
        product: parsed.product_recommendation ?? null,
        fit_score: parsed.fit_score ?? null,
        hw_included: parsed.hw_included ?? false,
        is_new_deal: parsed.is_new_deal ?? true,
      })
      if (dealErr) throw dealErr

      // 4. lead_intakes 상태 업데이트
      await adm.from('lead_intakes').update({ status: 'crm_registered' }).eq('id', intake.id)
      created++
    } catch (err) {
      console.error('[bulk-confirm row]', intake.id, err)
      errors.push(intake.id)
      skipped++
    }
  }

  return NextResponse.json({ success: true, created, skipped, errors })
}
