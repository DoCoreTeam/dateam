import { redirect, notFound } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import ContactForm from '../../ContactForm'
import type { Contact, Account } from '@/types/database'

interface PageProps { params: Promise<{ id: string }> }

export default async function EditContactPage({ params }: PageProps) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adm = adminClient as any
  const [{ data: contact }, { data: accounts }] = await Promise.all([
    adm.from('contacts').select('*').eq('id', id).single() as Promise<{ data: Contact | null }>,
    adm.from('accounts').select('id, name').order('name') as Promise<{ data: Pick<Account, 'id' | 'name'>[] | null }>,
  ])
  if (!contact) notFound()

  return (
    <div>
      <div style={{ marginBottom: '1.75rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.03em', margin: 0 }}>담당자 편집</h1>
      </div>
      <ContactForm contact={contact} accounts={accounts ?? []} />
    </div>
  )
}
