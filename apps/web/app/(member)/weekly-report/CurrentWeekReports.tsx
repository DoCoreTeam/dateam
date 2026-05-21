'use client'

import { useState, useTransition } from 'react'
import { Trash2, AlertTriangle } from 'lucide-react'
import type { WeeklyReport } from '@/types/database'
import { deleteWeeklyReport } from './actions'

function RichContent({ html }: { html: string }) {
  if (!html || html === '<p></p>') return null
  if (html.startsWith('<')) {
    return (
      <div
        className="report-rich"
        style={{ fontSize: '0.875rem' }}
        // HTML from Tiptap editor controlled by the authenticated user themselves
        dangerouslySetInnerHTML={{ __html: html }}
      />
    )
  }
  return <p style={{ fontSize: '0.875rem', color: '#374151', margin: 0, lineHeight: 1.6 }}>{html}</p>
}

function CurrentWeekCard({ report }: { report: WeeklyReport }) {
  const [confirm, setConfirm] = useState(false)
  const [pending, startTransition] = useTransition()
  const [deleteError, setDeleteError] = useState<string | null>(null)

  function handleDelete() {
    setDeleteError(null)
    startTransition(async () => {
      const result = await deleteWeeklyReport(report.week_start, report.category)
      if (!result.ok) {
        setDeleteError(result.error)
      }
    })
  }

  return (
    <div style={{
      border: '1px solid #e2e8f0',
      borderRadius: '0.75rem',
      overflow: 'hidden',
      opacity: pending ? 0.5 : 1,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0.75rem 1rem',
        backgroundColor: '#f8fafc',
        borderBottom: confirm ? '1px solid #fca5a5' : 'none',
      }}>
        <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#334155' }}>{report.category}</span>
        {!confirm && (
          <button
            onClick={() => setConfirm(true)}
            disabled={pending}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
              fontSize: '0.75rem', padding: '0.25rem 0.625rem',
              background: '#fff1f2', color: '#dc2626',
              border: '1px solid #fecaca', borderRadius: '0.375rem', cursor: 'pointer',
            }}
          >
            <Trash2 size={12} />
            삭제
          </button>
        )}
      </div>

      {confirm && (
        <div style={{
          padding: '1rem', backgroundColor: '#fff1f2',
          borderTop: '1px solid #fca5a5',
        }}>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
            <AlertTriangle size={18} color="#dc2626" style={{ flexShrink: 0, marginTop: '1px' }} />
            <div>
              <p style={{ fontSize: '0.875rem', fontWeight: 700, color: '#b91c1c', margin: '0 0 0.25rem' }}>
                정말 삭제하시겠습니까?
              </p>
              <p style={{ fontSize: '0.8125rem', color: '#7f1d1d', margin: 0, lineHeight: 1.5 }}>
                <strong>"{report.category}"</strong> 항목의 성과·계획·이슈 데이터가 모두 영구 삭제됩니다.
                이 작업은 <strong>되돌릴 수 없습니다.</strong>
              </p>
            </div>
          </div>
          {deleteError && (
            <p style={{ fontSize: '0.8125rem', color: '#b91c1c', margin: '0 0 0.5rem', fontWeight: 600 }}>
              오류: {deleteError}
            </p>
          )}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={handleDelete}
              disabled={pending}
              style={{
                padding: '0.5rem 1rem', backgroundColor: '#dc2626', color: '#fff',
                border: 'none', borderRadius: '0.5rem', cursor: 'pointer',
                fontSize: '0.875rem', fontWeight: 700,
              }}
            >
              {pending ? '삭제 중...' : '영구 삭제'}
            </button>
            <button
              onClick={() => { setConfirm(false); setDeleteError(null) }}
              disabled={pending}
              style={{
                padding: '0.5rem 1rem', backgroundColor: '#fff', color: '#475569',
                border: '1px solid #cbd5e1', borderRadius: '0.5rem', cursor: 'pointer',
                fontSize: '0.875rem',
              }}
            >
              취소
            </button>
          </div>
        </div>
      )}

      {!confirm && (
        <div style={{ padding: '0.75rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {report.performance && report.performance !== '<p></p>' && (
            <div>
              <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#6366f1', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 0.2rem' }}>성과</p>
              <RichContent html={report.performance} />
            </div>
          )}
          {report.plan && report.plan !== '<p></p>' && (
            <div>
              <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#0891b2', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 0.2rem' }}>계획</p>
              <RichContent html={report.plan} />
            </div>
          )}
          {report.issues && report.issues !== '<p></p>' && (
            <div>
              <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#dc2626', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 0.2rem' }}>이슈/협조사항</p>
              <RichContent html={report.issues} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface CurrentWeekReportsProps {
  reports: WeeklyReport[]
}

export default function CurrentWeekReports({ reports }: CurrentWeekReportsProps) {
  if (reports.length === 0) return null

  return (
    <div style={{ marginTop: '1.75rem' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.5rem',
        marginBottom: '0.875rem', padding: '0.625rem 0.875rem',
        backgroundColor: '#fffbeb', border: '1px solid #fde68a',
        borderRadius: '0.625rem',
      }}>
        <AlertTriangle size={14} color="#d97706" />
        <span style={{ fontSize: '0.8125rem', color: '#92400e', fontWeight: 500 }}>
          이번 주 저장된 항목입니다. 삭제 시 복구가 불가능합니다.
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {reports.map((r) => (
          <CurrentWeekCard key={r.id} report={r} />
        ))}
      </div>
    </div>
  )
}
