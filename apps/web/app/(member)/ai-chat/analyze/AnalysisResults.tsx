'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Copy, Download, RotateCw, Sparkles } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import AXDotLoader from '@/components/ui/AXDotLoader'
import MarkdownMessage from '@/app/admin/ai-chat/MarkdownMessage'
import { analyzeItem, synthesizeInsights, type AnalysisLens } from './actions'
import type { ReviewItem } from './ItemReviewList'

const CONCURRENCY = 3

type ItemStatus = 'idle' | 'running' | 'done' | 'error'
interface ResultState {
  status: ItemStatus
  text?: string
  error?: string
}

interface Props {
  items: ReviewItem[] // 선택된 항목만
  contextText: string
  lens: AnalysisLens
  customInstruction: string
  onBack: () => void
  onStartOver: () => void
}

async function runWithConcurrency(ids: string[], worker: (id: string) => Promise<void>): Promise<void> {
  let idx = 0
  async function runner(): Promise<void> {
    while (idx < ids.length) {
      const my = ids[idx]
      idx += 1
      await worker(my)
    }
  }
  const workerCount = Math.min(CONCURRENCY, ids.length)
  await Promise.all(Array.from({ length: workerCount }, runner))
}

function copyToClipboard(text: string): void {
  navigator.clipboard.writeText(text).catch(() => {})
}

function downloadTextFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export default function AnalysisResults({ items, contextText, lens, customInstruction, onBack, onStartOver }: Props) {
  const [results, setResults] = useState<Record<string, ResultState>>(() =>
    Object.fromEntries(items.map((i) => [i.id, { status: 'idle' as ItemStatus }])),
  )
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [synth, setSynth] = useState<ResultState>({ status: 'idle' })
  const startedRef = useRef(false)

  async function runOne(id: string): Promise<void> {
    const item = items.find((i) => i.id === id)
    if (!item) return
    setResults((prev) => ({ ...prev, [id]: { status: 'running' } }))
    const r = await analyzeItem({ itemText: item.text, contextText, lens, customInstruction })
    setResults((prev) => ({
      ...prev,
      [id]: r.ok ? { status: 'done', text: r.text } : { status: 'error', error: r.error },
    }))
  }

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    runWithConcurrency(items.map((i) => i.id), runOne)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function retryFailed(): void {
    const failedIds = items.filter((i) => results[i.id]?.status === 'error').map((i) => i.id)
    if (failedIds.length === 0) return
    runWithConcurrency(failedIds, runOne)
  }

  async function handleSynthesize(): Promise<void> {
    const entries = items
      .filter((i) => results[i.id]?.status === 'done')
      .map((i) => ({ itemText: i.text, resultText: results[i.id]?.text ?? '' }))
    if (entries.length === 0) return
    setSynth({ status: 'running' })
    const r = await synthesizeInsights(entries)
    setSynth(r.ok ? { status: 'done', text: r.text } : { status: 'error', error: r.error })
  }

  function buildExportSections(): { text: string; result: string }[] {
    return items
      .filter((i) => results[i.id]?.status === 'done')
      .map((i) => ({ text: i.text, result: results[i.id]?.text ?? '' }))
  }

  async function handleExport(format: 'md' | 'txt' | 'docx'): Promise<void> {
    const sections = buildExportSections()
    if (sections.length === 0) return
    const conv = { title: '목록 심층분석 결과', provider: 'gemini', model: '', createdAt: new Date().toISOString() }
    const messages = sections.flatMap((s) => [
      { role: 'user' as const, content: s.text, createdAt: conv.createdAt },
      { role: 'assistant' as const, content: s.result, createdAt: conv.createdAt },
    ])
    if (synth.status === 'done' && synth.text) {
      messages.push({ role: 'assistant' as const, content: `[종합 인사이트]\n${synth.text}`, createdAt: conv.createdAt })
    }

    if (format === 'md') {
      const { conversationToMarkdown } = await import('@/lib/ai-chat/export')
      downloadTextFile('목록_심층분석.md', conversationToMarkdown(conv, messages), 'text/markdown')
    } else if (format === 'txt') {
      const { conversationToPlainText } = await import('@/lib/ai-chat/export')
      downloadTextFile('목록_심층분석.txt', conversationToPlainText(conv, messages), 'text/plain')
    } else {
      const { downloadConversationDocx } = await import('@/lib/ai-chat/export-docx')
      await downloadConversationDocx(conv, messages)
    }
  }

  const doneCount = items.filter((i) => results[i.id]?.status === 'done').length
  const errorCount = items.filter((i) => results[i.id]?.status === 'error').length
  const allSettled = doneCount + errorCount === items.length && items.length > 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
          완료 {doneCount} · 실패 {errorCount} · 전체 {items.length}
        </span>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          {errorCount > 0 && (
            <NbButton variant="ghost" onClick={retryFailed} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: 'var(--fs-sm)' }}>
              <RotateCw size={14} />
              실패 항목만 재시도 ({errorCount})
            </NbButton>
          )}
          {doneCount > 0 && (
            <NbButton
              variant="ghost"
              onClick={handleSynthesize}
              disabled={synth.status === 'running'}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: 'var(--fs-sm)' }}
            >
              <Sparkles size={14} />
              {synth.status === 'running' ? '종합 중…' : '종합 인사이트'}
            </NbButton>
          )}
          {doneCount > 0 && (
            <>
              <NbButton variant="ghost" onClick={() => handleExport('md')} style={{ fontSize: 'var(--fs-sm)' }}>
                <Download size={14} /> md
              </NbButton>
              <NbButton variant="ghost" onClick={() => handleExport('txt')} style={{ fontSize: 'var(--fs-sm)' }}>
                <Download size={14} /> txt
              </NbButton>
              <NbButton variant="ghost" onClick={() => handleExport('docx')} style={{ fontSize: 'var(--fs-sm)' }}>
                <Download size={14} /> docx
              </NbButton>
            </>
          )}
        </div>
      </div>

      {synth.status !== 'idle' && (
        <div className="card" style={{ padding: 'var(--space-5)', borderColor: 'var(--brand)' }}>
          <span className="tape-title">종합 인사이트</span>
          <div style={{ marginTop: 'var(--space-2)' }}>
            {synth.status === 'running' && <AXDotLoader size={5} color="var(--text-muted)" />}
            {synth.status === 'error' && <p role="alert" style={{ color: 'var(--danger)', fontSize: 'var(--fs-sm)' }}>{synth.error}</p>}
            {synth.status === 'done' && synth.text && <MarkdownMessage content={synth.text} />}
          </div>
        </div>
      )}

      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {items.map((item, idx) => {
          const r = results[item.id] ?? { status: 'idle' as ItemStatus }
          return (
            <li key={item.id} className="card" style={{ padding: 'var(--space-5)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
                <div style={{ minWidth: 0 }}>
                  <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-faint)' }}>항목 {idx + 1}</span>
                  <p style={{ margin: '0.15rem 0 0', fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {item.text}
                  </p>
                </div>
                <StatusBadge status={r.status} />
              </div>

              {r.status === 'running' && <AXDotLoader size={5} color="var(--text-muted)" />}
              {r.status === 'error' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <p role="alert" style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--danger)' }}>{r.error}</p>
                  <NbButton variant="ghost" onClick={() => runOne(item.id)} style={{ fontSize: 'var(--fs-xs)' }}>
                    재시도
                  </NbButton>
                </div>
              )}
              {r.status === 'done' && r.text && (
                <>
                  <MarkdownMessage content={r.text} />
                  <button
                    type="button"
                    className="ai-chat-icon-btn"
                    onClick={() => {
                      copyToClipboard(r.text ?? '')
                      setCopiedId(item.id)
                      setTimeout(() => setCopiedId((c) => (c === item.id ? null : c)), 1500)
                    }}
                    aria-label="분석 결과 복사"
                    style={{ marginTop: 'var(--space-2)' }}
                  >
                    {copiedId === item.id ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                </>
              )}
            </li>
          )
        })}
      </ul>

      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <NbButton variant="ghost" onClick={onBack} disabled={!allSettled && items.some((i) => results[i.id]?.status === 'running')}>
          검수로 돌아가기
        </NbButton>
        <NbButton variant="ghost" onClick={onStartOver}>처음부터 다시</NbButton>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: ItemStatus }) {
  const map: Record<ItemStatus, { label: string; color: string; bg: string }> = {
    idle: { label: '대기', color: 'var(--text-faint)', bg: 'var(--surface-bg)' },
    running: { label: '분석중', color: 'var(--info)', bg: 'var(--info-bg)' },
    done: { label: '완료', color: 'var(--success)', bg: 'var(--success-bg)' },
    error: { label: '실패', color: 'var(--danger)', bg: 'var(--danger-bg)' },
  }
  const s = map[status]
  return (
    <span style={{ flexShrink: 0, fontSize: 'var(--fs-2xs)', fontWeight: 600, color: s.color, background: s.bg, borderRadius: 'var(--radius)', padding: '0.15rem 0.5rem' }}>
      {s.label}
    </span>
  )
}
