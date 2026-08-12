'use client'

// components/ci/LinkIntakeBox.tsx — 전역 링크 투입 (설계서 §5.3)
// "어느 화면에서든 링크 붙여넣기와 모바일 공유 시트로 수집함에 투입"
// 입구를 하나로 두어야 유입 경로가 갈라지지 않는다.

import { useState } from 'react'
import type { ApiResponse, CiIngestResult } from '@/lib/ci/contracts'
import { isEnterKey } from '@/lib/ui/ime'

interface LinkIntakeBoxProps {
  workspaceId: string
  onDone?: (result: CiIngestResult) => void
  placeholder?: string
  source?: 'inbox' | 'monitoring'
}

export default function LinkIntakeBox({
  workspaceId, onDone, placeholder, source = 'inbox',
}: LinkIntakeBoxProps) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<CiIngestResult | null>(null)
  const [error, setError] = useState<{ code: string; message: string } | null>(null)

  async function submit() {
    const urls = value.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)
    if (urls.length === 0) return

    setBusy(true); setError(null); setResult(null)
    try {
      const res = await fetch('/api/ci/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CI-Workspace': workspaceId },
        body: JSON.stringify({ urls, source }),
      }).then((r) => r.json() as Promise<ApiResponse<CiIngestResult>>)

      if (!res.success) {
        setError({ code: res.error.code, message: res.error.message })
        return
      }
      setResult(res.data)
      if (res.data.accepted.length > 0) setValue('')
      onDone?.(res.data)
    } catch {
      setError({ code: 'INTERNAL', message: '링크를 보내지 못했습니다. 잠시 후 다시 시도해 주세요' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'stretch' }}>
        <label className="label" htmlFor="ci-link-intake" style={{ position: 'absolute', left: '-9999px' }}>
          링크 붙여넣기
        </label>
        <input className="input-field"
          id="ci-link-intake"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (isEnterKey(e) && !e.shiftKey) { e.preventDefault(); submit() } }}
          placeholder={placeholder ?? '링크를 붙여넣으세요 (여러 개는 줄바꿈이나 쉼표로 구분)'}
          disabled={busy}
          style={{ flex: 1 }}
        />
        <button type="button" className="btn-primary" onClick={submit} disabled={busy || !value.trim()}>
          {busy ? '보내는 중…' : '추가'}
        </button>
      </div>

      {error && (
        <p className="error-state" role="alert" style={{ marginTop: 'var(--space-2)' }}>
          {error.message} <span className="error-state-code">코드: {error.code}</span>
        </p>
      )}

      {result && (
        <div style={{ marginTop: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          {result.accepted.length > 0 && (
            <p className="ci-status ci-status-ok" style={{ alignSelf: 'flex-start' }}>
              {result.accepted.length}건 수집을 시작했습니다
            </p>
          )}
          {result.rejected.map((r) => (
            <p key={r.url} className="ci-status ci-status-warn" style={{ alignSelf: 'flex-start' }}>
              {r.message} — {r.url}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
