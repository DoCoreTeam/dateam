import { redirect, notFound } from 'next/navigation'
import PageHeader from '@/components/ui/PageHeader'
import ProjectTabs from '@/components/ui/ProjectTabs'
import { createClient, createAdminClient, getRequestUser } from '@/lib/supabase/server'
import DealForm from '../../DealForm'
import type { Deal, Account, Contact } from '@/types/database'

interface PageProps { params: Promise<{ id: string }> }

export default async function EditDealPage({ params }: PageProps) {
  const { id } = await params
  const supabase = await createClient()
  const user = await getRequestUser()
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
      <PageHeader back={{ href: `/deals/${id}`, label: '영업기회 상세' }} title="영업기회 편집" description={deal.title} 
        below={<ProjectTabs />}
      />
      <DealForm deal={deal} accounts={accounts ?? []} contacts={contacts ?? []} />
    </div>
  )
}
