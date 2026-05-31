'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { LayoutGrid, X, Home, NotebookPen, CalendarDays, FileText, Briefcase, Users, TrendingUp, Inbox, DollarSign, Tag, Key, Code2, ChevronRight } from 'lucide-react'

const PAGES = [
  {
    group: '기본',
    items: [
      { href: '/home', label: '홈', icon: <Home size={14} /> },
      { href: '/daily', label: '일일업무', icon: <NotebookPen size={14} /> },
      { href: '/calendar', label: '캘린더', icon: <CalendarDays size={14} /> },
      { href: '/weekly-report', label: '주간보고', icon: <FileText size={14} /> },
    ],
  },
  {
    group: '프로젝트관리',
    items: [
      { href: '/accounts', label: '거래처', icon: <Briefcase size={14} /> },
      { href: '/contacts', label: '담당자', icon: <Users size={14} /> },
      { href: '/deals', label: '영업기회', icon: <TrendingUp size={14} /> },
      { href: '/lead-intake', label: '리드 인테이크', icon: <Inbox size={14} /> },
    ],
  },
  {
    group: '가격정책',
    items: [
      { href: '/pricing/gpu', label: 'GPU 관리', icon: <DollarSign size={14} /> },
      { href: '/pricing/catalog', label: '판매가격표', icon: <Tag size={14} /> },
    ],
  },
  {
    group: '개발자',
    items: [
      { href: '/api-keys', label: 'API Keys', icon: <Key size={14} /> },
      { href: '/develop', label: '개발자 문서', icon: <Code2 size={14} />, external: true },
    ],
  },
]

export default function QuickNav() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('keydown', esc) }
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(v => !v)}
        aria-label="전체 메뉴"
        title="모든 화면 바로가기"
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 12px', borderRadius: 8,
          border: '1px solid #e2e8f0',
          background: open ? '#f1f5f9' : 'white',
          color: '#475569', fontSize: 13, fontWeight: 500,
          cursor: 'pointer', transition: 'all .15s',
        }}
        onMouseEnter={e => { if (!open) e.currentTarget.style.background = '#f8fafc' }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.background = 'white' }}
      >
        <LayoutGrid size={15} />
        <span className="desktop-only" style={{ fontSize: 13 }}>전체 메뉴</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0,
          background: 'white', border: '1px solid #e2e8f0',
          borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
          zIndex: 200, minWidth: 240, overflow: 'hidden',
          animation: 'fadeInDown .12s ease',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #f1f5f9' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.06em', textTransform: 'uppercase' }}>모든 화면</span>
            <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 2, borderRadius: 4 }}>
              <X size={14} />
            </button>
          </div>
          <div style={{ padding: '8px 0' }}>
            {PAGES.map(({ group, items }) => (
              <div key={group}>
                <div style={{ padding: '6px 16px 2px', fontSize: 11, fontWeight: 600, color: '#cbd5e1', letterSpacing: '0.06em', textTransform: 'uppercase' }}>{group}</div>
                {items.map(({ href, label, icon, external }) => (
                  <Link
                    key={href}
                    href={href}
                    target={external ? '_blank' : undefined}
                    onClick={() => setOpen(false)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '8px 16px', color: '#374151', fontSize: 13,
                      textDecoration: 'none', transition: 'background .1s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = '#f8fafc'; e.currentTarget.style.color = '#6366f1' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#374151' }}
                  >
                    <span style={{ color: 'inherit', opacity: 0.7 }}>{icon}</span>
                    <span style={{ flex: 1 }}>{label}</span>
                    {external && <ChevronRight size={12} style={{ opacity: 0.4 }} />}
                  </Link>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
