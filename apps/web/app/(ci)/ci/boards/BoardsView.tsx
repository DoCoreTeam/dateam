'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ApiResponse } from '@/lib/ci/contracts'
import { EmptyState, ErrorState } from '@/components/ci/states'

interface Board { id: string; name: string; itemCount: number }

export default function BoardsView({
  workspaceId, boards, pendingContentId,
}: { workspaceId: string; boards: Board[]; pendingContentId: string | null }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ code: string; message: string } | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  async function create() {
    if (!name.trim()) return
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/ci/boards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CI-Workspace': workspaceId },
        body: JSON.stringify({ name: name.trim() }),
      }).then((r) => r.json() as Promise<ApiResponse<{ id: string }>>)
      if (!res.success) { setError({ code: res.error.code, message: res.error.message }); return }
      setName('')
      if (pendingContentId) await addTo(res.data.id)
      router.refresh()
    } finally { setBusy(false) }
  }

  async function addTo(boardId: string) {
    if (!pendingContentId) return
    const res = await fetch(`/api/ci/boards/${boardId}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CI-Workspace': workspaceId },
      body: JSON.stringify({ itemType: 'content', itemId: pendingContentId }),
    }).then((r) => r.json() as Promise<ApiResponse<{ deduped: boolean }>>)
    if (res.success) {
      setSaved(res.data.deduped ? '이미 담겨 있습니다' : '보드에 담았습니다')
      router.refresh()
    }
  }

  return (
    <>
      {pendingContentId && (
        <p className="ci-status ci-status-info" style={{ marginBottom: 'var(--space-4)', display: 'inline-flex' }}>
          담을 항목을 들고 왔습니다 — 아래 보드를 고르거나 새로 만드세요
        </p>
      )}
      {saved && (
        <p className="ci-status ci-status-ok" style={{ marginBottom: 'var(--space-4)', display: 'inline-flex' }}>
          {saved}
        </p>
      )}

      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
        <label className="label" htmlFor="ci-board-name" style={{ position: 'absolute', left: '-9999px' }}>보드 이름</label>
        <input className="input-field" id="ci-board-name"
          value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); create() } }}
          placeholder="새 보드 이름 (예: 이번 달 소재)" disabled={busy} style={{ flex: 1 }}
        />
        <button type="button" className="btn-primary" onClick={create} disabled={busy || !name.trim()}>
          보드 만들기
        </button>
      </div>

      {error && <div style={{ marginBottom: 'var(--space-4)' }}><ErrorState code={error.code} message={error.message} /></div>}

      {boards.length === 0 ? (
        <EmptyState
          title="아직 만든 보드가 없습니다"
          description="트렌드나 수집함에서 '보드 담기'를 누르면 여기에 모입니다. 제작의 아이디어 열이 이 보드를 소스로 씁니다."
          action={{ label: '트렌드 보기', href: '/ci/trends?tab=outliers' }}
        />
      ) : (
        <table className="table-base table-card">
          <thead><tr><th>보드</th><th>담긴 항목</th><th>작업</th></tr></thead>
          <tbody>
            {boards.map((b) => (
              <tr key={b.id}>
                <td className="card-header"><strong>{b.name}</strong></td>
                <td data-label="담긴 항목"><span className="ci-num">{b.itemCount}</span>건</td>
                <td className="card-actions">
                  {pendingContentId && (
                    <button type="button" className="btn-primary" onClick={() => addTo(b.id)}>
                      여기에 담기
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}
