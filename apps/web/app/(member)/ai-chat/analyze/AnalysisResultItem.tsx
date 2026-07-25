'use client'

import { useState } from 'react'
import { Check, Copy, MessageSquareText, RotateCw, FileText } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import AXDotLoader from '@/components/ui/AXDotLoader'
import MarkdownMessage from '@/app/admin/ai-chat/MarkdownMessage'
import { computeRetention, computeAddedNumbers } from '@/lib/ai-chat/analyze/retention'
import type { AnalysisItemStatus } from './session-item-actions'

interface Props {
  idx: number
  text: string
  status: AnalysisItemStatus
  resultText: string | null
  /** 그룹 원문(보존됨) — 원문↔결과 비교·보존율 배지용. */
  bodyRaw: string
  liveDelta: string
  onRetry: (idx: number) => void
  onContinueChat: (idx: number, text: string, resultText: string) => void
}

const STATUS_MAP: Record<AnalysisItemStatus, { label: string; color: string; bg: string }> = {
  pending: { label: '대기', color: 'var(--text-faint)', bg: 'var(--surface-bg)' },
  running: { label: '분석중', color: 'var(--info)', bg: 'var(--info-bg)' },
  done: { label: '완료', color: 'var(--success)', bg: 'var(--success-bg)' },
  error: { label: '실패', color: 'var(--danger)', bg: 'var(--danger-bg)' },
}

/** 목록 심층분석 v2 — 항목 1건 카드. 상태 배지는 항상 서버 status 그대로(§ 하드코딩 금지). */
export default function AnalysisResultItem({ idx, text, status, resultText, bodyRaw, liveDelta, onRetry, onContinueChat }: Props) {
  const [copied, setCopied] = useState(false)
  const [expanded, setExpanded] = useState(status === 'done')
  const [showOriginal, setShowOriginal] = useState(false)
  const s = STATUS_MAP[status]
  const displayText = status === 'done' ? resultText ?? '' : liveDelta

  // 보존율 — 원문의 ID·수치가 결과에 남았는지(생략 자동감지). 원문·결과 둘 다 있을 때만 계산.
  const retention =
    status === 'done' && resultText && bodyRaw ? computeRetention(bodyRaw, resultText) : null
  const hasMissing = retention !== null && !retention.empty && retention.missing.length > 0
  // 충실도 신호(P2·결정론): 결과에 새로 등장한 수치 = AI가 원문 근거 없이 도입 → 검토 필요.
  const addedNumbers =
    status === 'done' && resultText && bodyRaw ? computeAddedNumbers(bodyRaw, resultText) : []

  function copy(): void {
    navigator.clipboard.writeText(resultText ?? '').catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <li className="card" style={{ padding: 'var(--space-5)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-3)',
          cursor: displayText ? 'pointer' : 'default',
        }}
        onClick={() => displayText && setExpanded((v) => !v)}
      >
        <div style={{ minWidth: 0 }}>
          <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-faint)' }}>항목 {idx + 1}</span>
          <p
            style={{
              margin: '0.15rem 0 0',
              fontSize: 'var(--fs-md)',
              fontWeight: 600,
              color: 'var(--text)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {text}
          </p>
        </div>
        <div style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}>
          {retention && !retention.empty && (
            <span
              title={hasMissing ? `누락: ${retention.missing.join(', ')}` : '원문의 ID·수치가 결과에 모두 보존됨'}
              style={{
                fontSize: 'var(--fs-2xs)',
                fontWeight: 600,
                color: hasMissing ? 'var(--warning)' : 'var(--success)',
                background: hasMissing ? 'var(--warning-bg)' : 'var(--success-bg)',
                borderRadius: 'var(--radius)',
                padding: '0.15rem 0.5rem',
              }}
            >
              ID {retention.idKept}/{retention.idTotal} · 수치 {retention.numKept}/{retention.numTotal}
            </span>
          )}
          <span
            style={{
              fontSize: 'var(--fs-2xs)',
              fontWeight: 600,
              color: s.color,
              background: s.bg,
              borderRadius: 'var(--radius)',
              padding: '0.15rem 0.5rem',
            }}
          >
            {s.label}
          </span>
        </div>
      </div>

      {status === 'pending' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <AXDotLoader size={5} color="var(--info)" />
          <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>분석 대기 중…</span>
        </div>
      )}

      {status === 'running' && (
        <>
          {liveDelta ? (
            expanded ? (
              <MarkdownMessage content={liveDelta} />
            ) : (
              <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
                생성 중… (클릭해 실시간으로 보기)
              </p>
            )
          ) : (
            <AXDotLoader size={5} color="var(--text-muted)" />
          )}
        </>
      )}

      {status === 'error' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <p role="alert" style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--danger)' }}>
            분석에 실패했습니다
          </p>
          <NbButton variant="ghost" onClick={() => onRetry(idx)} style={{ fontSize: 'var(--fs-xs)' }}>
            <RotateCw size={12} />
            재시도
          </NbButton>
        </div>
      )}

      {status === 'done' && resultText && expanded && (
        <>
          {hasMissing && (
            <div
              role="alert"
              style={{
                display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-2)',
                fontSize: 'var(--fs-xs)', color: 'var(--warning)', background: 'var(--warning-bg)',
                border: 'var(--hairline) solid var(--warning-border)', borderRadius: 'var(--radius)',
                padding: '0.4rem 0.6rem', marginBottom: 'var(--space-2)',
              }}
            >
              <span>원문 대비 누락 {retention?.missing.length}건: {retention?.missing.join(', ')}</span>
              <NbButton variant="ghost" onClick={(e) => { e.stopPropagation(); onRetry(idx) }} style={{ fontSize: 'var(--fs-2xs)', minHeight: 30 }}>
                <RotateCw size={11} /> 누락 반영 재분석
              </NbButton>
            </div>
          )}
          {addedNumbers.length > 0 && (
            <div
              style={{
                fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', background: 'var(--surface-bg)',
                border: 'var(--hairline) solid var(--border-color)', borderRadius: 'var(--radius)',
                padding: '0.3rem 0.55rem', marginBottom: 'var(--space-2)',
              }}
              title="원문에 없던 수치 — AI 보강이 도입한 값이니 근거를 검토하세요"
            >
              🔬 AI가 더한 수치 {addedNumbers.length}개(원문 근거 없음 · 검토 권장): {addedNumbers.join(', ')}
            </div>
          )}
          <MarkdownMessage content={resultText} />
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="ai-chat-icon-btn"
              onClick={(e) => {
                e.stopPropagation()
                copy()
              }}
              aria-label="분석 결과 복사"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
            {bodyRaw && (
              <NbButton
                variant="ghost"
                onClick={(e) => { e.stopPropagation(); setShowOriginal((v) => !v) }}
                data-active={showOriginal}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: 'var(--fs-xs)' }}
              >
                <FileText size={14} />
                {showOriginal ? '원문 숨기기' : '원문 보기'}
              </NbButton>
            )}
            <NbButton
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation()
                onContinueChat(idx, text, resultText)
              }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: 'var(--fs-xs)' }}
            >
              <MessageSquareText size={14} />
              채팅으로 이어가기
            </NbButton>
          </div>
          {showOriginal && bodyRaw && (
            <div
              style={{
                marginTop: 'var(--space-2)', padding: 'var(--space-3)',
                background: 'var(--surface-bg)', border: 'var(--hairline) solid var(--border-color)',
                borderRadius: 'var(--radius)',
              }}
            >
              <div style={{ fontSize: 'var(--fs-2xs)', fontWeight: 600, color: 'var(--text-faint)', marginBottom: 'var(--space-1)' }}>
                내가 넣은 원문
              </div>
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', fontFamily: 'inherit' }}>
                {bodyRaw}
              </pre>
            </div>
          )}
        </>
      )}
      {status === 'done' && resultText && !expanded && (
        <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>클릭해 펼쳐보기</p>
      )}
    </li>
  )
}
