'use client'

import { useState } from 'react'
import { updateCompany } from './actions'
import { Building2, Save } from 'lucide-react'
import InlineError from '@/components/ui/InlineError'

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
      background: 'var(--color-bg)', border: 'var(--border-w-2) solid var(--border-color)', borderRadius: 'var(--radius)',
      padding: 'var(--space-5) var(--space-6)', marginBottom: '1.5rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: '0.75rem' }}>
        <Building2 size={18} color="var(--brand)" />
        <span style={{ fontWeight: 700, fontSize: 'var(--fs-lg)', color: 'var(--text)' }}>회사 정보</span>
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginLeft: 4 }}>조직도 최상단</span>
      </div>

      {editing ? (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div>
            <label className="label" htmlFor="company-name">회사명 *</label>
            <input
              id="company-name"
              className="input-field"
              name="name"
              defaultValue={defaultName}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="company-description">설명 (선택)</label>
            <textarea
              id="company-description"
              className="input-field"
              name="description"
              defaultValue={defaultDescription}
              rows={2}
              style={{ resize: 'vertical' }}
            />
          </div>
          <InlineError>{error}</InlineError>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button
              type="submit"
              disabled={pending}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.375rem',
                padding: 'var(--space-2) var(--space-4)', borderRadius: 'var(--radius)',
                background: pending ? 'var(--text-faint)' : 'var(--brand)', color: 'white',
                border: 'none', fontSize: 'var(--fs-base)', fontWeight: 500, cursor: pending ? 'not-allowed' : 'pointer',
              }}
            >
              <Save size={14} />
              {pending ? '저장 중...' : '저장'}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              style={{
                padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius)',
                background: 'transparent', color: 'var(--text-muted)',
                border: 'var(--border-w-2) solid var(--border-color)', fontSize: 'var(--fs-base)', cursor: 'pointer',
              }}
            >
              취소
            </button>
          </div>
        </form>
      ) : (
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-4)' }}>
          <div>
            <div style={{ fontSize: 'var(--fs-xl)', fontWeight: 700, color: 'var(--text)' }}>{defaultName}</div>
            {defaultDescription && (
              <div style={{ fontSize: 'var(--fs-base)', color: 'var(--text-muted)', marginTop: '0.25rem' }}>{defaultDescription}</div>
            )}
          </div>
          <button
            onClick={() => setEditing(true)}
            style={{
              flexShrink: 0, padding: '0.375rem 0.75rem', borderRadius: 'var(--radius)',
              background: 'transparent', color: 'var(--brand)',
              border: 'var(--hairline) solid var(--brand-soft-2)', fontSize: 'var(--fs-sm)', cursor: 'pointer', fontWeight: 500,
            }}
          >
            수정
          </button>
        </div>
      )}
    </div>
  )
}
