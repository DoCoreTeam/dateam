'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

interface NavItem {
  href: string
  label: string
  icon: React.ReactNode
}

interface SidebarProps {
  items: NavItem[]
  footer?: React.ReactNode
}

export default function Sidebar({ items, footer }: SidebarProps) {
  const pathname = usePathname()

  return (
    <aside
      style={{
        width: '220px',
        minHeight: '100vh',
        backgroundColor: '#1e293b',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
      }}
    >
      {/* 브랜드 */}
      <div
        style={{
          padding: '1.5rem 1.25rem',
          borderBottom: '1px solid rgb(255 255 255 / 0.06)',
        }}
      >
        <span style={{ color: 'white', fontSize: '0.9375rem', fontWeight: 700, letterSpacing: '-0.02em' }}>
          AX사업본부
        </span>
      </div>

      {/* 네비게이션 */}
      <nav style={{ flex: 1, padding: '0.75rem 0.75rem' }} aria-label="주 메뉴">
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
          {items.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all',
                    isActive
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-white hover:bg-white/5'
                  )}
                  style={{ textDecoration: 'none' }}
                >
                  <span style={{ flexShrink: 0, opacity: isActive ? 1 : 0.7 }}>{item.icon}</span>
                  {item.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* 푸터 */}
      {footer && (
        <div style={{ padding: '0.75rem', borderTop: '1px solid rgb(255 255 255 / 0.06)' }}>
          {footer}
        </div>
      )}
    </aside>
  )
}
