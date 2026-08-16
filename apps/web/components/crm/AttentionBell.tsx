'use client'

// 지금 봐야 할 것 (dacrm FR-12)
//
// **알림을 쌓지 않는다.** 사건을 한 줄씩 모으면 읽음 처리만 하고 아무것도 안 하게 된다.
// 대신 **지금 상태**를 본다 — 할 일을 끝내면 사라지고, 제안을 확인하면 사라진다.
//
// **뱃지에 이유를 붙인다.** 숫자만 보이면 무엇이 급한지 몰라서 결국 안 누른다.

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Bell, AlertTriangle, Clock, Inbox, PauseCircle } from 'lucide-react'
import AXDotLoader from '@/components/ui/AXDotLoader'
import EmptyState from '@/components/ui/EmptyState'
import { KIND_LABEL, type AttentionKind, type AttentionItem } from '@/lib/crm/services/attention'
import styles from './attention-bell.module.css'

const ICON: Record<AttentionKind, React.ReactNode> = {
  overdue: <AlertTriangle size={14} />,
  due_today: <Clock size={14} />,
  suggestion: <Inbox size={14} />,
  stalled: <PauseCircle size={14} />,
}

export default function AttentionBell() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<AttentionItem[]>([])
  const [total, setTotal] = useState(0)
  const [summary, setSummary] = useState('')
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(true)
  const wrapRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/crm/attention')
      if (!res.ok) return
      const body = await res.json()
      setItems(body.items ?? [])
      setTotal(body.total ?? 0)
      setSummary(body.summary ?? '')
      setTruncated(!!body.truncated)
    } catch {
      // 부가 정보다 — 실패해도 헤더는 그려져야 한다
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // 열 때마다 다시 읽는다 — 그사이 할 일을 끝냈을 수 있다
  useEffect(() => { if (open) void load() }, [open, load])

  // 바깥을 누르면 닫는다. ESC 도 받는다 — 여는 법만 있으면 갇힌다
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.bell}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={total > 0 ? `지금 봐야 할 것 ${total}건` : '지금 봐야 할 것'}
        title={summary}
      >
        <Bell size={16} />
        {/* 숫자가 두 자리를 넘으면 뱃지가 아이콘을 밀어낸다 */}
        {total > 0 && <span className={styles.badge}>{total > 99 ? '99+' : total}</span>}
      </button>

      {open && (
        <div className={styles.panel} role="dialog" aria-label="지금 봐야 할 것">
          <div className={styles.head}>
            <strong className={styles.title}>지금 봐야 할 것</strong>
            {total > 0 && <span className={styles.summary}>{summary}</span>}
          </div>

          {loading ? <AXDotLoader /> : items.length === 0 ? (
            <EmptyState
              title="지금 볼 게 없어요"
              description="기한이 지난 할 일이나 확인 기다리는 제안이 생기면 여기에 뜹니다."
              icon={<Bell size={24} />}
            />
          ) : (
            <ul className={styles.list}>
              {items.map((it) => (
                <li key={`${it.kind}:${it.id}`}>
                  <Link href={it.href} className={styles.item} onClick={() => setOpen(false)}>
                    <span className={styles.icon} data-kind={it.kind}>{ICON[it.kind]}</span>
                    <span className={styles.body}>
                      <span className={styles.itemTitle}>{it.title}</span>
                      {/* 왜 떴는지 안 쓰면 사람은 무시하는 법부터 배운다 */}
                      <span className={styles.reason}>{it.reason}</span>
                    </span>
                    <span className={styles.kind}>{KIND_LABEL[it.kind]}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {truncated && (
            <p className={styles.more}>많아서 몇 개만 보여 드렸어요. 각 화면에서 전부 볼 수 있습니다.</p>
          )}
        </div>
      )}
    </div>
  )
}
