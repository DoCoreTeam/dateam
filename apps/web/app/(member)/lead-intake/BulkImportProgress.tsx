'use client'

import { useEffect, useRef, useState } from 'react'
import AXLoadingOverlay from '@/components/ui/AXLoadingOverlay'

interface SseEvent {
  type: 'start' | 'progress' | 'done'
  total?: number
  processed?: number
  success?: number
  failed?: number
  fileName?: string
  intakeIds?: string[]
}

interface BulkResult {
  total: number
  success: number
  failed: number
  intakeIds: string[]
}

interface BulkImportProgressProps {
  file: File
  onComplete: (result: BulkResult) => void
  onCancel: () => void
}

function formatSec(sec: number) {
  if (sec < 60) return `${sec}초`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return s > 0 ? `${m}분 ${s}초` : `${m}분`
}

export default function BulkImportProgress({ file, onComplete, onCancel }: BulkImportProgressProps) {
  const [total, setTotal] = useState(0)
  const [processed, setProcessed] = useState(0)
  const [success, setSuccess] = useState(0)
  const [failed, setFailed] = useState(0)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const startedAt = useRef<number>(Date.now())
  const intakeIdsRef = useRef<string[]>([])

  // 경과 시간 타이머
  useEffect(() => {
    if (done) return
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt.current) / 1000))
    }, 1000)
    return () => clearInterval(id)
  }, [done])

  useEffect(() => {
    let cancelled = false

    async function run() {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('source', 'xlsx_bulk')

      let res: Response
      try {
        res = await fetch('/api/leads/parse', { method: 'POST', body: fd })
      } catch {
        if (!cancelled) setError('네트워크 오류가 발생했습니다')
        return
      }

      const ct = res.headers.get('content-type') ?? ''

      if (!ct.includes('text/event-stream')) {
        const json = await res.json() as { error?: string; bulk?: boolean }
        if (!cancelled) {
          if (json.error) setError(json.error)
          else setError('대량 임포트를 지원하지 않는 파일 형식입니다')
        }
        return
      }

      const reader = res.body?.getReader()
      if (!reader) { if (!cancelled) setError('스트림을 읽을 수 없습니다'); return }

      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { value, done: streamDone } = await reader.read()
        if (streamDone || cancelled) break

        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const evt = JSON.parse(line.slice(6)) as SseEvent
            if (evt.type === 'start') setTotal(evt.total ?? 0)
            if (evt.type === 'progress') {
              setProcessed(evt.processed ?? 0)
              setSuccess(evt.success ?? 0)
              setFailed(evt.failed ?? 0)
            }
            if (evt.type === 'done') {
              setProcessed(evt.processed ?? 0)
              setSuccess(evt.success ?? 0)
              setFailed(evt.failed ?? 0)
              intakeIdsRef.current = evt.intakeIds ?? []
              setDone(true)
            }
          } catch { /* 잘못된 SSE 행 무시 */ }
        }
      }
    }

    run()
    return () => { cancelled = true }
  }, [file])

  const pct = total > 0 ? Math.round((processed / total) * 100) : 0

  // 예상 남은 시간 계산 (처리된 건이 있을 때만)
  const eta: number | null = (() => {
    if (processed <= 0 || elapsed <= 0 || done) return null
    const secPerItem = elapsed / processed
    const remaining = Math.ceil((total - processed) * secPerItem)
    return remaining
  })()

  // 오버레이 sublabel 구성
  const overlaySubLabel = (() => {
    const lines: string[] = []
    if (total > 0) lines.push(`${file.name}`)
    lines.push(total > 0 ? `${total}건 중 ${processed}건 처리 (${pct}%)` : '파일 분석 중…')
    if (elapsed > 0) lines.push(`경과: ${formatSec(elapsed)}${eta !== null ? `  |  예상 종료: ${formatSec(eta)} 후` : ''}`)
    if (success > 0 || failed > 0) lines.push(`성공 ${success}건${failed > 0 ? ` · 실패 ${failed}건` : ''}`)
    return lines.join('\n')
  })()

  async function handleConfirmAll() {
    if (!intakeIdsRef.current.length) return
    setConfirming(true)
    try {
      const res = await fetch('/api/leads/bulk-confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intakeIds: intakeIdsRef.current }),
      })
      const data = await res.json() as { created?: number; skipped?: number }
      if (res.ok) {
        setConfirmed(true)
        onComplete({ total, success, failed, intakeIds: intakeIdsRef.current })
      } else {
        setError(`CRM 등록 실패: ${JSON.stringify(data)}`)
      }
    } finally {
      setConfirming(false)
    }
  }

  if (error) {
    return (
      <div className="bulk-result-summary bulk-result-error">
        <p style={{ margin: 0, fontWeight: 600, color: '#dc2626' }}>오류 발생</p>
        <p style={{ margin: '0.25rem 0 0', fontSize: '0.875rem', color: '#7f1d1d' }}>{error}</p>
        <button onClick={onCancel} style={{ marginTop: '0.75rem', fontSize: '0.8125rem', color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          ← 다시 시도
        </button>
      </div>
    )
  }

  return (
    <>
      {/* 처리 중: 공통 로딩 오버레이 */}
      <AXLoadingOverlay
        isLoading={!done}
        label={`대량 임포트 처리 중… ${pct > 0 ? `(${pct}%)` : ''}`}
        sublabel={overlaySubLabel}
        elapsed={elapsed}
        ariaLabel="대량 임포트 진행 중"
        variant="light"
      />

      {/* CRM 등록 중: 공통 로딩 오버레이 */}
      <AXLoadingOverlay
        isLoading={confirming}
        label="CRM 등록 중…"
        sublabel={`거래처·담당자·영업기회 생성 중\n${success}건 처리 중입니다`}
        ariaLabel="CRM 등록 진행 중"
        variant="light"
      />

      {/* 완료 후: 결과 + CRM 등록 액션 */}
      {done && !confirmed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="bulk-result-summary">
            <p style={{ fontWeight: 600, fontSize: '0.9375rem', margin: '0 0 0.5rem' }}>
              대량 임포트 완료
            </p>
            <p style={{ fontSize: '0.8125rem', color: '#64748b', margin: 0 }}>
              {file.name} — 총 {total}건 / 소요 {formatSec(elapsed)}
            </p>
            <div style={{ display: 'flex', gap: '1rem', marginTop: '0.75rem' }}>
              <span style={{ fontSize: '0.875rem', color: '#16a34a', fontWeight: 600 }}>성공 {success}건</span>
              {failed > 0 && (
                <span style={{ fontSize: '0.875rem', color: '#dc2626', fontWeight: 600 }}>실패 {failed}건</span>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button onClick={handleConfirmAll} disabled={confirming} className="btn-primary"
              style={{ padding: '0.625rem 1.25rem', minHeight: '44px' }}>
              {`전체 CRM 등록 (${success}건)`}
            </button>
            <button onClick={onCancel}
              style={{ padding: '0.625rem 1.25rem', minHeight: '44px', background: 'none', border: '1px solid #e2e8f0', borderRadius: '0.5rem', cursor: 'pointer', fontSize: '0.875rem', color: '#64748b' }}>
              취소
            </button>
          </div>
        </div>
      )}

      {confirmed && (
        <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '0.75rem', padding: '1rem' }}>
          <p style={{ color: '#0284c7', fontWeight: 600, margin: 0 }}>
            {success}건이 CRM에 등록되었습니다
          </p>
          <button onClick={onCancel} style={{ marginTop: '0.5rem', fontSize: '0.8125rem', color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            새 파일 업로드 →
          </button>
        </div>
      )}
    </>
  )
}
