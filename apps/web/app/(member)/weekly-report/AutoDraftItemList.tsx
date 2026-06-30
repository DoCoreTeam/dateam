// 주간보고 AI 자동초안 — 자동영역(카테고리 → 섹션 2층) 렌더 전담(presentational).
// 컨테이너(AutoDraftPanel)가 상태·저장을 소유하고, 이 컴포넌트는 그룹핑·표시·항목 콜백만 담당.
'use client'

import { X } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import { isLowConfidence } from '@/lib/weekly-report/classify'
import type { DraftItem, DraftSection } from '@/lib/weekly-report/draft-types'

export const SECTION_ORDER: DraftSection[] = ['performance', 'plan', 'issues']
export const SECTION_LABELS: Record<DraftSection, string> = {
  performance: '성과',
  plan: '계획',
  issues: '이슈',
}

interface GroupedSection {
  section: DraftSection
  entries: { item: DraftItem; idx: number }[]
}
interface GroupedCategory {
  category: string
  sections: GroupedSection[]
}

/** items(평면 배열)를 카테고리 → 섹션 2층으로 묶는다(등장 순서 보존). idx는 원본 배열 인덱스. */
function groupItems(items: DraftItem[]): GroupedCategory[] {
  const order: string[] = []
  const map = new Map<string, Map<DraftSection, { item: DraftItem; idx: number }[]>>()
  items.forEach((item, idx) => {
    const cat = item.category || '기타'
    if (!map.has(cat)) {
      map.set(cat, new Map())
      order.push(cat)
    }
    const secMap = map.get(cat)!
    if (!secMap.has(item.section)) secMap.set(item.section, [])
    secMap.get(item.section)!.push({ item, idx })
  })
  return order.map((cat) => {
    const secMap = map.get(cat)!
    return {
      category: cat,
      sections: SECTION_ORDER.filter((s) => secMap.has(s)).map((s) => ({
        section: s,
        entries: secMap.get(s)!,
      })),
    }
  })
}

interface AutoDraftItemListProps {
  items: DraftItem[]
  onToggle: (idx: number, included: boolean) => void
  onEdit: (idx: number, content: string) => void
  onRemove: (idx: number) => void
}

export default function AutoDraftItemList({ items, onToggle, onEdit, onRemove }: AutoDraftItemListProps) {
  const grouped = groupItems(items)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)', marginBottom: 'var(--space-5)' }}>
      {grouped.map((cat) => (
        <section key={cat.category}>
          <h3
            style={{
              margin: '0 0 var(--space-2)',
              fontSize: 'var(--fs-lg)',
              fontWeight: 700,
              letterSpacing: '-0.02em',
              color: 'var(--text)',
            }}
          >
            {cat.category}
          </h3>
          {cat.sections.map((sec) => (
            <div key={sec.section} style={{ marginBottom: 'var(--space-3)' }}>
              <p style={{ margin: '0 0 var(--space-1)', fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-muted)' }}>
                {SECTION_LABELS[sec.section]}
              </p>
              {sec.entries.map(({ item, idx }) => (
                <div
                  key={item.id ?? `local-${idx}`}
                  style={{
                    display: 'flex',
                    gap: 'var(--space-2)',
                    alignItems: 'flex-start',
                    padding: 'var(--space-2) 0',
                    borderTop: 'var(--hairline) solid var(--border-light)',
                    opacity: item.isIncluded ? 1 : 0.45,
                  }}
                >
                  <input type="checkbox"
                    checked={item.isIncluded}
                    onChange={(e) => onToggle(idx, e.target.checked)}
                    aria-label="보고에 포함"
                    style={{ width: 20, height: 20, marginTop: 6, flexShrink: 0, cursor: 'pointer' }}
                  />
                  <textarea className="input-field"
                    value={item.content}
                    onChange={(e) => onEdit(idx, e.target.value)}
                    rows={2}
                    style={{ flex: 1, minWidth: 0, resize: 'vertical' }}
                  />
                  {isLowConfidence(item) && (
                    <span style={{ flexShrink: 0, marginTop: 6 }}>
                      <NbBadge status="note">확인요</NbBadge>
                    </span>
                  )}
                  <NbButton
                    variant="ghost"
                    onClick={() => onRemove(idx)}
                    aria-label="항목 삭제"
                    style={{ flexShrink: 0, minWidth: 44, minHeight: 44, padding: 'var(--space-2)' }}
                  >
                    <X size={16} />
                  </NbButton>
                </div>
              ))}
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}
