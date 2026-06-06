import Link from 'next/link'

interface Props {
  accountId: string
}

// 목록 행의 상세 지름길. 삭제는 상세 슬라이드 패널로 일원화(contacts/deals와 일관).
export default function AccountActions({ accountId }: Props) {
  return (
    <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
      <Link
        href={`/accounts/${accountId}`}
        style={{ fontSize: '0.75rem', color: 'var(--brand)', fontWeight: 600, textDecoration: 'none', padding: '0.25rem 0.5rem', border: '1px solid #e0e7ff', borderRadius: '0.375rem', minHeight: '32px', display: 'flex', alignItems: 'center' }}
      >
        상세
      </Link>
    </div>
  )
}
