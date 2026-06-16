'use client'

import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { clearPersistedSwrCache } from '@/lib/swr-persist'

export default function LogoutButton() {
  const router = useRouter()

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    clearPersistedSwrCache() // 공유 PC 데이터 잔류 차단
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
