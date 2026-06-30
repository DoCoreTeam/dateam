// 주간보고 AI 자동초안(push) 패널 — 진입 시 AI가 일일업무·일정으로 작성한 초안을 보여주고,
// 사용자가 빼거나(체크 해제·삭제) 고친 뒤 한 번에 저장한다. (방치→오확정 방지: 안내 배너 명시)
// 백엔드 계약: GET/PUT /api/weekly-report/draft?week=YYYY-MM-DD (route.ts), 타입=draft-types.ts.
'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles, Plus, Save, AlertCircle } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import AutoDraftItemList, { SECTION_ORDER, SECTION_LABELS } from './AutoDraftItemList'
import type { DraftItem, DraftSection } from '@/lib/weekly-report/draft-types'

interface AutoDraftPanelProps {
  /** 선택된(초기) 주차 — 'YYYY-MM-DD'(월요일). */
  week: string
  /** 주차 셀렉트 옵션(최근 8주). */
  weekOptions: string[]
}

interface DraftResponse {
  items?: DraftItem[]
  generated?: boolean
  error?: string
}

export default function AutoDraftPanel({ week, weekOptions }: AutoDraftPanelProps) {
  const router = useRouter()
  const [selectedWeek, setSelectedWeek] = useState(week)
  const [items, setItems] = useState<DraftItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 수동 추가 폼
  const [newCategory, setNewCategory] = useState('')
  const [newSection, setNewSection] = useState<DraftSection>('performance')
  const [newContent, setNewContent] = useState('')

  const fetchDraft = useCallback(async (wk: string) => {
    setLoading(true)
    setError(null)
    setLoaded(false)
    try {
      const res = await fetch(`/api/weekly-report/draft?week=${wk}`)
      const json: DraftResponse = await res.json()
      if (!res.ok) throw new Error(json.error || '초안을 불러오지 못했습니다')
      setItems(Array.isArray(json.items) ? json.items : [])
    } catch (err) {
      console.error('[AutoDraftPanel] GET 실패', err)
      setError(err instanceof Error ? err.message : '초안을 불러오지 못했습니다')
      setItems([])
    } finally {
      setLoading(false)
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    fetchDraft(selectedWeek)
  }, [selectedWeek, fetchDraft])

  const updateItem = (idx: number, patch: Partial<DraftItem>) =>
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)))
  const removeItem = (idx: number) => setItems((prev) => prev.filter((_, i) => i !== idx))

  const addManual = () => {
    const content = newContent.trim()
    if (!content) return
    setItems((prev) => [
      ...prev,
      {
        category: newCategory.trim() || '기타',
        section: newSection,
        content,
        origin: 'manual',
        confidence: null,
        isIncluded: true,
        sourceRef: null,
        sortOrder: prev.length,
      },
    ])
    setNewContent('')
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    const payload = items.map((it, i) => ({ ...it, sortOrder: i }))
    try {
      const res = await fetch(`/api/weekly-report/draft?week=${selectedWeek}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: payload }),
      })
      const json: DraftResponse = await res.json()
      if (!res.ok) throw new Error(json.error || '저장에 실패했습니다')
      router.push('/weekly-report?tab=mine&saved=1', { scroll: false })
    } catch (err) {
      console.error('[AutoDraftPanel] PUT 실패', err)
      setError(err instanceof Error ? err.message : '저장에 실패했습니다')
    } finally {
      setSaving(false)
    }
  }

  const categories = Array.from(new Set(items.map((i) => i.category).filter(Boolean)))
  const isEmpty = loaded && items.length === 0

  return (
    <div>
      {/* 주차 선택 */}
      <div style={{ marginBottom: 'var(--space-4)', maxWidth: 240 }}>
        <label className="label" htmlFor="adp-week">주차</label>
        <select id="adp-week" className="input-field"
          value={selectedWeek}
          onChange={(e) => setSelectedWeek(e.target.value)}
          disabled={loading || saving}
        >
          {weekOptions.map((w) => (
            <option key={w} value={w}>{w}</option>
          ))}
        </select>
      </div>

      {/* 안내 배너 */}
      <div
        style={{
          display: 'flex',
          gap: 'var(--space-2)',
          alignItems: 'flex-start',
          padding: 'var(--space-3) var(--space-4)',
          background: 'var(--info-bg)',
          border: 'var(--border-w) solid var(--info-border)',
          borderRadius: 'var(--radius)',
          marginBottom: 'var(--space-4)',
        }}
      >
        <Sparkles size={16} color="var(--info)" style={{ flexShrink: 0, marginTop: 2 }} />
        <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--text)', lineHeight: 1.6 }}>
          AI가 일일업무·일정으로 작성한 초안입니다. 빼거나 고친 뒤 저장하세요.
        </p>
      </div>

      {/* 에러 배너 */}
      {error && (
        <div
          role="alert"
          style={{
            display: 'flex',
            gap: 'var(--space-2)',
            alignItems: 'flex-start',
            padding: 'var(--space-3) var(--space-4)',
            background: 'var(--danger-bg)',
            border: 'var(--border-w) solid var(--danger-border)',
            borderRadius: 'var(--radius)',
            marginBottom: 'var(--space-4)',
          }}
        >
          <AlertCircle size={16} color="var(--danger)" style={{ flexShrink: 0, marginTop: 2 }} />
          <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--danger)', lineHeight: 1.6 }}>{error}</p>
        </div>
      )}

      {/* 로딩 스켈레톤 */}
      {loading ? (
        <div aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{
                height: 56,
                background: 'var(--surface-bg)',
                border: 'var(--hairline) solid var(--border-light)',
                borderRadius: 'var(--radius)',
              }}
            />
          ))}
          <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
            초안을 불러오는 중입니다. 처음이라면 AI 작성에 수 초 걸릴 수 있어요.
          </p>
        </div>
      ) : isEmpty ? (
        <p style={{ margin: '0 0 var(--space-4)', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', lineHeight: 1.6 }}>
          이번 주 일일업무/일정이 없어 초안이 비어 있습니다. 아래에서 직접 추가하세요.
        </p>
      ) : (
        <AutoDraftItemList
          items={items}
          onToggle={(idx, included) => updateItem(idx, { isIncluded: included })}
          onEdit={(idx, content) => updateItem(idx, { content })}
          onRemove={removeItem}
        />
      )}

      {/* 수동 작성 영역 */}
      {!loading && (
        <div
          style={{
            padding: 'var(--space-4)',
            background: 'var(--surface-bg)',
            border: 'var(--hairline) solid var(--border-light)',
            borderRadius: 'var(--radius)',
            marginBottom: 'var(--space-4)',
          }}
        >
          <p style={{ margin: '0 0 var(--space-3)', fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--text)' }}>
            직접 항목 추가
          </p>
          <datalist id="adp-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <div className="responsive-grid-cols-2" style={{ marginBottom: 'var(--space-3)' }}>
            <div>
              <label className="label" htmlFor="adp-new-cat">구분</label>
              <input id="adp-new-cat" className="input-field"
                list="adp-categories"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder="예: 영업"
              />
            </div>
            <div>
              <label className="label" htmlFor="adp-new-sec">섹션</label>
              <select id="adp-new-sec" className="input-field"
                value={newSection}
                onChange={(e) => setNewSection(e.target.value as DraftSection)}
              >
                {SECTION_ORDER.map((s) => (
                  <option key={s} value={s}>{SECTION_LABELS[s]}</option>
                ))}
              </select>
            </div>
          </div>
          <label className="label" htmlFor="adp-new-content">내용</label>
          <textarea id="adp-new-content" className="input-field"
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            rows={2}
            placeholder="추가할 내용을 입력하세요"
            style={{ resize: 'vertical' }}
          />
          <div style={{ marginTop: 'var(--space-3)' }}>
            <NbButton variant="secondary" onClick={addManual} disabled={!newContent.trim()}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                <Plus size={16} /> 항목 추가
              </span>
            </NbButton>
          </div>
        </div>
      )}

      {/* 저장 */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <NbButton onClick={handleSave} disabled={saving || loading}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}>
            <Save size={16} /> {saving ? '저장 중…' : '주간보고 저장'}
          </span>
        </NbButton>
      </div>
    </div>
  )
}
