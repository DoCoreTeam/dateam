'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/lead-intake', label: '리드 인테이크' },
  { href: '/accounts', label: '거래처' },
  { href: '/contacts', label: '담당자' },
  { href: '/deals', label: '영업기회' },
] as const

export default function ProjectTabs() {
  const pathname = usePathname()

  return (
    <div style={{ display: 'flex', borderBottom: '2px solid var(--color-border)', marginBottom: '1.5rem', overflowX: 'auto' }}>
      {TABS.map(t => {
        const active = pathname === t.href || pathname.startsWith(t.href + '/')
        return (
          <Link
            key={t.href}
            href={t.href}
            style={{
              padding: '0.625rem 1.25rem',
              fontSize: '0.875rem',
              fontWeight: active ? 600 : 400,
              color: active ? 'var(--brand-dark)' : '#64748b',
              borderBottom: active ? '2px solid var(--brand-dark)' : '2px solid transparent',
              marginBottom: '-2px',
              textDecoration: 'none',
              whiteSpace: 'nowrap',
              transition: 'color 0.15s',
            }}
          >
            {t.label}
          </Link>
        )
      })}
    </div>
  )
}
