import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import ContactForm from '../ContactForm'
import type { Account } from '@/types/database'
import LeadIntakeForm from '../../lead-intake/LeadIntakeForm'

interface PageProps { searchParams: Promise<{ account_id?: string; mode?: string }> }

export default async function NewContactPage({ searchParams }: PageProps) {
  const { account_id, mode } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: accounts } = await (adminClient as any).from('accounts').select('id, name').order('name') as { data: Pick<Account, 'id' | 'name'>[] | null }

  return (
    <div>
      <div style={{ marginBottom: '1.75rem' }}>
        <h1 style={{ fontSize: 'var(--fs-2xl)', fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.03em', margin: 0 }}>
          {mode === 'manual' ? '담당자 수동 입력' : 'AI로 담당자 추가'}
        </h1>
      </div>
      {mode === 'manual' ? (
        <ContactForm accounts={accounts ?? []} defaultAccountId={account_id} />
      ) : (
        <>
          <div className="card" style={{ padding: 'var(--space-6)', maxWidth: '760px' }}>
            <LeadIntakeForm />
          </div>
          <div style={{ marginTop: '1rem' }}>
            <Link href="/contacts/new?mode=manual" style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-base)', fontWeight: 600, textDecoration: 'none' }}>
              수동 입력으로 전환
            </Link>
          </div>
        </>
      )}
    </div>
  )
}
