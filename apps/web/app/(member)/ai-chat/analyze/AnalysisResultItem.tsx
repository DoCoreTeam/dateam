'use client'

import { useState } from 'react'
import { Check, Copy, MessageSquareText, RotateCw } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import AXDotLoader from '@/components/ui/AXDotLoader'
import MarkdownMessage from '@/app/admin/ai-chat/MarkdownMessage'
import type { AnalysisItemStatus } from './session-item-actions'

interface Props {
  idx: number
  text: string
  status: AnalysisItemStatus
  resultText: string | null
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
export default function AnalysisResultItem({ idx, text, status, resultText, liveDelta, onRetry, onContinueChat }: Props) {
  const [copied, setCopied] = useState(false)
  const [expanded, setExpanded] = useState(status === 'done')
  const s = STATUS_MAP[status]
  const displayText = status === 'done' ? resultText ?? '' : liveDelta

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
        <span
          style={{
            flexShrink: 0,
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
          <MarkdownMessage content={resultText} />
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
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
        </>
      )}
      {status === 'done' && resultText && !expanded && (
        <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>클릭해 펼쳐보기</p>
      )}
    </li>
  )
}
