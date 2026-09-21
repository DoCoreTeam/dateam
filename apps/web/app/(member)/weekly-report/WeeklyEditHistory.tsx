'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { History, RotateCcw } from 'lucide-react'
import NbModal from '@/components/ui/nb/NbModal'
import NbButton from '@/components/ui/nb/NbButton'
import { formatKstDateTimeShort } from '@/lib/datetime/kst'
import { restoreWeeklyReportSnapshot } from './actions'

export interface WeeklySnapshot {
  id: string
  week_start: string
  row_count: number
  reason: string
  taken_at: string
}

// 저장/삭제 사유 → 사용자 표기(라벨 SSOT은 이 파일에 국한 — 편집이력 전용).
const REASON_LABEL: Record<string, string> = {
  manual_save: '저장',
  restore: '복원',
  delete_all: '전체 삭제',
  delete_row: '항목 삭제',
  pre_deploy_seed: '기록 시작',
}

interface Props {
  weekStart: string
  snapshots: WeeklySnapshot[]
}

// 주간보고 편집 이력 — "작성분 절대 유실 0"의 사용자 복원 UI (마이그144 스냅샷).
// 저장/삭제 직전 전체 확정본이 스냅샷되므로, 어떤 이유로 내용이 사라져도 사용자가 스스로 되살린다.
export default function WeeklyEditHistory({ weekStart, snapshots }: Props) {
  const router = useRouter()
  const [target, setTarget] = useState<WeeklySnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (snapshots.length === 0) return null

  const handleRestore = () => {
    if (!target) return
    const taken = target.taken_at
    setError(null)
    startTransition(async () => {
      const res = await restoreWeeklyReportSnapshot(target.id)
      if (res.ok) {
        setTarget(null)
        setDone(`${formatKstDateTimeShort(taken)} 시점으로 되살렸습니다`)
        // ⚠️ router.refresh() 만으로는 화면이 안 바뀐다 — 작성폼은 rows 를 useState 로 한 번만
        // 받으므로, 서버가 복원된 내용을 새로 내려보내도 폼 key 가 같으면 예전 내용을 그대로
        // 들고 있다. 그 상태로 저장하면 방금 되살린 것이 도로 덮인다.
        // 그래서 복원한 주차 + 스냅샷 id 를 주소에 실어 폼을 다시 마운트시킨다.
        // 시각을 덧붙이는 이유: 같은 스냅샷을 두 번 되살리면(되살린 뒤 저장해 덮은 경우)
        // id 만으로는 주소가 그대로라 폼이 다시 마운트되지 않는다.
        const mark = `${target.id}-${Date.now().toString(36)}`
        router.replace(`/weekly-report?week=${res.weekStart}&restored=${mark}`, { scroll: false })
        router.refresh()
      } else {
        setError(res.error)
      }
    })
  }

  return (
    <details style={{ marginBottom: '1.75rem' }}>
      <summary
        style={{
          cursor: 'pointer',
          fontSize: 'var(--fs-sm)',
          fontWeight: 600,
          color: 'var(--text-muted)',
          padding: 'var(--space-2) 0',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
        }}
      >
        <History size={14} />
        편집 이력 · 되돌리기 ({snapshots.length})
      </summary>

      <div
        className="card"
        style={{ padding: 'var(--space-4)', marginTop: 'var(--space-3)', width: '100%', boxSizing: 'border-box' }}
      >
        <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', margin: '0 0 var(--space-3)' }}>
          저장·삭제 직전 상태가 자동 보관됩니다. 내용이 사라졌다면 아래에서 되살리세요.
        </p>
        {done && (
          <p role="status" style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--brand)', margin: '0 0 var(--space-3)' }}>
            {done} · 위 작성폼이 그 내용으로 바뀌었습니다
          </p>
        )}
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          {snapshots.map((s) => (
            <li
              key={s.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 'var(--space-3)',
                padding: 'var(--space-2) var(--space-3)',
                borderRadius: 'var(--radius)',
                border: 'var(--hairline) solid var(--border-light)',
                background: 'var(--surface-bg)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', minWidth: 0 }}>
                <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {formatKstDateTimeShort(s.taken_at)}
                </span>
                <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  {REASON_LABEL[s.reason] ?? s.reason} · {s.row_count}개 항목
                </span>
              </div>
              <NbButton
                variant="ghost"
                onClick={() => { setError(null); setTarget(s) }}
                style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: 'var(--fs-xs)' }}
              >
                <RotateCcw size={13} /> 되살리기
              </NbButton>
            </li>
          ))}
        </ul>
      </div>

      {target && (
        <NbModal
          title="이 시점으로 되돌리기"
          onClose={() => (pending ? undefined : setTarget(null))}
          maxWidth={440}
          footer={
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
              <NbButton variant="ghost" onClick={() => setTarget(null)} disabled={pending}>취소</NbButton>
              <NbButton variant="primary" onClick={handleRestore} disabled={pending}>
                {pending ? '되살리는 중…' : '되살리기'}
              </NbButton>
            </div>
          }
        >
          <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text)', margin: '0 0 var(--space-2)' }}>
            <strong>{formatKstDateTimeShort(target.taken_at)}</strong> 시점의 확정본({target.row_count}개 항목)으로 되돌립니다.
          </p>
          <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', margin: 0 }}>
            현재 내용은 되돌리기 직전 상태로 이력에 남으므로, 되돌리기 자체도 다시 취소할 수 있습니다. 유실되지 않습니다.
          </p>
          {error && (
            <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--danger)', marginTop: 'var(--space-3)' }}>{error}</p>
          )}
        </NbModal>
      )}
    </details>
  )
}
