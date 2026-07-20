'use client'

import { DOC_TYPES, DOC_TYPE_LABEL, type DocType } from '@/lib/ai-chat/grouping/classify-doc'

interface Props {
  docType: DocType
  docTypeLabel: string
  docTypeSource: 'ai' | 'instruction'
  onChangeType: (next: DocType) => void
  disabled?: boolean
}

/** 문서 유형 배지 + 변경 select. 지시로 확정된 유형은 AI 판정과 구분해 표시(§B). */
export default function DocTypeBadge({ docType, docTypeLabel, docTypeSource, onChangeType, disabled }: Props) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.35rem',
          fontSize: 'var(--fs-lg)',
          fontWeight: 700,
          color: 'var(--text)',
        }}
      >
        {docTypeLabel}로 판정됨
      </span>
      {docTypeSource === 'instruction' && (
        <span className="badge" data-status="planned">
          지시로 확정
        </span>
      )}
      <label className="label" htmlFor="doc-type-select" style={{ marginLeft: 'var(--space-2)' }}>
        유형 바꾸기
      </label>
      <select className="input-field"
        id="doc-type-select"
        value={docType}
        disabled={disabled}
        onChange={(e) => onChangeType(e.target.value as DocType)}
        style={{ width: 'auto', minHeight: 36 }}
      >
        {DOC_TYPES.map((t) => (
          <option key={t} value={t}>
            {DOC_TYPE_LABEL[t]}
          </option>
        ))}
      </select>
    </div>
  )
}
