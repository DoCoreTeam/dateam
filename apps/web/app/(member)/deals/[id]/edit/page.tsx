import { redirect, notFound } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import DealForm from '../../DealForm'
import type { Deal, Account, Contact } from '@/types/database'

interface PageProps { params: Promise<{ id: string }> }

export default async function EditDealPage({ params }: PageProps) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adm = adminClient as any
  const [{ data: deal }, { data: accounts }, { data: contacts }] = await Promise.all([
    adm.from('deals').select('*').eq('id', id).single() as Promise<{ data: Deal | null }>,
    adm.from('accounts').select('id, name').order('name') as Promise<{ data: Pick<Account, 'id' | 'name'>[] | null }>,
    adm.from('contacts').select('id, name, account_id').order('name') as Promise<{ data: Pick<Contact, 'id' | 'name' | 'account_id'>[] | null }>,
  ])
  if (!deal) notFound()

  return (
    <div>
      <div style={{ marginBottom: '1.75rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.03em', margin: 0 }}>영업기회 편집</h1>
      </div>
      <DealForm deal={deal} accounts={accounts ?? []} contacts={contacts ?? []} />
    </div>
  )
}
