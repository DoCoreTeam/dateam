'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { X, FileText } from 'lucide-react'
import { useEscClose } from '@/lib/use-esc-close'
import { CHANGELOG_SEEN_KEY, isChangelogPending } from '@/lib/changelog/entries'

interface Props {
  /** 이번 주 week_start(월요일) — localStorage 억제 키로도 사용 */
  weekStart: string
}

// 주간보고 작성 안내 모달(독촉 아닌 안내 톤). 이번 주 미작성 시 로그인 후 1회 노출,
// 닫으면 해당 주차 동안 localStorage로 재안내 차단.
export default function WeeklyReminderModal({ weekStart }: Props) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    try {
      // 첫 접속 업데이트 안내(ChangelogModal)와 동시 노출 충돌 방지 — changelog가 뜰 차례면 양보.
      // (changelog는 닫으면 seen 기록 → 다음 이동 때 이 모달이 정상 노출)
      if (isChangelogPending(localStorage.getItem(CHANGELOG_SEEN_KEY))) return
      if (!localStorage.getItem(`weekly_reminder_seen_${weekStart}`)) setOpen(true)
    } catch {
      setOpen(true)
    }
  }, [weekStart])

  const close = () => {
    try { localStorage.setItem(`weekly_reminder_seen_${weekStart}`, '1') } catch { /* noop */ }
    setOpen(false)
  }
  useEscClose(close, open)

  if (!open) return null

  return (
    <div onClick={close} className="modal-backdrop">
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="주간보고 작성 안내"
        className="modal-card"
        style={{ width: 'min(420px, 100%)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--space-4) var(--space-5)', borderBottom: 'var(--hairline) solid var(--border-color)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <FileText size={18} style={{ color: 'var(--brand)' }} />
            <span className="tape-title" style={{ fontSize: 'var(--fs-lg)' }}>주간보고 작성 안내</span>
          </div>
          <button onClick={close} aria-label="닫기" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: 'var(--space-1)' }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: 'var(--space-5)' }}>
          <p style={{ margin: 0, fontSize: 'var(--fs-base)', color: 'var(--text)', lineHeight: 1.6 }}>
            이번 주 주간보고가 아직 작성되지 않았어요. 🙂<br />
            취합 전에 작성하면 <strong style={{ color: 'var(--success)' }}>정시</strong>로 기록됩니다.
          </p>
          <p style={{ margin: 'var(--space-2) 0 0', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            잊지 말고 이번 주 성과·계획·이슈를 남겨주세요.
          </p>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', padding: 'var(--space-4) var(--space-5)', borderTop: 'var(--hairline) solid var(--border-color)' }}>
          <button onClick={close} style={{ padding: '0.5rem 0.9rem', fontSize: 'var(--fs-sm)', fontWeight: 600, borderRadius: 'var(--radius)', border: 'var(--border-w-2) solid var(--border-color)', background: '#fff', color: 'var(--text-muted)', cursor: 'pointer' }}>
            나중에
          </button>
          <Link href="/weekly-report" onClick={close} style={{ padding: '0.5rem 0.9rem', fontSize: 'var(--fs-sm)', fontWeight: 700, borderRadius: 'var(--radius)', background: 'var(--brand)', color: '#fff', textDecoration: 'none' }}>
            작성하러 가기
          </Link>
        </div>
      </div>
    </div>
  )
}
