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
          버전별 변경사항을 관리합니다. 게시(노출)된 항목만 사용자에게 보입니다. 페이지 진입 시 최신 커밋을 초안으로 자동 수집하며, 기존 편집·게시는 보존됩니다(&quot;지금 최신화&quot;로 즉시 새로고침).
        </p>
      </div>
      <ChangelogAdmin />
    </div>
  )
}
