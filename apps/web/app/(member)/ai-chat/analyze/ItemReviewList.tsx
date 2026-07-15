'use client'

import type { Dispatch, SetStateAction } from 'react'
import { AlertTriangle, Plus, Trash2 } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import type { AnalysisLens } from './actions'

export interface ReviewItem {
  id: string
  text: string
  recovered: boolean
  selected: boolean
}

const LENS_OPTIONS: { id: AnalysisLens; label: string }[] = [
  { id: 'summary', label: '핵심 요약' },
  { id: 'risk', label: '리스크·우려사항' },
  { id: 'action-plan', label: '실행계획' },
  { id: 'evidence', label: '근거·출처 점검' },
  { id: 'compare', label: '비교·대안 검토' },
]

interface Props {
  items: ReviewItem[]
  setItems: Dispatch<SetStateAction<ReviewItem[]>>
  parsedCount: number
  restoredCount: number
  truncatedWarning: boolean
  lens: AnalysisLens
  setLens: (lens: AnalysisLens) => void
  customInstruction: string
  setCustomInstruction: (v: string) => void
  onBack: () => void
  onProceed: () => void
}

function makeId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export default function ItemReviewList({
  items,
  setItems,
  parsedCount,
  restoredCount,
  truncatedWarning,
  lens,
  setLens,
  customInstruction,
  setCustomInstruction,
  onBack,
  onProceed,
}: Props) {
  const selectedCount = items.filter((i) => i.selected).length
  const allSelected = items.length > 0 && selectedCount === items.length

  function toggleAll() {
    setItems((prev) => prev.map((i) => ({ ...i, selected: !allSelected })))
  }
  function toggleOne(id: string) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, selected: !i.selected } : i)))
  }
  function updateText(id: string, text: string) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, text } : i)))
  }
  function removeItem(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id))
  }
  function addItem() {
    setItems((prev) => [...prev, { id: makeId(), text: '', recovered: false, selected: true }])
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      {/* 완전성 요약 배지(§A) — 무손실 검수 근거 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', alignItems: 'center' }}>
        <span
          style={{
            fontSize: 'var(--fs-lg)',
            fontWeight: 700,
            color: 'var(--text)',
          }}
        >
          {items.length}개 항목 추출됨
        </span>
        <span className="badge" style={{ fontSize: 'var(--fs-2xs)' }}>
          구조 파싱 {parsedCount}개
        </span>
        {restoredCount > 0 && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.25rem',
              fontSize: 'var(--fs-2xs)',
              fontWeight: 600,
              color: 'var(--warning)',
              background: 'var(--warning-bg)',
              border: `var(--hairline) solid var(--warning-border)`,
              borderRadius: 'var(--radius)',
              padding: '0.15rem 0.5rem',
            }}
          >
            <AlertTriangle size={12} />
            AI가 놓쳐 원문 복구 {restoredCount}개 — 확인 필요
          </span>
        )}
        {truncatedWarning && (
          <span
            style={{
              fontSize: 'var(--fs-2xs)',
              fontWeight: 600,
              color: 'var(--warning)',
              background: 'var(--warning-bg)',
              border: `var(--hairline) solid var(--warning-border)`,
              borderRadius: 'var(--radius)',
              padding: '0.15rem 0.5rem',
            }}
          >
            원본이 커서 앞부분까지만 처리했습니다 — 전량 검수하려면 파일을 나눠 올려주세요
          </span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', cursor: 'pointer' }}>
          <input type="checkbox" checked={allSelected} onChange={toggleAll} />
          전체선택/해제 ({selectedCount}/{items.length})
        </label>
        <NbButton variant="ghost" onClick={addItem} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: 'var(--fs-sm)' }}>
          <Plus size={14} />
          항목 추가
        </NbButton>
      </div>

      {items.length === 0 ? (
        <div className="card" style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>
          추출된 항목이 없습니다. &quot;항목 추가&quot;로 직접 입력하거나 이전 단계로 돌아가 다른 자료를 시도하세요.
        </div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {items.map((item, idx) => (
            <li
              key={item.id}
              className="card"
              style={{
                padding: 'var(--space-3) var(--space-4)',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 'var(--space-3)',
                borderColor: item.recovered ? 'var(--warning-border)' : undefined,
                background: item.recovered ? 'var(--warning-bg)' : undefined,
              }}
            >
              <input type="checkbox" checked={item.selected}
                onChange={() => toggleOne(item.id)}
                style={{ marginTop: '0.6rem', flexShrink: 0 }}
                aria-label={`항목 ${idx + 1} 선택`}
              />
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                {item.recovered && (
                  <span style={{ fontSize: 'var(--fs-2xs)', fontWeight: 600, color: 'var(--warning)' }}>
                    원문 그대로 복구됨 — 검수 권장
                  </span>
                )}
                <textarea className="input-field"
                  value={item.text}
                  onChange={(e) => updateText(item.id, e.target.value)}
                  rows={Math.min(8, Math.max(2, Math.ceil(item.text.length / 60)))}
                  style={{ resize: 'vertical', fontFamily: 'inherit', width: '100%' }}
                  aria-label={`항목 ${idx + 1} 내용`}
                />
              </div>
              <button
                type="button"
                className="ai-chat-icon-btn"
                data-danger="true"
                onClick={() => removeItem(item.id)}
                aria-label={`항목 ${idx + 1} 삭제`}
                style={{ flexShrink: 0 }}
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* 분석 관점 선택(§B) */}
      <div className="card" style={{ padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <span className="tape-title">분석 관점</span>
        <div role="radiogroup" aria-label="분석 관점" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
          {LENS_OPTIONS.map((opt) => (
            <label
              key={opt.id}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                fontSize: 'var(--fs-sm)',
                padding: '0.35rem 0.75rem',
                borderRadius: 'var(--radius)',
                border: `var(--border-w) solid ${lens === opt.id ? 'var(--brand)' : 'var(--border-color)'}`,
                background: lens === opt.id ? 'var(--surface-bg)' : 'transparent',
                cursor: 'pointer',
                color: 'var(--text)',
              }}
            >
              <input type="radio" name="analysis-lens"
                checked={lens === opt.id}
                onChange={() => setLens(opt.id)}
                style={{ margin: 0 }}
              />
              {opt.label}
            </label>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <label className="label" htmlFor="analyze-custom-instruction">추가 지시(선택)</label>
          <textarea className="input-field"
            id="analyze-custom-instruction"
            rows={2}
            value={customInstruction}
            onChange={(e) => setCustomInstruction(e.target.value)}
            placeholder="예: 비용 관점에서도 짚어줘, 경쟁사 대비 관점 추가해줘"
            style={{ resize: 'vertical', fontFamily: 'inherit' }}
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'space-between' }}>
        <NbButton variant="ghost" onClick={onBack}>다시 입력</NbButton>
        <NbButton onClick={onProceed} disabled={selectedCount === 0} style={{ minHeight: 44 }}>
          선택 항목 분석 ({selectedCount})
        </NbButton>
      </div>
    </div>
  )
}
