'use client'

import type { DocType } from '@/lib/ai-chat/grouping/classify-doc'

interface Props {
  docType: DocType
  docTypeLabel: string
  docTypeSource: 'ai' | 'instruction'
}

/**
 * 문서 유형 배지 (읽기 전용 + 재지시 안내).
 *
 * 계약 D: 유형 변경도 "지시"로 한다 — 드롭다운 같은 별도 컨트롤을 두지 않는다.
 * 유형이 틀리면 사용자가 아래 "다시 묶기"에 "회의록으로 묶어"처럼 적으면 되고,
 * 그 문장을 서버(regroupSession)가 docTypeFromCommand로 감지해 유형을 바꾼다.
 * (드롭다운은 발견성이 낮고, 지시-지배 원칙과도 어긋나 제거했다.)
 */
export default function DocTypeBadge({ docTypeLabel, docTypeSource }: Props) {
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
      <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-faint)' }}>
        유형이 다르면 아래 &ldquo;다시 묶기&rdquo;에 <b>&ldquo;회의록으로&rdquo;</b>처럼 적으세요
      </span>
    </div>
  )
}
