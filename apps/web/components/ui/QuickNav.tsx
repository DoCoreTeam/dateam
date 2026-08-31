'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { LayoutGrid, X, Home, NotebookPen, CalendarDays, FileText, Briefcase, Users, TrendingUp, Inbox, DollarSign, Tag, Key, Code2, ChevronRight, Sparkles, Radar, Handshake } from 'lucide-react'
import { navLabel, canSeeNav, LEGACY_SALES_GROUP_LABEL } from '@/lib/nav/menu'

const PAGES = [
  {
    group: '기본',
    items: [
      { href: '/home', label: navLabel('/home'), icon: <Home size={14} /> },
      { href: '/daily', label: navLabel('/daily'), icon: <NotebookPen size={14} /> },
      { href: '/calendar', label: navLabel('/calendar'), icon: <CalendarDays size={14} /> },
      { href: '/weekly-report', label: navLabel('/weekly-report'), icon: <FileText size={14} /> },
      // 관리자 전용 — 사이드바에만 있어서 전체 메뉴로는 못 찾았다. 권한은 canSeeNav 가 본다
      { href: '/ai-chat', label: navLabel('/ai-chat'), icon: <Sparkles size={14} /> },
    ],
  },
  {
    /**
     * 영업 CRM — 전체 메뉴에서 빠져 있었다.
     *
     * 사이드바 링크는 admin 에게만 보이는데(레이아웃 필터), 전체 메뉴에도 없으면
     * CRM 멤버인 비관리자는 **주소를 직접 치는 것 말고 들어갈 방법이 없다.**
     * 접근 판정은 CRM 셸이 하므로 여기서는 길만 열어 둔다.
     */
    group: '영업',
    items: [
      { href: '/crm', label: navLabel('/crm'), icon: <Handshake size={14} /> },
    ],
  },
  {
    // 이름이 CRM 과 겹치는 것은 정상이다 — 구분은 묶음이 진다(menu.ts 주석)
    group: LEGACY_SALES_GROUP_LABEL,
    items: [
      { href: '/accounts', label: navLabel('/accounts'), icon: <Briefcase size={14} /> },
      { href: '/contacts', label: navLabel('/contacts'), icon: <Users size={14} /> },
      { href: '/deals', label: navLabel('/deals'), icon: <TrendingUp size={14} /> },
      { href: '/lead-intake', label: navLabel('/lead-intake'), icon: <Inbox size={14} /> },
    ],
  },
  {
    group: '가격정책',
    items: [
      { href: '/pricing/gpu', label: navLabel('/pricing/gpu'), icon: <DollarSign size={14} /> },
      { href: '/pricing/catalog', label: navLabel('/pricing/catalog'), icon: <Tag size={14} /> },
    ],
  },
  {
    // 사내 업무와 별개로 도는 독립 표면들. 개발자센터와 같은 성격이라 같은 자리에 둔다.
    group: '별도 서비스',
    items: [
      { href: '/ci', label: navLabel('/ci'), icon: <Radar size={14} /> },
      { href: '/api-keys', label: navLabel('/api-keys'), icon: <Key size={14} /> },
      { href: '/develop', label: navLabel('/develop'), icon: <Code2 size={14} />, external: true },
    ],
  },
]

/**
 * 전체 메뉴 — **권한을 받는다.**
 *
 * 예전엔 `isAdmin` 을 아예 받지 않아서, 사이드바에서 막은 화면이 여기서는 그대로 보였다.
 * 같은 경로에 두 메뉴가 **다른 권한**을 갖고 있던 셈이다. 판정은 사이드바와 같은 표
 * (`NAV_AUDIENCE`)를 읽는다 — 한 곳만 고치면 둘이 함께 바뀐다.
 */
export default function QuickNav({ isAdmin = false }: { isAdmin?: boolean }) {
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
          border: 'var(--border-w-2) solid var(--border-color)',
          background: open ? 'var(--surface-muted)' : 'white',
          color: 'var(--text-muted)', fontSize: 13, fontWeight: 500,
          cursor: 'pointer', transition: 'all .15s',
        }}
        onMouseEnter={e => { if (!open) e.currentTarget.style.background = 'var(--color-bg)' }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.background = 'white' }}
      >
        <LayoutGrid size={15} />
        <span className="desktop-only" style={{ fontSize: 13 }}>전체 메뉴</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0,
          background: 'white', border: 'var(--border-w-2) solid var(--border-color)',
          borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
          zIndex: 200, minWidth: 240, overflow: 'hidden',
          animation: 'fadeInDown .12s ease',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: 'var(--hairline) solid var(--surface-muted)' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-faint)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>모든 화면</span>
            <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', padding: 2, borderRadius: 4 }}>
              <X size={14} />
            </button>
          </div>
          <div style={{ padding: '8px 0' }}>
            {PAGES
              .map((g) => ({ ...g, items: g.items.filter((i) => canSeeNav(i.href, isAdmin)) }))
              .filter((g) => g.items.length > 0)
              .map(({ group, items }) => (
              <div key={group}>
                <div style={{ padding: '6px 16px 2px', fontSize: 11, fontWeight: 600, color: 'var(--border-subtle)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>{group}</div>
                {items.map(({ href, label, icon, external }) => (
                  <Link
                    key={href}
                    href={href}
                    target={external ? '_blank' : undefined}
                    onClick={() => setOpen(false)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '8px 16px', color: 'var(--text)', fontSize: 13,
                      textDecoration: 'none', transition: 'background .1s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg)'; e.currentTarget.style.color = 'var(--brand)' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text)' }}
                  >
                    <span style={{ color: 'inherit', opacity: 0.7 }}>{icon}</span>
                    <span style={{ flex: 1 }}>{label}</span>
                    {external && <ChevronRight size={12} style={{ opacity: 0.4 }} />}
                  </Link>
                ))}
              </div>
            ))}
            {/* 패치노트 — 라우트가 아니라 모달. window 이벤트로 MobileShell의 패치노트를 연다. */}
            <div>
              <div style={{ padding: '6px 16px 2px', fontSize: 11, fontWeight: 600, color: 'var(--border-subtle)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>정보</div>
              <button
                type="button"
                onClick={() => { setOpen(false); if (typeof window !== 'undefined') window.dispatchEvent(new Event('open-patchnotes')) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                  padding: '8px 16px', color: 'var(--text)', fontSize: 13,
                  background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', transition: 'background .1s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg)'; e.currentTarget.style.color = 'var(--brand)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text)' }}
              >
                <span style={{ color: 'inherit', opacity: 0.7 }}><Sparkles size={14} /></span>
                <span style={{ flex: 1 }}>패치노트</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
