'use client'

import { useRef, useState } from 'react'
import { Check, Copy, RefreshCw, LayoutTemplate, Paperclip } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import AXDotLoader from '@/components/ui/AXDotLoader'
import MarkdownMessage from '@/app/admin/ai-chat/MarkdownMessage'
import ExportMenu, { type ExportFormat } from './ExportMenu'
import { extractSourceText } from './actions'
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
  /** 형식/샘플 지정 취합 — 지정한 형식(또는 샘플 파일 형식)대로 종합 문서를 다시 생성. */
  onSynthesizeWithFormat?: (format: string) => Promise<void> | void
}

/** 목록 심층분석 v2 — 완성형 취합 뷰(마크다운 렌더 + 커버리지 배지) + 다운로드 드롭다운·복사. */
export default function AnalysisSynthPanel({ synthStatus, synthText, coverage, canExport, onExport, onResynthesize, onSynthesizeWithFormat }: Props) {
  const [copied, setCopied] = useState(false)
  const [fmtOpen, setFmtOpen] = useState(false)
  const [fmtText, setFmtText] = useState('')
  const [sampleName, setSampleName] = useState<string | null>(null)
  const [fmtBusy, setFmtBusy] = useState(false)
  const [fmtErr, setFmtErr] = useState<string | null>(null)
  const sampleRef = useRef<HTMLInputElement>(null)
  const sampleTextRef = useRef<string>('')

  function copySynth(): void {
    navigator.clipboard.writeText(synthText ?? '').catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  async function handleSampleFile(file: File | null): Promise<void> {
    setSampleName(file?.name ?? null)
    sampleTextRef.current = ''
    if (!file) return
    setFmtBusy(true)
    setFmtErr(null)
    const fd = new FormData()
    fd.set('file', file)
    const r = await extractSourceText(fd)
    setFmtBusy(false)
    if (!r.ok) { setFmtErr(r.error); return }
    sampleTextRef.current = r.sourceText.slice(0, 20000) // 샘플 형식 참고용(상한)
  }

  async function applyFormat(): Promise<void> {
    if (!onSynthesizeWithFormat || fmtBusy) return
    const parts: string[] = []
    if (fmtText.trim()) parts.push(fmtText.trim())
    if (sampleTextRef.current.trim()) parts.push(`아래 샘플 문서의 형식·구성·말투를 그대로 따르라(내용은 우리 항목으로 대체):\n"""\n${sampleTextRef.current}\n"""`)
    const format = parts.join('\n\n')
    if (!format) { setFmtErr('형식을 입력하거나 샘플 파일을 첨부하세요'); return }
    setFmtBusy(true)
    setFmtErr(null)
    await onSynthesizeWithFormat(format)
    setFmtBusy(false)
    setFmtOpen(false)
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
            {onSynthesizeWithFormat && (
              <NbButton variant="ghost" onClick={() => setFmtOpen((v) => !v)} title="형식/샘플을 지정해 취합" data-active={fmtOpen} style={{ fontSize: 'var(--fs-sm)', minHeight: 36, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <LayoutTemplate size={14} /> 형식 지정 취합
              </NbButton>
            )}
          </div>
        )}
      </div>

      {fmtOpen && onSynthesizeWithFormat && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', border: 'var(--hairline) solid var(--border-color)', borderRadius: 'var(--radius)', padding: 'var(--space-3)', background: 'var(--surface-bg)' }}>
          <label className="label" htmlFor="synth-format">취합 형식 지시 (선택)</label>
          <textarea className="input-field" id="synth-format" rows={3} value={fmtText}
            onChange={(e) => setFmtText(e.target.value)}
            placeholder="예: 각 항목을 '요구사항 ID / 내용 / 담당 / 마감' 표로 / 회의록 형식으로 / 경영진 보고용 1페이지 요약으로"
            style={{ resize: 'vertical', fontFamily: 'inherit' }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <input ref={sampleRef} className="input-field" type="file" style={{ display: 'none' }}
              accept="image/png,image/jpeg,image/webp,.xlsx,.pptx,.docx,.pdf,.md,.txt,.csv,.html,.htm"
              onChange={(e) => { void handleSampleFile(e.target.files?.[0] ?? null) }} />
            <NbButton variant="ghost" onClick={() => sampleRef.current?.click()} style={{ fontSize: 'var(--fs-sm)', minHeight: 36, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Paperclip size={14} /> {sampleName ? '샘플 변경' : '샘플 파일 첨부'}
            </NbButton>
            {sampleName && <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{sampleName}</span>}
            <NbButton onClick={applyFormat} disabled={fmtBusy} style={{ fontSize: 'var(--fs-sm)', minHeight: 36, marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {fmtBusy ? <AXDotLoader size={5} color="currentColor" /> : <LayoutTemplate size={14} />} 이 형식으로 취합
            </NbButton>
          </div>
          <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-faint)' }}>형식 지시나 샘플 파일 중 하나만 있어도 됩니다. 샘플의 구성·표·말투를 따라 종합해요.</span>
          {fmtErr && <p role="alert" style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--danger)' }}>{fmtErr}</p>}
        </div>
      )}

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
