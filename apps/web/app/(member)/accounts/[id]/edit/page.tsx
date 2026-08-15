import { redirect, notFound } from 'next/navigation'
import PageHeader from '@/components/ui/PageHeader'
import { createClient, createAdminClient, getRequestUser } from '@/lib/supabase/server'
import AccountForm from '../../AccountForm'
import type { Account } from '@/types/database'

interface PageProps { params: Promise<{ id: string }> }

export default async function EditAccountPage({ params }: PageProps) {
  const { id } = await params
  const supabase = await createClient()
  const user = await getRequestUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (adminClient as any).from('accounts').select('*').eq('id', id).single() as { data: Account | null }
  if (!data) notFound()

  return (
    <div>
      <PageHeader title="거래처 편집" description={data.name} />
      <AccountForm account={data} />
    </div>
  )
}
