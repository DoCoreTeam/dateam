// 일일업무 선택 행(체크박스 + 유형뱃지 + 내용) — DailyTaskSelector에서 추출한 presentational 컴포넌트.
'use client'

import type { DailyLog } from '@/types/database'

const ENTRY_TYPE_LABEL: Record<string, string> = {
  done: '완료',
  doing: '진행중',
  planned: '예정',
  blocker: '이슈',
  note: '메모',
}

const ENTRY_TYPE_COLOR: Record<string, string> = {
  done: 'var(--success)',
  doing: 'var(--info)',
  planned: 'var(--brand)',
  blocker: 'var(--danger)',
  note: 'var(--text-muted)',
}

interface DailyTaskItemProps {
  task: DailyLog
  checked: boolean
  onToggle: (id: string) => void
}

export default function DailyTaskItem({ task, checked, onToggle }: DailyTaskItemProps) {
  return (
    <label
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)',
        padding: '0.5rem 0.625rem', borderRadius: 'var(--radius)', cursor: 'pointer',
        background: checked ? 'var(--brand-soft)' : 'var(--surface-bg)',
        border: `var(--hairline) solid ${checked ? 'var(--brand-soft-2)' : 'var(--surface-muted)'}`,
        transition: 'background 120ms',
      }}
    >
      <input type="checkbox"
        checked={checked}
        onChange={() => onToggle(task.id)}
        style={{ marginTop: '2px', flexShrink: 0, accentColor: 'var(--brand)' }}
      />
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', marginBottom: '0.125rem' }}>
          <span style={{
            fontSize: 'var(--fs-2xs)', fontWeight: 600,
            color: ENTRY_TYPE_COLOR[task.entry_type] ?? 'var(--text-muted)',
            background: 'var(--color-bg)', border: 'var(--border-w-2) solid var(--border-color)',
            borderRadius: 'var(--radius)', padding: '0 0.3rem',
          }}>
            {ENTRY_TYPE_LABEL[task.entry_type] ?? task.entry_type}
          </span>
        </div>
        <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text)', margin: 0, lineHeight: 1.5 }}>
          {task.content}
        </p>
      </div>
    </label>
  )
}
