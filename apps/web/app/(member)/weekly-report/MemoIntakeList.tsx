// 주간보고 우측 인테이크 — 미처리 메모를 후보로 표시(체크 → 폼 반영 → reviewed 소진).
// 왜: 별도 경고 카드(구 WeeklyMemoReview)로 나무라는 대신, 작성 흐름(우측 패널)에 녹여 자연 소진한다.
'use client'

import { useEffect, useState, useTransition } from 'react'
import { StickyNote, Sparkles, Check } from 'lucide-react'
import { STALENESS_STYLE, relativeTime, type MemoListItem } from '@/components/ui/memo/memoUtils'
import { setMemoStatus } from '@/app/(member)/daily/actions'
import { generateWeeklyRows, type WeeklyRow } from '@/lib/weekly-report/generate-client'

interface MemoIntakeListProps {
  /** 반영 결과 행을 폼에 병합. (DailyTaskSelector와 동일 계약) */
  onReflect: (rows: WeeklyRow[]) => void
}

export default function MemoIntakeList({ onReflect }: MemoIntakeListProps) {
  const [items, setItems] = useState<MemoListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [, startTransition] = useTransition()

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/daily/memos?status=unreviewed', { cache: 'no-store' })
      if (res.ok) {
        const j = await res.json()
        const list = (j.items ?? []) as MemoListItem[]
        setItems(list)
        setSelectedIds(new Set(list.map((m) => m.id)))
      }
    } catch {
      /* noop */
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleReflect() {
    const selected = items.filter((m) => selectedIds.has(m.id))
    if (selected.length === 0) { setError('반영할 메모를 선택해 주세요'); return }
    setError('')
    setGenerating(true)
    try {
      const rows = await generateWeeklyRows(
        selected.map((m) => ({
          content: m.content,
          entry_type: 'note',
          log_date: m.log_date ?? m.logged_at.slice(0, 10),
        })),
      )
      onReflect(rows)
      // 소진: 반영한 메모는 reviewed 처리 + 목록에서 제거
      startTransition(async () => {
        await Promise.all(selected.map((m) => setMemoStatus(m.id, 'reviewed')))
      })
      const reflectedIds = new Set(selected.map((m) => m.id))
      setItems((prev) => prev.filter((m) => !reflectedIds.has(m.id)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI 반영 중 오류가 발생했습니다')
    } finally {
      setGenerating(false)
    }
  }

  function markReviewed(id: string) {
    startTransition(async () => { await setMemoStatus(id, 'reviewed') })
    setItems((prev) => prev.filter((m) => m.id !== id))
  }

  if (loading || items.length === 0) return null

  return (
    <div style={{ marginTop: 'var(--space-3)', border: 'var(--border-w-2) solid var(--border-color)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: '0.75rem 0.875rem', background: 'var(--color-bg)', fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-muted)' }}>
        <StickyNote size={14} color="var(--warning)" />
        <span>미처리 메모</span>
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', fontWeight: 400 }}>
          ({selectedIds.size}/{items.length})
        </span>
      </div>

      <div style={{ padding: 'var(--space-3)', borderTop: 'var(--border-w-2) solid var(--border-color)' }}>
        {error && (
          <div role="alert" style={{ padding: '0.5rem 0.7rem', background: 'var(--danger-bg)', border: 'var(--hairline) solid var(--danger-border)', borderRadius: 'var(--radius)', marginBottom: '0.6rem', fontSize: 'var(--fs-xs)', color: 'var(--danger)' }}>
            {error}
          </div>
        )}

        <div style={{ maxHeight: '260px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          {items.map((m) => {
            const st = STALENESS_STYLE[m.staleness]
            return (
              <label key={m.id}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)',
                  padding: '0.45rem 0.6rem', borderRadius: 'var(--radius)', cursor: 'pointer',
                  background: selectedIds.has(m.id) ? 'var(--brand-soft)' : 'var(--surface-bg)',
                  border: `var(--hairline) solid ${selectedIds.has(m.id) ? 'var(--brand-soft-2)' : 'var(--surface-muted)'}`,
                }}
              >
                <input type="checkbox"
                  checked={selectedIds.has(m.id)}
                  onChange={() => toggle(m.id)}
                  style={{ marginTop: '2px', flexShrink: 0, accentColor: 'var(--brand)' }}
                />
                <span title={st.label} style={{ width: 7, height: 7, borderRadius: '50%', background: st.dot, flexShrink: 0, marginTop: 6 }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text)', margin: 0, lineHeight: 1.45, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.content}
                  </p>
                  <span style={{ fontSize: 'var(--fs-2xs)', color: st.text }}>{relativeTime(m.logged_at)}</span>
                </div>
                <button type="button" onClick={(e) => { e.preventDefault(); markReviewed(m.id) }}
                  title="반영 없이 확인 처리"
                  style={{ background: 'none', border: 'var(--border-w-2) solid var(--border-color)', borderRadius: 'var(--radius-lg)', cursor: 'pointer', padding: '2px 4px', color: 'var(--success)', display: 'flex', flexShrink: 0 }}>
                  <Check size={12} />
                </button>
              </label>
            )
          })}
        </div>

        <div style={{ marginTop: '0.75rem', display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" onClick={handleReflect} disabled={generating || selectedIds.size === 0}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)',
              padding: '0.5rem 0.9rem', borderRadius: 'var(--radius)',
              background: generating || selectedIds.size === 0 ? 'var(--color-border)' : 'var(--brand)',
              color: generating || selectedIds.size === 0 ? 'var(--text-faint)' : '#fff',
              border: 'none', cursor: generating || selectedIds.size === 0 ? 'not-allowed' : 'pointer',
              fontSize: 'var(--fs-sm)', fontWeight: 600,
            }}>
            <Sparkles size={13} />
            {generating ? '반영 중…' : `폼에 반영 (${selectedIds.size})`}
          </button>
        </div>
      </div>
    </div>
  )
}
