'use client'

import { Pause, Play, Square } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import type { AnalysisSessionControl } from './session-actions'
import type { StreamProgress } from './useAnalysisStream'

interface Props {
  progress: StreamProgress | null
  itemCount: number
  control: AnalysisSessionControl
  mode: 'connecting' | 'live' | 'polling' | 'finished'
  streamError: string | null
  onPause: () => void
  onCancel: () => void
  onResume: () => void
}

const MODE_LABEL: Record<Props['mode'], string> = {
  connecting: '연결 중…',
  live: '실시간 진행 중',
  polling: '백그라운드 진행 확인 중',
  finished: '완료',
}

/** 목록 심층분석 v2 — 진행 표시는 서버 파생값(progress) 그대로 렌더(§ 클라 계산 금지). */
export default function AnalysisProgressBar({ progress, itemCount, control, mode, streamError, onPause, onCancel, onResume }: Props) {
  const total = progress?.total ?? itemCount
  const done = progress?.done ?? 0
  const error = progress?.error ?? 0
  const running = progress?.running ?? 0
  const pct = total > 0 ? Math.round(((done + error) / total) * 100) : 0

  return (
    <div className="card" style={{ padding: 'var(--space-4) var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
        <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
          완료 {done} · 분석중 {running} · 실패 {error} · 전체 {total}
          {' · '}
          <span style={{ color: 'var(--text-faint)' }}>{MODE_LABEL[mode]}</span>
        </span>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          {control === 'paused' ? (
            <NbButton
              variant="ghost"
              onClick={onResume}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: 'var(--fs-sm)', minHeight: 36 }}
            >
              <Play size={14} />
              재개
            </NbButton>
          ) : (
            control !== 'cancelled' &&
            mode !== 'finished' && (
              <NbButton
                variant="ghost"
                onClick={onPause}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: 'var(--fs-sm)', minHeight: 36 }}
              >
                <Pause size={14} />
                일시정지
              </NbButton>
            )
          )}
          {control !== 'cancelled' && mode !== 'finished' && (
            <NbButton
              variant="ghost"
              onClick={onCancel}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: 'var(--fs-sm)', minHeight: 36, color: 'var(--danger)' }}
            >
              <Square size={12} />
              취소
            </NbButton>
          )}
        </div>
      </div>

      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{ height: 6, borderRadius: 'var(--radius)', background: 'var(--surface-bg)', overflow: 'hidden' }}
      >
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            background: error > 0 ? 'var(--warning)' : 'var(--brand)',
            transition: 'width 300ms var(--ease-out-expo, ease-out)',
          }}
        />
      </div>

      {control === 'cancelled' && (
        <p style={{ margin: 0, fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>사용자 요청으로 취소되었습니다.</p>
      )}
      {streamError && (
        <p role="alert" style={{ margin: 0, fontSize: 'var(--fs-xs)', color: 'var(--danger)' }}>
          {streamError}
        </p>
      )}
    </div>
  )
}
