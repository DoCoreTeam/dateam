'use client'

import { useState } from 'react'
import { Check, Copy, RefreshCw } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import AXDotLoader from '@/components/ui/AXDotLoader'
import MarkdownMessage from '@/app/admin/ai-chat/MarkdownMessage'
import ExportMenu, { type ExportFormat } from './ExportMenu'
import type { SessionCoverage } from './session-item-actions'

export type { ExportFormat }

interface Props {
  synthStatus: string
  synthText: string | null
  coverage: SessionCoverage | null
  canExport: boolean
  onExport: (format: ExportFormat) => void
  /** 다시 취합 — 항목 결과로 종합을 재생성(재시도 후 낡은 취합본 갱신). */
  onResynthesize?: () => void
}

/** 목록 심층분석 v2 — 완성형 취합 뷰(마크다운 렌더 + 커버리지 배지) + 다운로드 드롭다운·복사. */
export default function AnalysisSynthPanel({ synthStatus, synthText, coverage, canExport, onExport, onResynthesize }: Props) {
  const [copied, setCopied] = useState(false)

  function copySynth(): void {
    navigator.clipboard.writeText(synthText ?? '').catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  if (synthStatus === 'pending' && !synthText) return null

  return (
    <div className="card" style={{ padding: 'var(--space-5)', borderColor: 'var(--brand)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <span className="tape-title">종합 인사이트</span>
          {coverage && (
            <span
              style={{
                fontSize: 'var(--fs-2xs)',
                fontWeight: 600,
                color: 'var(--info)',
                background: 'var(--info-bg)',
                borderRadius: 'var(--radius)',
                padding: '0.15rem 0.5rem',
              }}
            >
              커버리지 {coverage.covered.length}/{coverage.total}
              {coverage.appended.length > 0 ? ` · 부록 ${coverage.appended.length}건 보강` : ''}
            </span>
          )}
        </div>
        {synthStatus === 'done' && canExport && (
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
            <ExportMenu onExport={onExport} />
            <NbButton variant="ghost" onClick={copySynth} style={{ fontSize: 'var(--fs-sm)', minHeight: 36, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? '복사됨' : '복사'}
            </NbButton>
            {onResynthesize && (
              <NbButton variant="ghost" onClick={onResynthesize} title="항목 결과로 종합을 다시 생성" style={{ fontSize: 'var(--fs-sm)', minHeight: 36, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <RefreshCw size={14} /> 다시 취합
              </NbButton>
            )}
          </div>
        )}
      </div>

      {synthStatus === 'running' && <AXDotLoader size={5} color="var(--text-muted)" />}
      {synthStatus === 'error' && (
        <p role="alert" style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--danger)' }}>
          종합 인사이트 생성에 실패했습니다. 항목별 결과는 아래에서 확인할 수 있습니다.
        </p>
      )}
      {synthStatus === 'done' && synthText && <MarkdownMessage content={synthText} />}
    </div>
  )
}
