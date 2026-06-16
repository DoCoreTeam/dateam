'use client'

// 임시저장 복원 배너 — 새로고침/재진입 시 "임시저장본 복원/버리기". 모든 입력면 공용.
export default function DraftRestoreBanner({ show, onRestore, onDiscard }: {
  show: boolean; onRestore: () => void; onDiscard: () => void
}) {
  if (!show) return null
  return (
    <div data-testid="draft-restore-banner" role="status" style={{
      display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap',
      padding: 'var(--space-2) var(--space-3)', marginBottom: 'var(--space-2)',
      borderRadius: 'var(--radius)', background: 'var(--info-bg)',
      border: 'var(--hairline) solid var(--info)', fontSize: 'var(--fs-sm)', color: 'var(--text)',
    }}>
      <span>✦ 작성하던 임시저장본이 있습니다.</span>
      <div style={{ display: 'flex', gap: 'var(--space-1)', marginLeft: 'auto' }}>
        <button onClick={onRestore} data-testid="draft-restore-btn" style={{
          padding: '2px 10px', borderRadius: 'var(--radius)', border: 'var(--border-w-2) solid var(--brand)',
          background: 'var(--brand)', color: '#fff', fontSize: 'var(--fs-xs)', fontWeight: 700, cursor: 'pointer',
        }}>복원</button>
        <button onClick={onDiscard} style={{
          padding: '2px 10px', borderRadius: 'var(--radius)', border: 'var(--border-w-2) solid var(--border-color)',
          background: 'var(--surface-bg)', color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', cursor: 'pointer',
        }}>버리기</button>
      </div>
    </div>
  )
}
