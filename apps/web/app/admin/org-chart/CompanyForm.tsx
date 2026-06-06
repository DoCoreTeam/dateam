'use client'

import { useState } from 'react'
import { updateCompany } from './actions'
import { Building2, Save } from 'lucide-react'

interface CompanyFormProps {
  defaultName: string
  defaultDescription: string
}

export default function CompanyForm({ defaultName, defaultDescription }: CompanyFormProps) {
  const [editing, setEditing] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    setPending(true)
    setError(null)
    const result = await updateCompany(new FormData(form))
    if (result.error) {
      setError(result.error)
    } else {
      setEditing(false)
    }
    setPending(false)
  }

  return (
    <div style={{
      background: 'var(--color-bg)', border: '2px solid var(--border-color)', borderRadius: 'var(--radius)',
      padding: '1.25rem 1.5rem', marginBottom: '1.5rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <Building2 size={18} color="var(--brand)" />
        <span style={{ fontWeight: 700, fontSize: '1rem', color: '#1e293b' }}>회사 정보</span>
        <span style={{ fontSize: '0.75rem', color: '#94a3b8', marginLeft: 4 }}>조직도 최상단</span>
      </div>

      {editing ? (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: '#475569', marginBottom: '0.25rem' }}>
              회사명 *
            </label>
            <input
              name="name"
              defaultValue={defaultName}
              required
              style={{
                width: '100%', padding: '0.5rem 0.75rem', borderRadius: '0.375rem',
                border: '2px solid var(--border-color)', fontSize: '0.875rem', boxSizing: 'border-box',
              }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: '#475569', marginBottom: '0.25rem' }}>
              설명 (선택)
            </label>
            <textarea
              name="description"
              defaultValue={defaultDescription}
              rows={2}
              style={{
                width: '100%', padding: '0.5rem 0.75rem', borderRadius: '0.375rem',
                border: '2px solid var(--border-color)', fontSize: '0.875rem', boxSizing: 'border-box', resize: 'vertical',
              }}
            />
          </div>
          {error && <p style={{ fontSize: '0.8125rem', color: '#dc2626', margin: 0 }}>{error}</p>}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="submit"
              disabled={pending}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.375rem',
                padding: '0.5rem 1rem', borderRadius: '0.375rem',
                background: pending ? '#94a3b8' : 'var(--brand)', color: 'white',
                border: 'none', fontSize: '0.875rem', fontWeight: 500, cursor: pending ? 'not-allowed' : 'pointer',
              }}
            >
              <Save size={14} />
              {pending ? '저장 중...' : '저장'}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              style={{
                padding: '0.5rem 0.75rem', borderRadius: '0.375rem',
                background: 'transparent', color: '#64748b',
                border: '2px solid var(--border-color)', fontSize: '0.875rem', cursor: 'pointer',
              }}
            >
              취소
            </button>
          </div>
        </form>
      ) : (
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem' }}>
          <div>
            <div style={{ fontSize: '1.125rem', fontWeight: 700, color: '#1e293b' }}>{defaultName}</div>
            {defaultDescription && (
              <div style={{ fontSize: '0.875rem', color: '#64748b', marginTop: '0.25rem' }}>{defaultDescription}</div>
            )}
          </div>
          <button
            onClick={() => setEditing(true)}
            style={{
              flexShrink: 0, padding: '0.375rem 0.75rem', borderRadius: '0.375rem',
              background: 'transparent', color: 'var(--brand)',
              border: '1px solid #ddd6fe', fontSize: '0.8125rem', cursor: 'pointer', fontWeight: 500,
            }}
          >
            수정
          </button>
        </div>
      )}
    </div>
  )
}
