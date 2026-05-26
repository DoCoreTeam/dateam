import { redirect, notFound } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import AccountForm from '../../AccountForm'
import type { Account } from '@/types/database'

interface PageProps { params: Promise<{ id: string }> }

export default async function EditAccountPage({ params }: PageProps) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (adminClient as any).from('accounts').select('*').eq('id', id).single() as { data: Account | null }
  if (!data) notFound()

  return (
    <div>
      <div style={{ marginBottom: '1.75rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.03em', margin: 0 }}>
          거래처 편집
        </h1>
        <p style={{ color: '#64748b', marginTop: '0.375rem', fontSize: '0.9rem' }}>{data.name}</p>
      </div>
      <AccountForm account={data} />
    </div>
  )
}
