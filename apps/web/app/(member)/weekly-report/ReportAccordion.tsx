'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, Trash2, Pencil, AlertTriangle } from 'lucide-react'
import type { WeeklyReport } from '@/types/database'
import { deleteWeeklyReport } from './actions'
import RichText from '@/components/ui/RichText'

interface WeekGroup {
  weekStart: string
  reports: WeeklyReport[]
}

interface ReportAccordionProps {
  groups: WeekGroup[]
}

function RichContent({ html }: { html: string }) {
  return <RichText html={html} style={{ fontSize: 'var(--fs-base)', lineHeight: 1.6 }} />
}

function ReportCard({ report }: { report: WeeklyReport }) {
  const [pending, startTransition] = useTransition()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  function handleDelete() {
    setDeleteError(null)
    startTransition(async () => {
      const result = await deleteWeeklyReport(report.week_start, report.category, report.id)
      if (!result.ok) {
        setDeleteError(result.error)
      }
    })
  }

  return (
    <div
      style={{
        borderRadius: 'var(--radius)',
        border: confirmDelete ? 'var(--hairline) solid var(--danger-border)' : 'var(--hairline) solid var(--surface-muted)',
        overflow: 'hidden',
        opacity: pending ? 0.5 : 1,
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: 'var(--space-3) var(--space-4)', backgroundColor: 'var(--color-bg)',
        borderBottom: confirmDelete ? 'var(--hairline) solid var(--danger-border)' : 'none',
      }}>
        <span className="badge badge-indigo">{report.category}</span>
        {!confirmDelete && (
          <button
            onClick={() => setConfirmDelete(true)}
            disabled={pending}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)',
              fontSize: 'var(--fs-xs)', padding: '0.25rem 0.625rem',
              background: 'var(--danger-bg)', color: 'var(--danger)',
              border: 'var(--hairline) solid var(--danger-border)', borderRadius: 'var(--radius)', cursor: 'pointer',
            }}
          >
            <Trash2 size={12} />
            삭제
          </button>
        )}
      </div>

      {confirmDelete && (
        <div style={{ padding: 'var(--space-4)', backgroundColor: 'var(--danger-bg)', borderTop: 'var(--hairline) solid var(--danger-border)' }}>
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
            <AlertTriangle size={18} color="var(--danger)" style={{ flexShrink: 0, marginTop: '1px' }} />
            <div>
              <p style={{ fontSize: 'var(--fs-base)', fontWeight: 700, color: 'var(--danger)', margin: '0 0 0.25rem' }}>
                정말 삭제하시겠습니까?
              </p>
              <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--danger)', margin: 0, lineHeight: 1.5 }}>
                <strong>&quot;{report.category}&quot;</strong> 항목의 성과·계획·이슈 데이터가 모두 영구 삭제됩니다.
                이 작업은 <strong>되돌릴 수 없습니다.</strong>
              </p>
            </div>
          </div>
          {deleteError && (
            <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--danger)', margin: '0 0 0.5rem', fontWeight: 600 }}>
              오류: {deleteError}
            </p>
          )}
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button
              onClick={handleDelete}
              disabled={pending}
              style={{
                padding: 'var(--space-2) var(--space-4)', backgroundColor: 'var(--danger)', color: '#fff',
                border: 'none', borderRadius: 'var(--radius)', cursor: 'pointer',
                fontSize: 'var(--fs-base)', fontWeight: 700,
              }}
            >
              {pending ? '삭제 중...' : '영구 삭제'}
            </button>
            <button
              onClick={() => { setConfirmDelete(false); setDeleteError(null) }}
              disabled={pending}
              style={{
                padding: 'var(--space-2) var(--space-4)', backgroundColor: '#fff', color: 'var(--text-muted)',
                border: 'var(--hairline) solid var(--border-color)', borderRadius: 'var(--radius)', cursor: 'pointer',
                fontSize: 'var(--fs-base)',
              }}
            >
              취소
            </button>
          </div>
        </div>
      )}

      {!confirmDelete && (
        <div style={{ padding: 'var(--space-3) var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {report.performance && (
            <div>
              <p style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--brand)', margin: '0 0 0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                성과
              </p>
              <RichContent html={report.performance} />
            </div>
          )}
          {report.plan && (
            <div>
              <p style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--info)', margin: '0 0 0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                계획
              </p>
              <RichContent html={report.plan} />
            </div>
          )}
          {report.issues && (
            <div>
              <p style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--danger)', margin: '0 0 0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                이슈/협조사항
              </p>
              <RichContent html={report.issues} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function ReportAccordion({ groups }: ReportAccordionProps) {
  const router = useRouter()
  const [openWeeks, setOpenWeeks] = useState<Set<string>>(
    new Set(groups.length > 0 ? [groups[0].weekStart] : [])
  )

  function toggleWeek(weekStart: string) {
    setOpenWeeks((prev) => {
      const next = new Set(prev)
      if (next.has(weekStart)) next.delete(weekStart)
      else next.add(weekStart)
      return next
    })
  }

  function handleEdit(weekStart: string) {
    router.push(`/weekly-report?tab=mine&editWeek=${weekStart}`)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (groups.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 'var(--space-12) var(--space-4)', color: 'var(--text-faint)', fontSize: 'var(--fs-base)' }}>
        작성된 주간보고가 없습니다
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {groups.map((group) => {
        const isOpen = openWeeks.has(group.weekStart)
        const weekLabel = new Date(group.weekStart).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })

        return (
          <div key={group.weekStart} className="card" style={{ overflow: 'hidden' }}>
            <div
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: 'var(--space-4) var(--space-5)', borderBottom: isOpen ? 'var(--border-w-2) solid var(--border-color)' : 'none',
              }}
            >
              <button
                onClick={() => toggleWeek(group.weekStart)}
                aria-expanded={isOpen}
                style={{
                  flex: 1, display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                  background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left',
                }}
              >
                <span style={{ fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--text)' }}>{weekLabel} 주</span>
                <span className="badge badge-slate">{group.reports.length}건</span>
                <ChevronDown
                  size={16}
                  color="var(--text-faint)"
                  style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 200ms', marginLeft: '0.25rem' }}
                />
              </button>
              <button
                onClick={() => handleEdit(group.weekStart)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                  fontSize: 'var(--fs-sm)', fontWeight: 500, padding: '0.375rem 0.75rem',
                  background: 'var(--brand-soft)', color: 'var(--brand-dark)', border: 'none',
                  borderRadius: 'var(--radius)', cursor: 'pointer', flexShrink: 0,
                }}
              >
                <Pencil size={12} />
                수정
              </button>
            </div>

            {isOpen && (
              <div style={{ padding: 'var(--space-4) var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                {group.reports.map((report) => (
                  <ReportCard key={report.id} report={report} />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
