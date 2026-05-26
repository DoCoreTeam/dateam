import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import ContactForm from '../ContactForm'
import type { Account } from '@/types/database'

interface PageProps { searchParams: Promise<{ account_id?: string }> }

export default async function NewContactPage({ searchParams }: PageProps) {
  const { account_id } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: accounts } = await (adminClient as any).from('accounts').select('id, name').order('name') as { data: Pick<Account, 'id' | 'name'>[] | null }

  return (
    <div>
      <div style={{ marginBottom: '1.75rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.03em', margin: 0 }}>담당자 추가</h1>
      </div>
      <ContactForm accounts={accounts ?? []} defaultAccountId={account_id} />
    </div>
  )
}
