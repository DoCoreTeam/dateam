'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useState } from 'react'

interface Props {
  accountId: string
}

export default function AccountActions({ accountId }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleDelete() {
    if (!confirm('이 거래처를 삭제하시겠습니까?')) return
    setLoading(true)
    const res = await fetch(`/api/accounts/${accountId}`, { method: 'DELETE' })
    if (res.ok) {
      router.refresh()
    } else {
      alert('삭제에 실패했습니다')
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
      <Link
        href={`/accounts/${accountId}`}
        style={{ fontSize: '0.75rem', color: '#6366f1', fontWeight: 600, textDecoration: 'none', padding: '0.25rem 0.5rem', border: '1px solid #e0e7ff', borderRadius: '0.375rem', minHeight: '32px', display: 'flex', alignItems: 'center' }}
      >
        상세
      </Link>
      <button
        onClick={handleDelete}
        disabled={loading}
        style={{ fontSize: '0.75rem', color: '#dc2626', fontWeight: 600, background: 'none', border: '1px solid #fecaca', borderRadius: '0.375rem', cursor: 'pointer', padding: '0.25rem 0.5rem', minHeight: '32px' }}
      >
        삭제
      </button>
    </div>
  )
}
