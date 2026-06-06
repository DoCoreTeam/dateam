'use client'

import { useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import TierForm from './TierForm'
import DeleteTierButton from './DeleteTierButton'

interface TierRowProps {
  id: string
  name: string
  discountRate: number
  description: string | null
  createdAt: string
}

export default function TierRow({ id, name, discountRate, description, createdAt }: TierRowProps) {
  const [editing, setEditing] = useState(false)

  if (editing) {
    return (
      <tr>
        <td colSpan={5} style={{ padding: '1rem 1.25rem', background: 'var(--color-bg)' }}>
          <TierForm
            mode="edit"
            tierId={id}
            defaultName={name}
            defaultRate={discountRate}
            defaultDescription={description ?? ''}
            onCancel={() => setEditing(false)}
          />
        </td>
      </tr>
    )
  }

  return (
    <tr>
      <td className="card-header">
        <span style={{ fontWeight: 500 }}>{name}</span>
      </td>
      <td data-label="할인율">
        <span className="badge badge-indigo" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {parseFloat(String(discountRate)).toFixed(2)}%
        </span>
      </td>
      <td data-label="설명" className="card-hide">
        <span style={{ color: '#64748b', fontSize: '0.8125rem' }}>{description || '-'}</span>
      </td>
      <td data-label="생성일" className="card-hide">
        <span style={{ color: '#64748b', fontSize: '0.8125rem' }}>
          {new Date(createdAt).toLocaleDateString('ko-KR')}
        </span>
      </td>
      <td data-label="관리">
        <div style={{ display: 'flex', gap: '0.375rem' }}>
          <button
            onClick={() => setEditing(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.25rem',
              padding: '0.375rem 0.625rem', borderRadius: '0.375rem',
              background: '#f1f5f9', color: '#475569',
              border: 'none', fontSize: '0.8125rem', cursor: 'pointer',
            }}
          >
            <Pencil size={13} /> 수정
          </button>
          <DeleteTierButton tierId={id} tierName={name} />
        </div>
      </td>
    </tr>
  )
}
