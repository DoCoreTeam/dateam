'use client'

import { useEscClose } from '@/lib/use-esc-close'
import { AlertTriangle, Trash2, X } from 'lucide-react'

export interface ImpactDeleteDialogProps {
  /** 다이얼로그 제목 (예: "견적 삭제") */
  title: string
  /** 삭제 대상 설명 (예: "H100 80GB 견적") */
  subject: string
  /** 영향 건수 요약 (없으면 단순 확인) */
  impactDetail?: Record<string, number>
  /** 로딩 상태 */
  busy?: boolean
  /** 오류 메시지 */
  error?: string | null
  /** 취소 */
  onCancel: () => void
  /** 확인(force=false 첫 시도 또는 force=true 재시도) */
  onConfirm: (force: boolean) => void
  /** 이미 impact 응답을 받아 force 프롬프트 모드인지 */
  forceMode?: boolean
}

const IMPACT_LABELS: Record<string, string> = {
  is_selected: '채택된 견적',
  is_current: '현재 적용 중인 직접 판매가',
  supply_quotes: '연결된 공급 견적',
  market_prices: '연결된 시장 가격',
  availability: '연결된 재고 데이터',
  pool_stock: '연결된 풀 재고',
}

export default function ImpactDeleteDialog({
  title,
  subject,
  impactDetail,
  busy,
  error,
  onCancel,
  onConfirm,
  forceMode = false,
}: ImpactDeleteDialogProps) {
  useEscClose(onCancel)

  const impactEntries = impactDetail
    ? Object.entries(impactDetail).filter(([, v]) => v > 0)
    : []

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="impact-dialog-title"
      className="gpu-modal-backdrop"
      onClick={onCancel}
    >
      <div
        className="gpu-modal-card gpu-modal-card--sm"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="gpu-modal-header">
          <span className="gpu-modal-header-icon gpu-modal-header-icon--danger">
            <Trash2 size={16} />
          </span>
          <strong id="impact-dialog-title" className="gpu-modal-title">{title}</strong>
          <button
            type="button"
            onClick={onCancel}
            aria-label="닫기"
            className="gpu-modal-close"
          >
            <X size={16} />
          </button>
        </div>

        {/* 본문 */}
        <div className="gpu-modal-body">
          {forceMode && impactEntries.length > 0 ? (
            <>
              <div className="gpu-warning-banner">
                <AlertTriangle size={18} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 1 }} />
                <div style={{ fontSize: 'var(--fs-sm)' }}>
                  <strong style={{ color: 'var(--warning)', display: 'block', marginBottom: 4 }}>
                    연결된 데이터가 있습니다
                  </strong>
                  <span style={{ color: 'var(--text-muted)' }}>
                    <strong>{subject}</strong>을 삭제하면 아래 데이터도 함께 삭제됩니다.
                  </span>
                </div>
              </div>

              <ul style={{
                margin: 0, padding: '0 0 0 var(--space-5)',
                display: 'flex', flexDirection: 'column', gap: 'var(--space-1)',
              }}>
                {impactEntries.map(([key, count]) => (
                  <li key={key} style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
                    <span style={{ fontWeight: 600, color: 'var(--text)' }}>
                      {IMPACT_LABELS[key] ?? key}
                    </span>
                    {' '}{count}건
                  </li>
                ))}
              </ul>

              <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
                계속 진행하시겠습니까?
              </p>
            </>
          ) : (
            <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
              <strong style={{ color: 'var(--text)' }}>{subject}</strong>을 삭제합니다. 이 작업은 취소할 수 없습니다.
            </p>
          )}

          {error && <div className="gpu-field-error">{error}</div>}
        </div>

        {/* 하단 액션 */}
        <div className="gpu-modal-footer">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="gpu-btn"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => onConfirm(forceMode)}
            disabled={busy}
            className="gpu-btn gpu-btn-danger-solid"
          >
            {busy ? '삭제 중…' : forceMode ? '강제 삭제' : '삭제'}
          </button>
        </div>
      </div>
    </div>
  )
}
