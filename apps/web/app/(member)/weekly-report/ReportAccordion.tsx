'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, Trash2, Pencil } from 'lucide-react'
import type { WeeklyReport } from '@/types/database'
import { deleteWeeklyReport } from './actions'

interface WeekGroup {
  weekStart: string
  reports: WeeklyReport[]
}

interface ReportAccordionProps {
  groups: WeekGroup[]
}

function RichContent({ html }: { html: string }) {
  const isHtml = html.startsWith('<')
  if (isHtml) {
    return (
      <div
        className="report-rich"
        // HTML comes from Tiptap editor controlled by the authenticated user themselves
        dangerouslySetInnerHTML={{ __html: html }}
      />
    )
  }
  return (
    <p style={{ fontSize: '0.875rem', color: '#374151', margin: 0, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
      {html}
    </p>
  )
}

function ReportCard({ report, onDelete }: { report: WeeklyReport; onDelete: () => void }) {
  const [pending, startTransition] = useTransition()
  const [confirmDelete, setConfirmDelete] = useState(false)

  function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    startTransition(async () => {
      await deleteWeeklyReport(report.week_start, report.category)
      setConfirmDelete(false)
    })
  }

  return (
    <div
      style={{
        padding: '1rem',
        backgroundColor: '#f8fafc',
        borderRadius: '0.75rem',
        border: '1px solid #f1f5f9',
        opacity: pending ? 0.5 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <span className="badge badge-indigo">{report.category}</span>
        <div style={{ display: 'flex', gap: '0.375rem' }}>
          {confirmDelete ? (
            <>
              <button
                onClick={handleDelete}
                disabled={pending}
                style={{
                  fontSize: '0.75rem', padding: '0.25rem 0.625rem', background: '#dc2626',
                  color: '#fff', border: 'none', borderRadius: '0.3rem', cursor: 'pointer', fontWeight: 600,
                }}
              >
                삭제 확인
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                style={{
                  fontSize: '0.75rem', padding: '0.25rem 0.625rem', background: '#e2e8f0',
                  color: '#475569', border: 'none', borderRadius: '0.3rem', cursor: 'pointer',
                }}
              >
                취소
              </button>
            </>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                fontSize: '0.75rem', padding: '0.25rem 0.625rem', background: '#f1f5f9',
                color: '#64748b', border: 'none', borderRadius: '0.3rem', cursor: 'pointer',
              }}
            >
              <Trash2 size={11} />
              삭제
            </button>
          )}
        </div>
      </div>

      {report.performance && (
        <div style={{ marginBottom: '0.625rem' }}>
          <p style={{ fontSize: '0.75rem', fontWeight: 600, color: '#6366f1', margin: '0 0 0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            성과
          </p>
          <RichContent html={report.performance} />
        </div>
      )}

      {report.plan && (
        <div style={{ marginBottom: '0.625rem' }}>
          <p style={{ fontSize: '0.75rem', fontWeight: 600, color: '#0891b2', margin: '0 0 0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            계획
          </p>
          <RichContent html={report.plan} />
        </div>
      )}

      {report.issues && (
        <div>
          <p style={{ fontSize: '0.75rem', fontWeight: 600, color: '#dc2626', margin: '0 0 0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            이슈/협조사항
          </p>
          <RichContent html={report.issues} />
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
      <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#94a3b8', fontSize: '0.875rem' }}>
        작성된 주간보고가 없습니다
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {groups.map((group) => {
        const isOpen = openWeeks.has(group.weekStart)
        const weekLabel = new Date(group.weekStart).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })

        return (
          <div key={group.weekStart} className="card" style={{ overflow: 'hidden' }}>
            <div
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '1rem 1.25rem', borderBottom: isOpen ? '1px solid #e2e8f0' : 'none',
              }}
            >
              <button
                onClick={() => toggleWeek(group.weekStart)}
                aria-expanded={isOpen}
                style={{
                  flex: 1, display: 'flex', alignItems: 'center', gap: '0.75rem',
                  background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left',
                }}
              >
                <span style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a' }}>{weekLabel} 주</span>
                <span className="badge badge-slate">{group.reports.length}건</span>
                <ChevronDown
                  size={16}
                  color="#94a3b8"
                  style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 200ms', marginLeft: '0.25rem' }}
                />
              </button>
              <button
                onClick={() => handleEdit(group.weekStart)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                  fontSize: '0.8125rem', fontWeight: 500, padding: '0.375rem 0.75rem',
                  background: '#eef2ff', color: '#4338ca', border: 'none',
                  borderRadius: '0.5rem', cursor: 'pointer', flexShrink: 0,
                }}
              >
                <Pencil size={12} />
                수정
              </button>
            </div>

            {isOpen && (
              <div style={{ padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {group.reports.map((report) => (
                  <ReportCard key={report.id} report={report} onDelete={() => {}} />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
