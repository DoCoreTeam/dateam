'use client'
import { useEscClose } from '@/lib/use-esc-close'

import { useState, useRef } from 'react'
import { Sparkles, X } from 'lucide-react'
import { createCalendarEvent } from './actions'
import { kstWallToIso, kstDateOnlyToIso } from '@/lib/datetime/kst'
import { useFormCore } from '@/lib/forms/useFormCore'
import DraftRestoreBanner from '@/components/ui/DraftRestoreBanner'
import DateField from '@/components/ui/DateField'
import { isEnterKey } from '@/lib/ui/ime'

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
    // datetime SSOT — KST 벽시계를 +09:00 앵커로 저장(UTC 정확 적재). naive 문자열 직접 조립 금지.
    const start_at = allDay ? kstDateOnlyToIso(startDate) : kstWallToIso(startDate, startTime)
    const end_at = !allDay && endTime ? kstWallToIso(startDate, endTime) : null
    const rrule = repeat === 'daily' ? 'FREQ=DAILY' : repeat === 'weekly' ? 'FREQ=WEEKLY' : null
    const r = await createCalendarEvent({ title: title.trim(), start_at, end_at, all_day: allDay, description: desc || null, rrule })
    setBusy(false)
    if (!r.ok) { setMsg(r.error ?? '저장 실패'); return }
    nlDraft.clear()
    onSaved()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="일정 등록" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'var(--modal-backdrop)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-4)' }}>
      <div style={{ width: '100%', maxWidth: 460, background: 'var(--color-surface)', borderRadius: 'var(--radius)', padding: 'var(--space-6)', boxShadow: 'var(--shadow-modal)', maxHeight: '90vh', overflowY: 'auto', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <h3 className="tape-title" style={{ margin: 0 }}>일정 등록</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)' }}><X size={18} /></button>
        </div>

        {/* 자연어 */}
        <div ref={nlRef}><DraftRestoreBanner show={nlDraft.hasDraft} onRestore={nlDraft.restore} onDiscard={nlDraft.discard} /></div>
        <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.875rem' }}>
          <input className="input-field" value={nl} onChange={(e) => setNl(e.target.value)} placeholder="자연어: 내일 오후 3시 A사 미팅"
            aria-label="자연어로 일정 입력"
            onKeyDown={(e) => { if (isEnterKey(e)) { e.preventDefault(); parseNl() } }}
            style={{ flex: 1, minWidth: 0 }} />
          <button type="button" onClick={parseNl} disabled={aiBusy} className="btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', whiteSpace: 'nowrap', flexShrink: 0 }}>
            <Sparkles size={14} /> {aiBusy ? '파싱중' : 'AI 파싱'}
          </button>
        </div>

        {msg && <div role="status" style={{ padding: 'var(--space-2) var(--space-3)', background: 'var(--brand-soft)', border: 'var(--hairline) solid var(--brand-soft-2)', borderRadius: 'var(--radius)', marginBottom: '0.75rem', fontSize: '0.78rem', color: 'var(--brand-dark)' }}>{msg}</div>}

        <label className="label" htmlFor="cal-ev-title">제목</label>
        <input id="cal-ev-title" className="input-field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="일정 제목" />

        <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: '0.75rem', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 130 }}>
            <label className="label" htmlFor="cal-ev-date">날짜</label>
            <DateField id="cal-ev-date" value={startDate} onValueChange={setStartDate} />
          </div>
          {!allDay && (
            <>
              <div style={{ width: 100 }}>
                <label className="label" htmlFor="cal-ev-start">시작</label>
                <input id="cal-ev-start" type="time" className="input-field" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
              </div>
              <div style={{ width: 100 }}>
                <label className="label" htmlFor="cal-ev-end">종료</label>
                <input id="cal-ev-end" type="time" className="input-field" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
              </div>
            </>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', marginTop: '0.75rem', flexWrap: 'wrap' }}>
          <label className="label" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: 0, cursor: 'pointer' }}>
            {/* 토글류(checkbox/radio)는 필드 스타일 비대상 — input-field의 배경·보더·radius가 네이티브 체크 렌더를 덮는다 */}
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> 종일
          </label>
          <label className="label" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: 0 }}>
            반복
            <select className="input-field" value={repeat} onChange={(e) => setRepeat(e.target.value as 'none' | 'daily' | 'weekly')}
              style={{ width: 'auto' }}>
              <option value="none">안 함</option>
              <option value="daily">매일</option>
              <option value="weekly">매주</option>
            </select>
          </label>
        </div>

        <label className="label" htmlFor="cal-ev-desc" style={{ marginTop: '0.75rem' }}>설명 (선택)</label>
        <textarea id="cal-ev-desc" className="input-field" value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} style={{ resize: 'vertical' }} />

        <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: '1.25rem', justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} className="btn-ghost">취소</button>
          <button type="button" onClick={save} disabled={busy} className="btn-primary">{busy ? '저장중' : '저장'}</button>
        </div>
      </div>
    </div>
  )
}

