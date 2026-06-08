'use client'

import { useState, useRef, useTransition } from 'react'
import Link from 'next/link'
import { addDailyLog } from '../daily/actions'
import type { DailyLog, DailyLogEntryType } from '@/types/database'
import { NotebookPen, Plus } from 'lucide-react'

import { STATUS_LIST } from '@/lib/tokens/status-colors'
const ENTRY_TYPES = STATUS_LIST

interface Props {
  todayStr: string
  initialLogs: DailyLog[]
}

export default function HomeQuickEntry({ todayStr, initialLogs }: Props) {
  const [content, setContent] = useState('')
  const [entryType, setEntryType] = useState<DailyLogEntryType>('doing')
  const [isPending, startTransition] = useTransition()
  const [successMsg, setSuccessMsg] = useState('')
  const [logs, setLogs] = useState<DailyLog[]>(initialLogs)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const counts = {
    done:    logs.filter((l) => l.entry_type === 'done').length,
    doing:   logs.filter((l) => l.entry_type === 'doing').length,
    planned: logs.filter((l) => l.entry_type === 'planned').length,
  }
  const total = logs.length

  const handleSubmit = () => {
    if (!content.trim()) return
    const captured = content.trim()
    startTransition(async () => {
      const result = await addDailyLog(captured, entryType, todayStr)
      if (result.ok) {
        setContent('')
        setLogs((prev) => [...prev, result.data])
        setSuccessMsg('등록됐습니다!')
        setTimeout(() => setSuccessMsg(''), 2000)
        textareaRef.current?.focus()
      }
    })
  }

  return (
    <div className="card" style={{ padding: 'var(--space-5) var(--space-6)' }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.875rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <NotebookPen size={15} color="var(--brand)" />
          <h3 className="tape-title" style={{ margin: 0 }}>오늘 업무</h3>
        </div>
        <Link href={`/daily?date=${todayStr}`} style={{ fontSize: 'var(--fs-xs)', color: 'var(--brand)', textDecoration: 'none', fontWeight: 600 }}>
          상세 보기 →
        </Link>
      </div>

      {/* 통계 배지 */}
      {total > 0 && (
        <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: '0.875rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {(Object.entries(counts) as [string, number][])
            .filter(([, cnt]) => cnt > 0)
            .map(([key, cnt]) => {
              const t = ENTRY_TYPES.find((e) => e.value === key)!
              return (
                <span key={key} style={{
                  padding: '0.2rem 0.6rem', borderRadius: '999px',
                  background: t.bg, color: t.color, fontSize: 'var(--fs-xs)', fontWeight: 600,
                }}>
                  {cnt} {t.label}
                </span>
              )
            })}
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>총 {total}건</span>
        </div>
      )}

      {/* 최근 로그 미리보기 */}
      {logs.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', marginBottom: '0.875rem' }}>
          {logs.slice(-3).reverse().map((log) => {
            const t = ENTRY_TYPES.find((e) => e.value === log.entry_type)
            return (
              <div key={log.id} style={{ display: 'flex', gap: '0.4rem', alignItems: 'flex-start' }}>
                <span style={{ fontSize: 'var(--fs-2xs)', color: t?.color, fontWeight: 700, flexShrink: 0, marginTop: '0.125rem' }}>
                  {t?.label}
                </span>
                <span style={{
                  fontSize: 'var(--fs-sm)', color: 'var(--text)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
                }}>
                  {log.content}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* 퀵 등록 폼 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit() }}
          placeholder="업무 내용 입력 (Cmd/Ctrl+Enter 등록)"
          rows={2}
          style={{
            width: '100%', padding: '0.625rem 0.75rem',
            border: 'var(--border-w-2) solid var(--border-color)', borderRadius: 'var(--radius)',
            fontSize: 'var(--fs-base)', color: 'var(--text)', resize: 'none',
            fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
            background: 'var(--color-bg)', lineHeight: 1.5,
          }}
        />
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          <select
            value={entryType}
            onChange={(e) => setEntryType(e.target.value as DailyLogEntryType)}
            style={{
              flex: 1, padding: 'var(--space-2) var(--space-2)', border: 'var(--border-w-2) solid var(--border-color)',
              borderRadius: 'var(--radius)', fontSize: 'var(--fs-sm)', background: 'var(--color-bg)',
              color: 'var(--text)', cursor: 'pointer', fontFamily: 'inherit', minHeight: 36,
            }}
          >
            {ENTRY_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          <button
            onClick={handleSubmit}
            disabled={isPending || !content.trim()}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.375rem',
              padding: 'var(--space-2) var(--space-4)', border: 'none', borderRadius: 'var(--radius)',
              background: 'var(--brand)', color: '#ffffff', fontSize: 'var(--fs-sm)',
              fontWeight: 600, cursor: isPending || !content.trim() ? 'not-allowed' : 'pointer',
              opacity: isPending || !content.trim() ? 0.5 : 1, minHeight: 36, flexShrink: 0,
            }}
          >
            <Plus size={14} />
            {isPending ? '등록 중' : '등록'}
          </button>
        </div>
        {successMsg && (
          <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--success)', margin: 0, fontWeight: 500 }}>{successMsg}</p>
        )}
      </div>
    </div>
  )
}
