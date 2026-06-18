import { History } from 'lucide-react'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import ChangelogAdmin from './ChangelogAdmin'

export default async function AdminChangelogPage() {
  await requireAdmin()
  return (
    <div>
      <div style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', marginBottom: '0.375rem' }}>
          <History size={20} color="var(--brand)" />
          <h1 style={{ fontSize: 'var(--fs-2xl)', fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.03em', margin: 0 }}>
            업데이트 내역
          </h1>
        </div>
        <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: 'var(--fs-sm)' }}>
          버전별 변경사항을 관리합니다. 게시(노출)된 항목만 사용자에게 보입니다. &quot;git에서 가져오기&quot;로 커밋을 초안으로 자동 수집할 수 있습니다.
        </p>
      </div>
      <ChangelogAdmin />
    </div>
  )
}
