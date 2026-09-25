'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { LayoutGrid, X, Home, NotebookPen, CalendarDays, FileText, Briefcase, Users, TrendingUp, Inbox, DollarSign, Tag, Key, Code2, CandlestickChart, ChevronRight, Sparkles, Radar, Handshake, FileSearch } from 'lucide-react'
import { QUICKNAV_LINKS } from '@/lib/nav/menu'
import { useIsOpen } from '@/lib/access/open-context'

/**
 * 전체 메뉴 그림표 — **이름과 주소는 여기 없다.**
 *
 * 목록은 `lib/nav/menu.ts` 의 `QUICKNAV_LINKS` 가 주고, 그것은 등재부에서 나온다.
 * 예전엔 이 파일이 자기 href 목록을 들고 있어서 사이드바 목록과 **두 벌**이었다 —
 * 그래서 같은 경로가 두 이름이 되고, 한쪽에만 있는 화면이 생겼다.
 * 여기서 정하는 것은 그림뿐이다. 빠진 그림은 `lib/nav/menu.test.ts` 가 잡는다.
 */
const QUICKNAV_ICON: Record<string, React.ReactNode> = {
  '/home': <Home size={14} />,
  '/daily': <NotebookPen size={14} />,
  '/calendar': <CalendarDays size={14} />,
  '/weekly-report': <FileText size={14} />,
  '/crm': <Handshake size={14} />,
  '/accounts': <Briefcase size={14} />,
  '/contacts': <Users size={14} />,
  '/deals': <TrendingUp size={14} />,
  '/lead-intake': <Inbox size={14} />,
  '/pricing/gpu': <DollarSign size={14} />,
  '/pricing/catalog': <Tag size={14} />,
  '/ci': <Radar size={14} />,
  '/ai': <Sparkles size={14} />,
  '/rfp': <FileSearch size={14} />,
  '/api-keys': <Key size={14} />,
  '/trading': <CandlestickChart size={14} />,
  '/develop': <Code2 size={14} />,
}

const PAGES = QUICKNAV_LINKS.map((section) => ({
  group: section.label,
  items: section.items.map((link) => ({ ...link, icon: QUICKNAV_ICON[link.href] })),
}))

/**
 * 전체 메뉴 — **열린 주소를 받는다.**
 *
 * 예전엔 `isAdmin` 을 아예 받지 않아서, 사이드바에서 막은 화면이 여기서는 그대로 보였다.
 * 그 다음 판은 `canSeeNav`(표 하나)를 읽었는데, 라우트는 다른 것을 읽어서 **메뉴에는
 * 보이는데 들어가면 막히는 문**이 넷 남았다(실측 2026-09-21).
 *
 * 이제 여기서는 판정을 **안 한다.** 셸(`AppShell`)이 서버에서 한 번 재서 컨텍스트로 깔고
 * 여기는 읽기만 한다 — 막는 쪽과 같은 함수의 답이라 갈릴 자리가 없다.
 * props 로 받던 것을 컨텍스트로 바꾼 이유는 `lib/access/open-context.tsx` 에 있다:
 * 넘기는 것을 잊은 자리에 죽은 문이 남기 때문이다.
 */
export default function QuickNav() {
  const isOpen = useIsOpen()
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
              .map((g) => ({ ...g, items: g.items.filter((i) => isOpen(i.href)) }))
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
