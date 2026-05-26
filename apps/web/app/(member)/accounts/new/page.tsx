import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AccountForm from '../AccountForm'

export default async function NewAccountPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div>
      <div style={{ marginBottom: '1.75rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.03em', margin: 0 }}>
          거래처 추가
        </h1>
        <p style={{ color: '#64748b', marginTop: '0.375rem', fontSize: '0.9rem' }}>새 거래처를 등록합니다</p>
      </div>
      <AccountForm />
    </div>
  )
}
