'use client'

import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'

export default function LogoutButton() {
  const router = useRouter()

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <button
      onClick={handleLogout}
      className="btn-ghost"
      style={{ fontSize: 'var(--fs-sm)', gap: '0.375rem' }}
      title="로그아웃"
    >
      <LogOut size={15} />
      <span>로그아웃</span>
    </button>
  )
}
