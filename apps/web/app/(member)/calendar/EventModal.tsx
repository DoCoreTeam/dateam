'use client'
import { useEscClose } from '@/lib/use-esc-close'

import { useState, useRef } from 'react'
import { Sparkles, X } from 'lucide-react'
import { createCalendarEvent } from './actions'
import { useFormCore } from '@/lib/forms/useFormCore'
import DraftRestoreBanner from '@/components/ui/DraftRestoreBanner'

interface Props {
  date: string // YYYY-MM-DD 기본 날짜
  onClose: () => void
  onSaved: () => void
}

export default function EventModal({ date, onClose, onSaved }: Props) {
  useEscClose(onClose)
  const nlRef = useRef<HTMLDivElement>(null)
  const nlDraft = useFormCore<string>({ formId: 'calendar-event', recordId: date, initial: '', scopeRef: nlRef })
  const nl = nlDraft.value
  const setNl = nlDraft.set
  const [aiBusy, setAiBusy] = useState(false)
  const [title, setTitle] = useState('')
  const [startDate, setStartDate] = useState(date)
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('')
  const [allDay, setAllDay] = useState(false)
  const [repeat, setRepeat] = useState<'none' | 'daily' | 'weekly'>('none')
  const [desc, setDesc] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  // 자연어 → analyze-work 재사용 → 폼 프리필
  async function parseNl() {
    if (!nl.trim() || aiBusy) return
    setAiBusy(true); setMsg(null)
    try {
      const res = await fetch('/api/ai/analyze-work', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: nl.trim(), date: startDate }),
      })
      if (!res.ok || !res.body) { setMsg('AI 파싱 실패'); setAiBusy(false); return }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let first: any = null
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n'); buf = lines.pop() ?? ''
        for (const line of lines) {
          const t = line.trim()
          if (!t.startsWith('data: ')) continue
          const j = t.slice(6)
          if (j === '[DONE]') continue
          try { const o = JSON.parse(j); if (o.title && !first) first = o } catch { /* skip */ }
        }
      }
      if (first) {
        setTitle(first.title)
        if (first.targetDate) setStartDate(first.targetDate)
        if (first.scheduledTime) setStartTime(first.scheduledTime)
        setMsg('AI가 채웠습니다 — 확인 후 저장하세요')
      } else setMsg('파싱 결과 없음 — 직접 입력하세요')
    } catch { setMsg('AI 서버 연결 실패') }
    setAiBusy(false)
  }

  async function save() {
    if (!title.trim()) { setMsg('제목을 입력하세요'); return }
    setBusy(true); setMsg(null)
    const start_at = allDay ? `${startDate}T00:00:00` : `${startDate}T${startTime}:00`
    const end_at = !allDay && endTime ? `${startDate}T${endTime}:00` : null
    const rrule = repeat === 'daily' ? 'FREQ=DAILY' : repeat === 'weekly' ? 'FREQ=WEEKLY' : null
    const r = await createCalendarEvent({ title: title.trim(), start_at, end_at, all_day: allDay, description: desc || null, rrule })
    setBusy(false)
    if (!r.ok) { setMsg(r.error ?? '저장 실패'); return }
    nlDraft.clear()
    onSaved()
  }

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'var(--modal-backdrop)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-4)' }}>
      <div style={{ width: '100%', maxWidth: 460, background: 'var(--color-surface)', borderRadius: 'var(--radius)', padding: 'var(--space-6)', boxShadow: 'var(--shadow-modal)', maxHeight: '90vh', overflowY: 'auto', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <h3 className="tape-title" style={{ margin: 0 }}>일정 등록</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)' }}><X size={18} /></button>
        </div>

        {/* 자연어 */}
        <div ref={nlRef}><DraftRestoreBanner show={nlDraft.hasDraft} onRestore={nlDraft.restore} onDiscard={nlDraft.discard} /></div>
        <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.875rem' }}>
          <input value={nl} onChange={(e) => setNl(e.target.value)} placeholder="자연어: 내일 오후 3시 A사 미팅"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); parseNl() } }}
            style={{ flex: 1, border: 'var(--border-w-2) solid var(--border-color)', borderRadius: 'var(--radius)', padding: '0.5rem 0.625rem', fontSize: 'var(--fs-sm)', outline: 'none' }} />
          <button onClick={parseNl} disabled={aiBusy} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--brand-fg)', background: 'var(--brand)', border: 'none', borderRadius: 'var(--radius)', padding: 'var(--space-2) var(--space-3)', cursor: aiBusy ? 'wait' : 'pointer', whiteSpace: 'nowrap' }}>
            <Sparkles size={14} /> {aiBusy ? '파싱중' : 'AI 파싱'}
          </button>
        </div>

        {msg && <div role="status" style={{ padding: 'var(--space-2) var(--space-3)', background: 'var(--brand-soft)', border: 'var(--hairline) solid var(--brand-soft-2)', borderRadius: 'var(--radius)', marginBottom: '0.75rem', fontSize: '0.78rem', color: 'var(--brand-dark)' }}>{msg}</div>}

        <label style={lbl}>제목</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="일정 제목" style={inp} />

        <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: '0.75rem', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 130 }}>
            <label style={lbl}>날짜</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={inp} />
          </div>
          {!allDay && (
            <>
              <div style={{ width: 100 }}>
                <label style={lbl}>시작</label>
                <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} style={inp} />
              </div>
              <div style={{ width: 100 }}>
                <label style={lbl}>종료</label>
                <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} style={inp} />
              </div>
            </>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', marginTop: '0.75rem', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> 종일
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
            반복
            <select value={repeat} onChange={(e) => setRepeat(e.target.value as 'none' | 'daily' | 'weekly')}
              style={{ border: 'var(--border-w-2) solid var(--border-color)', borderRadius: 'var(--radius)', padding: '0.3rem 0.5rem', fontSize: 'var(--fs-sm)' }}>
              <option value="none">안 함</option>
              <option value="daily">매일</option>
              <option value="weekly">매주</option>
            </select>
          </label>
        </div>

        <label style={{ ...lbl, marginTop: '0.75rem' }}>설명 (선택)</label>
        <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} style={{ ...inp, resize: 'vertical', fontFamily: 'inherit' }} />

        <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: '1.25rem', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>취소</button>
          <button onClick={save} disabled={busy} style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--brand-fg)', background: 'var(--brand)', border: 'none', borderRadius: 'var(--radius)', padding: 'var(--space-2) var(--space-5)', cursor: busy ? 'wait' : 'pointer' }}>{busy ? '저장중' : '저장'}</button>
        </div>
      </div>
    </div>
  )
}

const lbl: React.CSSProperties = { display: 'block', fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-faint)', marginBottom: '0.25rem' }
const inp: React.CSSProperties = { width: '100%', border: 'var(--border-w-2) solid var(--border-color)', borderRadius: 'var(--radius)', padding: '0.5rem 0.625rem', fontSize: 'var(--fs-sm)', outline: 'none', boxSizing: 'border-box' }
