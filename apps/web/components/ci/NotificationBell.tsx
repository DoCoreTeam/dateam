'use client'

// components/ci/NotificationBell.tsx — 떡상 알림함 (설계서 §8.1)
//
// 알림 엔진이 만든 것을 읽는 유일한 화면이다.
// 저장만 하고 읽는 화면이 없으면 그 기능은 없는 것과 같다(실제 사고: 크리에이티브 분석 v0.7.429).

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, X } from 'lucide-react'
import type { ApiResponse } from '@/lib/ci/contracts'
import { formatKstDateTimeShort } from '@/lib/datetime/kst'

interface NotificationItem {
  id: string
  title: string
  body: string | null
  deeplink: string | null
  contentId: string | null
  sentAt: string
  readAt: string | null
}

interface Payload {
  items: NotificationItem[]
  unreadCount: number
}

/** 배지 숫자 상한 — 세 자리가 되면 숫자가 아니라 얼룩이 된다. */
const BADGE_MAX = 99
/** 미읽음 수 갱신 주기. 알림은 "매일 접속할 이유"라 셸에 항상 살아 있어야 한다. */
const POLL_MS = 60_000

export default function NotificationBell({ workspaceId }: { workspaceId: string }) {
  const router = useRouter()
  const ref = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<NotificationItem[]>([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/ci/notifications?limit=20`, {
        headers: { 'X-CI-Workspace': workspaceId },
      }).then((r) => r.json() as Promise<ApiResponse<Payload>>)
      if (!res.success) { setError(res.error.message); return }
      setItems(res.data.items)
      setUnread(res.data.unreadCount)
    } catch {
      setError('알림을 불러오지 못했습니다')
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  // 셸에 붙어 있는 컴포넌트라 화면을 옮겨 다녀도 살아 있다.
  // 탭이 숨겨져 있으면 굳이 묻지 않는다 — 백그라운드 탭 폴링은 순수 낭비다.
  useEffect(() => {
    void load()
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') void load()
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [load])

  useEffect(() => {
    if (!open) return
    const outside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', outside)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', outside)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  async function markRead(ids?: string[]) {
    // 낙관적 반영 — 읽음 표시가 서버 왕복만큼 늦으면 눌렀는지 아닌지 알 수 없다.
    const now = new Date().toISOString()
    setItems((prev) => prev.map((n) =>
      (!ids || ids.includes(n.id)) && !n.readAt ? { ...n, readAt: now } : n))
    setUnread((prev) => (ids ? Math.max(0, prev - ids.length) : 0))
    try {
      await fetch('/api/ci/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-CI-Workspace': workspaceId },
        body: JSON.stringify(ids ? { ids } : {}),
      })
    } catch {
      void load()   // 실패하면 서버 상태로 되돌린다. 읽은 척 남겨두지 않는다.
    }
  }

  function openItem(n: NotificationItem) {
    if (!n.readAt) void markRead([n.id])
    setOpen(false)
    if (n.deeplink) router.push(n.deeplink)
  }

  return (
    <div ref={ref} className="ci-bell">
      <button
        type="button"
        className={`ci-bell-btn${open ? ' is-open' : ''}`}
        aria-label={unread > 0 ? `알림 ${unread}건` : '알림'}
        aria-expanded={open}
        title="떡상 알림"
        onClick={() => { setOpen((v) => !v); if (!open) void load() }}
      >
        <Bell size={15} />
        {unread > 0 && (
          <span className="ci-bell-badge">{unread > BADGE_MAX ? `${BADGE_MAX}+` : unread}</span>
        )}
      </button>

      {open && (
        <div className="ci-bell-panel" role="dialog" aria-label="알림함">
          <div className="ci-bell-head">
            <span className="ci-bell-head-title">알림</span>
            <div className="ci-bell-head-actions">
              {unread > 0 && (
                <button type="button" className="btn-ghost" onClick={() => void markRead()}>
                  모두 읽음
                </button>
              )}
              <button type="button" className="ci-bell-close" aria-label="닫기" onClick={() => setOpen(false)}>
                <X size={14} />
              </button>
            </div>
          </div>

          <div className="ci-bell-list">
            {error && <p className="error-state">{error}</p>}
            {!error && loading && items.length === 0 && (
              <p className="ci-bell-empty">불러오는 중…</p>
            )}
            {!error && !loading && items.length === 0 && (
              <div className="ci-bell-empty">
                <p className="empty-state-title">아직 알림이 없어요</p>
                <p className="empty-state-desc">
                  관심 채널의 새 게시물이 평소 대비 기준 배수를 넘기면 여기로 알려드립니다.
                  기준은 설정 → 알림에서 바꿀 수 있어요.
                </p>
              </div>
            )}
            {items.map((n) => (
              <button
                key={n.id}
                type="button"
                className={`ci-bell-item${n.readAt ? '' : ' is-unread'}`}
                onClick={() => openItem(n)}
              >
                <span className="ci-bell-item-title">{n.title}</span>
                {n.body && <span className="ci-bell-item-body">{n.body}</span>}
                <span className="ci-basis">{formatKstDateTimeShort(n.sentAt)}</span>
              </button>
            ))}
          </div>

          {/* 없는 배달 경로를 있는 척하지 않는다 */}
          <p className="ci-bell-foot">알림은 앱 안에서만 전달됩니다</p>
        </div>
      )}
    </div>
  )
}
