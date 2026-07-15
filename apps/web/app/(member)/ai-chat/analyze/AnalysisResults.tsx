'use client'

import { useRouter } from 'next/navigation'
import NbButton from '@/components/ui/nb/NbButton'
import { continueInChat } from './session-actions'
import { useAnalysisStream, type InitialItem } from './useAnalysisStream'
import AnalysisProgressBar from './AnalysisProgressBar'
import AnalysisSynthPanel, { type ExportFormat } from './AnalysisSynthPanel'
import AnalysisResultItem from './AnalysisResultItem'

interface Props {
  sessionId: string // §G 영속 저장 — 검수 완료 시 항상 먼저 생성된다(유실0)
  initialItems: InitialItem[] // 신규 세션=전부 pending, 이어하기=서버 상태 그대로
  onBack: () => void
  onStartOver: () => void
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

/**
 * 목록 심층분석 v2 결과 화면 — 클라이언트는 "관전자"다(.ralph/decisions/DECISION-20260715-ui-realtime-client.md).
 * 실제 분석은 서버(drainSession)+크론이 수행하고, 이 화면은 SSE·폴링으로 진행상황을 그리며
 * 취소/일시정지만 지시한다. 부분완료 항목은 전체 완료를 기다리지 않고 즉시 열람 가능하다.
 */
export default function AnalysisResults({ sessionId, initialItems, onBack, onStartOver }: Props) {
  const router = useRouter()
  const stream = useAnalysisStream(sessionId, initialItems)

  const itemList = Object.values(stream.items).sort((a, b) => a.idx - b.idx)
  const hasFailed = itemList.some((i) => i.status === 'error')
  const doneCount = itemList.filter((i) => i.status === 'done').length

  async function handleContinueChat(_idx: number, itemText: string, resultText: string): Promise<void> {
    const res = await continueInChat({ itemText, resultText })
    if (res.ok) router.push(`/ai-chat?c=${res.conversationId}`)
  }

  function buildExportSections(): { text: string; result: string }[] {
    return itemList.filter((i) => i.status === 'done' && i.resultText).map((i) => ({ text: i.text, result: i.resultText ?? '' }))
  }

  async function handleExport(format: ExportFormat): Promise<void> {
    const sections = buildExportSections()
    if (sections.length === 0) return
    const conv = { title: '목록 심층분석 결과', provider: 'gemini', model: '', createdAt: new Date().toISOString() }
    const messages = sections.flatMap((s) => [
      { role: 'user' as const, content: s.text, createdAt: conv.createdAt },
      { role: 'assistant' as const, content: s.result, createdAt: conv.createdAt },
    ])
    if (stream.synthStatus === 'done' && stream.synthText) {
      messages.push({ role: 'assistant' as const, content: `[종합 인사이트]\n${stream.synthText}`, createdAt: conv.createdAt })
    }

    if (format === 'md') {
      const { conversationToMarkdown } = await import('@/lib/ai-chat/export')
      downloadTextFile('목록_심층분석.md', conversationToMarkdown(conv, messages), 'text/markdown')
    } else if (format === 'txt') {
      const { conversationToPlainText } = await import('@/lib/ai-chat/export')
      downloadTextFile('목록_심층분석.txt', conversationToPlainText(conv, messages), 'text/plain')
    } else if (format === 'docx') {
      const { downloadConversationDocx } = await import('@/lib/ai-chat/export-docx')
      await downloadConversationDocx(conv, messages)
    } else {
      const res = await fetch('/api/admin/ai-chat/analyze-export-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: conv.title,
          sections: sections.map((s) => ({ itemText: s.text, resultText: s.result })),
          synthText: stream.synthStatus === 'done' ? stream.synthText : undefined,
        }),
      })
      if (!res.ok) return
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = '목록_심층분석.pdf'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    }
  }

  if (itemList.length === 0) {
    return (
      <div className="card" style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>
        분석할 항목이 없습니다.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <AnalysisProgressBar
        progress={stream.progress}
        itemCount={itemList.length}
        control={stream.control}
        mode={stream.mode}
        streamError={stream.streamError}
        onPause={stream.pause}
        onCancel={stream.cancel}
        onResume={stream.resume}
      />

      {hasFailed && (
        <div>
          <NbButton
            variant="ghost"
            onClick={stream.retryAllFailed}
            style={{ fontSize: 'var(--fs-sm)' }}
          >
            실패 항목만 재시도
          </NbButton>
        </div>
      )}

      <AnalysisSynthPanel
        synthStatus={stream.synthStatus}
        synthText={stream.synthText}
        coverage={stream.coverage}
        canExport={doneCount > 0}
        onExport={handleExport}
      />

      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {itemList.map((item) => (
          <AnalysisResultItem
            key={item.idx}
            idx={item.idx}
            text={item.text}
            status={item.status}
            resultText={item.resultText}
            liveDelta={stream.deltas[item.idx] ?? ''}
            onRetry={stream.retryItem}
            onContinueChat={handleContinueChat}
          />
        ))}
      </ul>

      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <NbButton variant="ghost" onClick={onBack}>
          검수로 돌아가기
        </NbButton>
        <NbButton variant="ghost" onClick={onStartOver}>
          처음부터 다시
        </NbButton>
      </div>
    </div>
  )
}
