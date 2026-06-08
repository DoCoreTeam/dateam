'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Building2, AlertTriangle } from 'lucide-react'
import type { DailyLog } from '@/types/database'
import { STATUS_COLORS, PRIORITY_COLORS, type PriorityKey } from '@/lib/tokens/status-colors'
import { formatDueLabel, type DueTone } from '@/lib/dept-task-utils'
import NbBadge from '@/components/ui/nb/NbBadge'
import { listHomeDeptTasks, type DeptHomeResult, type DeptHomeViewMode } from '../dept-tasks/actions'

interface Props {
  initial: DeptHomeResult
  today: string
}

const DUE_TONE_COLOR: Record<DueTone, string> = {
  overdue: 'var(--danger)',
  today: 'var(--warning)',
  soon: 'var(--warning)',
  future: 'var(--text-faint)',
  none: 'var(--text-faint)',
}

const DISPLAY_LIMIT = 8

export default function HomeDeptTaskWidget({ initial, today }: Props) {
  const [data, setData] = useState<DeptHomeResult>(initial)
  const [pending, startTransition] = useTransition()

  function switchMode(mode: DeptHomeViewMode) {
    if (mode === data.mode || pending) return
    startTransition(async () => {
      const next = await listHomeDeptTasks({ mode, today })
      setData(next)
    })
  }

  const { items, counts, canViewDept, mode, nameMap, deptNameMap } = data
  const shown = items.slice(0, DISPLAY_LIMIT)
  const hasAlert = counts.overdue > 0 || counts.blocker > 0

  return (
    <section className="card home-dept-section" aria-label="부서 업무 요약">
      {/* 헤더 */}
      <div className="home-dept-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <Building2 size={16} color="var(--brand)" />
          <h2 className="tape-title" style={{ margin: 0 }}>부서 업무</h2>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          {canViewDept && (
            <div className="home-dept-toggle" role="tablist" aria-label="조회 모드">
              <button role="tab" aria-selected={mode === 'mine'} disabled={pending}
                className={mode === 'mine' ? 'active' : ''} onClick={() => switchMode('mine')}>내 담당</button>
              <button role="tab" aria-selected={mode === 'dept'} disabled={pending}
                className={mode === 'dept' ? 'active' : ''} onClick={() => switchMode('dept')}>부서 전체</button>
            </div>
          )}
          <Link href="/dept-tasks" style={{ fontSize: 'var(--fs-xs)', color: 'var(--brand)', textDecoration: 'none', fontWeight: 600, whiteSpace: 'nowrap' }}>
            전체보기 →
          </Link>
        </div>
      </div>

      {/* 요약 타일 — 일일요약 핵심 */}
      <div className="home-dept-tiles">
        <SummaryTile label="전체" value={counts.total} tone="neutral" />
        <SummaryTile label="기한경과" value={counts.overdue} tone="danger" />
        <SummaryTile label="블로커" value={counts.blocker} tone="warning" />
        <SummaryTile label="오늘" value={counts.dueToday} tone="info" />
      </div>

      {/* 알림 띠 — 경과/블로커 있을 때만 */}
      {hasAlert && (
        <div role="alert" className="home-dept-alert">
          <AlertTriangle size={14} />
          <span>
            {counts.overdue > 0 && <strong>기한 지난 업무 {counts.overdue}건</strong>}
            {counts.overdue > 0 && counts.blocker > 0 && ' · '}
            {counts.blocker > 0 && <strong>블로커 {counts.blocker}건</strong>}
            {' '}— 먼저 확인하세요
          </span>
        </div>
      )}

      {/* 리스트 */}
      {shown.length === 0 ? (
        <p className="home-dept-empty">{mode === 'mine' ? '내가 챙길 부서업무가 없습니다 ✅' : '미완료 부서업무가 없습니다 ✅'}</p>
      ) : (
        <ul className="home-dept-list">
          {shown.map((t) => <TaskRow key={t.id} task={t} today={today} nameMap={nameMap} deptNameMap={deptNameMap} showDept={mode === 'dept'} />)}
        </ul>
      )}

      {counts.total > shown.length && (
        <Link href="/dept-tasks" className="home-dept-more">+ {counts.total - shown.length}건 더 보기 →</Link>
      )}
    </section>
  )
}

function SummaryTile({ label, value, tone }: { label: string; value: number; tone: 'neutral' | 'danger' | 'warning' | 'info' }) {
  const color = tone === 'danger' ? 'var(--danger)' : tone === 'warning' ? 'var(--warning)' : tone === 'info' ? 'var(--info)' : 'var(--text)'
  const dim = value === 0 && tone !== 'neutral'
  return (
    <div className="home-dept-tile">
      <span className="home-dept-tile-num" style={{ color: dim ? 'var(--text-faint)' : color }}>{value}</span>
      <span className="home-dept-tile-label">{label}</span>
    </div>
  )
}

function TaskRow({ task, today, nameMap, deptNameMap, showDept }: {
  task: DailyLog; today: string; nameMap: Record<string, string>; deptNameMap: Record<string, string>; showDept: boolean
}) {
  const due = formatDueLabel(task.target_date, today)
  const prio = PRIORITY_COLORS[task.priority as PriorityKey]
  const assignee = task.assignee_user_id ? nameMap[task.assignee_user_id] ?? '—' : '미지정'
  const dept = task.department_id ? deptNameMap[task.department_id] ?? '' : ''
  return (
    <li className="home-dept-row">
      <Link href={`/dept-tasks?selected=${task.id}`} className="home-dept-row-link">
        <span className="home-dept-due" style={{ color: DUE_TONE_COLOR[due.tone] }}>{due.text}</span>
        <span className="home-dept-title">{task.content}</span>
        <span className="home-dept-meta">
          <NbBadge status={task.entry_type}>{STATUS_COLORS[task.entry_type]?.label ?? task.entry_type}</NbBadge>
          {prio && task.priority !== 'normal' && (
            <span className="home-dept-prio" style={{ color: prio.color, background: prio.bg, borderColor: prio.border }}>{prio.label}</span>
          )}
          <span className="home-dept-assignee">{showDept && dept ? `${dept} · ` : ''}{assignee}</span>
        </span>
        <span className="home-dept-progress" aria-label={`진행률 ${task.progress}%`}>
          <span className="home-dept-progress-bar" style={{ width: `${task.progress}%` }} />
        </span>
      </Link>
    </li>
  )
}
