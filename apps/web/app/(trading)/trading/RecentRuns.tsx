// app/(trading)/trading/RecentRuns.tsx — 최근 실행
//
// 화면 파일 안에 인라인으로 있던 절을 부품으로 뗐다. 붙어 있을 때는 화면을 나눌 때마다
// 이 줄들이 따라다녀야 했고, 그래서 화면이 길어지는 만큼 고치기도 어려워졌다.
//
// 사유는 기계가 고칠 때 쓰라고 남긴 줄이다. 그것을 그대로 찍으면 두 가지가 한꺼번에
// 깨진다 — 읽는 사람이 해석을 떠맡고, 띄어쓰기 없는 긴 줄이 카드를 가로로 터뜨린다.
// 그래서 사람 말 한 줄만 펴 놓고 나머지는 접는다. **원문은 접힌 자리에 그대로 있다.**

import { formatKstDateTimeExact } from '@/lib/datetime/kst'
import {
  readRunReason, runStatusLabel, runStatusTone, type RunReasonTone,
} from '@/lib/trading/operator/run-reason'

export interface RecentRun {
  scheduledMinute: string
  status: string
  reason?: string | null
}

const TONE_COLOR: Record<RunReasonTone, string> = {
  blocked: 'var(--danger)',
  waiting: 'var(--warning)',
  ok: 'var(--text-muted)',
}

/** 띄어쓰기 없는 기계 글자가 칸을 밀어내지 않게 하는 한 벌 */
const WRAP = { minWidth: 0, overflowWrap: 'anywhere' as const, wordBreak: 'break-word' as const }

export default function RecentRuns({ rows }: { rows: readonly RecentRun[] }) {
  // 한 번도 안 돌았으면 빈 절을 그리지 않는다 — 제목만 있는 칸은 고장처럼 보인다
  if (rows.length === 0) return null
  return (
    <section className="card" style={{ minWidth: 0 }}>
      <h2
        style={{
          fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--text)',
          margin: 0, marginBottom: 'var(--space-3)',
        }}
      >
        최근 실행
      </h2>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 'var(--space-3)', minWidth: 0 }}>
        {rows.map((run) => {
          const view = readRunReason(run.reason)
          /** 머리줄 말고 더 볼 것이 있나. 없으면 접는 단추를 안 그린다 */
          const rest = Math.max(0, view.lines.length - 1) + view.unknown.length
          return (
            <li key={run.scheduledMinute} style={{ fontSize: 'var(--fs-sm)', display: 'grid', gap: 'var(--space-1)', ...WRAP }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 'var(--space-2)', ...WRAP }}>
                <span style={{ color: 'var(--text)' }}>{formatKstDateTimeExact(run.scheduledMinute)}</span>
                <span style={{ color: TONE_COLOR[runStatusTone(run.status)], fontWeight: 600 }}>
                  {runStatusLabel(run.status)}
                </span>
                {view.headline && (
                  <span style={{ color: TONE_COLOR[view.headline.tone], ...WRAP }}>{view.headline.text}</span>
                )}
              </div>
              {view.raw !== '' && (
                <details style={{ ...WRAP }}>
                  <summary style={{ cursor: 'pointer', color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>
                    {rest > 0 ? `자세히 · 그 밖에 ${rest}가지` : '자세히'}
                  </summary>
                  <ul style={{ margin: 'var(--space-2) 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 'var(--space-1)', ...WRAP }}>
                    {view.lines.map((l, i) => (
                      <li key={`${l.text}-${i}`} style={{ color: TONE_COLOR[l.tone], ...WRAP }}>{l.text}</li>
                    ))}
                  </ul>
                  {view.unknown.length > 0 && (
                    <p style={{ margin: 'var(--space-2) 0 0', color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', ...WRAP }}>
                      아직 사람 말로 못 읽는 표식 {view.unknown.length}개가 아래 원문에 있습니다
                    </p>
                  )}
                  <pre
                    style={{
                      margin: 'var(--space-2) 0 0', padding: 'var(--space-2)',
                      background: 'var(--surface-muted)',
                      color: 'var(--text-muted)', fontSize: 'var(--fs-xs)',
                      whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word',
                      minWidth: 0, maxWidth: '100%',
                    }}
                  >
                    {view.raw}
                  </pre>
                </details>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
