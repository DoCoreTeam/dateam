'use client'

// components/ci/EvidenceSheet.tsx — 산출 근거 시트 (설계서 §6.5)
// 수치의 포함 표본, 제외 사유, 수집 방법을 보여준다.
// "정의가 궁금하면 탭 한 번으로 산출 근거까지 열람"(§4.3)의 종착지다.

import { X } from 'lucide-react'
import { useEscClose } from '@/lib/use-esc-close'
import type { CiEvidence } from '@/lib/ci/contracts'
import { SkelList } from '@/components/ui/LoadingSkeleton'

export default function EvidenceSheet({
  evidence, onClose,
}: { evidence: CiEvidence | null; onClose: () => void }) {
  useEscClose(onClose)

  return (
    <div
      className="ci-sheet-backdrop"
      onClick={onClose}
      role="presentation"
      style={{ zIndex: 'calc(var(--z-modal) + 1)' }}
    >
      <aside
        className="ci-sheet"
        style={{ width: 'min(480px, 100%)' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="산출 근거"
      >
        <header className="ci-sheet-head">
          <h2 className="tape-title" style={{ margin: 0 }}>산출 근거</h2>
          <button type="button" className="btn-ghost" onClick={onClose} aria-label="닫기">
            <X size={18} />
          </button>
        </header>

        <div className="ci-sheet-body">
          {!evidence && <SkelList rows={4} />}

          {evidence && (
            <>
              <p className="ci-basis" style={{ fontSize: 'var(--fs-sm)' }}>{evidence.basisText}</p>

              <dl style={{
                display: 'grid', gridTemplateColumns: 'auto 1fr',
                gap: 'var(--space-2)', margin: 'var(--space-4) 0', fontSize: 'var(--fs-sm)',
              }}>
                <dt className="ci-basis">포함 표본</dt>
                <dd className="ci-num">{evidence.includedCount}건</dd>
                <dt className="ci-basis">기간 창</dt>
                <dd className="ci-num">{evidence.windowDays}일</dd>
                <dt className="ci-basis">수집 방법</dt>
                <dd>{evidence.method ?? '—'}</dd>
                <dt className="ci-basis">수집 시각</dt>
                <dd>{evidence.fetchedAt ?? '—'}</dd>
              </dl>

              <section>
                <h3 style={{ fontSize: 'var(--fs-base)', fontWeight: 600, marginBottom: 'var(--space-2)' }}>
                  제외한 것과 그 이유
                </h3>
                {evidence.excludedReasons.length === 0 ? (
                  <p className="empty-state-desc">제외된 표본이 없습니다.</p>
                ) : (
                  <ul style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                    {evidence.excludedReasons.map((r) => (
                      <li key={r.reason} className="ci-card-meta">
                        <span>{r.reason}</span>
                        <span className="ci-num">{r.count}건</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {evidence.missingFields.length > 0 && (
                <section style={{ marginTop: 'var(--space-4)' }}>
                  <h3 style={{ fontSize: 'var(--fs-base)', fontWeight: 600, marginBottom: 'var(--space-2)' }}>
                    확보하지 못한 항목
                  </h3>
                  <p className="empty-state-desc">
                    {evidence.missingFields.join(', ')} — 추정값으로 채우지 않고 비워 둡니다.
                  </p>
                </section>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  )
}
