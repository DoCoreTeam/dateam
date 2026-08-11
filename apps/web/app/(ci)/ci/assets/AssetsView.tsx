'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { ApiResponse } from '@/lib/ci/contracts'
import { formatKstDateTimeShort } from '@/lib/datetime/kst'
import { EmptyState, ErrorState } from '@/components/ci/states'

interface Asset {
  id: string; kind: string; path: string
  mime: string | null; bytes: number | null; createdAt: string
}

export default function AssetsView({
  workspaceId, assets,
}: { workspaceId: string; assets: Asset[] }) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ code: string; message: string } | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  async function upload(file: File) {
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/ci/assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CI-Workspace': workspaceId },
        body: JSON.stringify({ fileName: file.name, mime: file.type, bytes: file.size, kind: 'source' }),
      }).then((r) => r.json() as Promise<ApiResponse<{ path: string; token: string; bucket: string }>>)

      if (!res.success) { setError({ code: res.error.code, message: res.error.message }); return }

      const supabase = createClient()
      const { error: upErr } = await supabase.storage
        .from(res.data.bucket)
        .uploadToSignedUrl(res.data.path, res.data.token, file)

      if (upErr) {
        setError({ code: 'INTERNAL', message: `파일을 올리지 못했습니다: ${upErr.message}` })
        return
      }
      setToast(`${file.name} 올렸습니다`)
      setTimeout(() => setToast(null), 2500)
      router.refresh()
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function remove(id: string) {
    await fetch(`/api/ci/assets?id=${id}`, { method: 'DELETE', headers: { 'X-CI-Workspace': workspaceId } })
    router.refresh()
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-end', marginBottom: 'var(--space-4)' }}>
        <div style={{ flex: 1 }}>
          <label className="label" htmlFor="a-file">파일 올리기</label>
          <input className="input-field" id="a-file" type="file" ref={inputRef}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f) }}
            disabled={busy} />
        </div>
      </div>

      {toast && <p className="ci-status ci-status-ok" style={{ marginBottom: 'var(--space-3)', display: 'inline-flex' }}>{toast}</p>}
      {error && <div style={{ marginBottom: 'var(--space-4)' }}><ErrorState code={error.code} message={error.message} /></div>}

      {assets.length === 0 ? (
        <EmptyState
          title="아직 등록된 자료가 없습니다"
          description="위에서 파일을 올리면 여기에 쌓입니다. 기획안·편집안에서 만든 산출물도 함께 모입니다."
          action={{ label: '파이프라인으로', href: '/ci/pipeline' }}
        />
      ) : (
        <table className="table-base table-card">
          <thead><tr><th>파일</th><th>구분</th><th>형식</th><th>크기</th><th>등록</th><th>작업</th></tr></thead>
          <tbody>
            {assets.map((a) => (
              <tr key={a.id}>
                <td className="card-header">{a.path.split('/').pop()}</td>
                <td data-label="구분">{a.kind === 'source' ? '원본' : '산출물'}</td>
                <td data-label="형식">{a.mime ?? '—'}</td>
                <td data-label="크기">
                  {a.bytes != null
                    ? <span className="ci-num">{Math.max(1, Math.round(a.bytes / 1024)).toLocaleString('ko-KR')} KB</span>
                    : '—'}
                </td>
                <td data-label="등록">{formatKstDateTimeShort(a.createdAt)}</td>
                <td className="card-actions">
                  <button type="button" className="btn-ghost" onClick={() => remove(a.id)}>삭제</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}
