'use client'

// components/ui/ConfirmDeleteDialog.tsx — 되돌릴 수 없는 삭제 확인 (SSOT)
//
// 왜 부품으로 두나: 삭제 자리가 8곳이 넘는데 화면마다 확인창을 자작하면
//   어떤 곳은 "정말요?"만 묻고 어떤 곳은 무엇이 사라지는지 안 알려 준다.
//   **되돌릴 수 없는 일**이라 그 편차가 곧 사고다.
//
// 이 제품의 삭제는 소프트가 아니라 **진짜 삭제**다(사용자 결정 2026-08-16).
//   되돌리기 토스트로 수습할 수 없으므로 안전장치는 **누르기 전**에 있어야 한다:
//     ① 무엇을 지우는지 이름으로 보여 준다
//     ② 무엇이 함께 사라지는지 수로 보여 준다(서버가 센 값)
//     ③ 사라지지 않고 연결만 끊기는 것도 밝힌다 — 안 밝히면 다 없어지는 줄 안다
//     ④ 되돌릴 수 없다고 말한다
//
// 모달 표준(CLAUDE.md §2-2)은 NbModal이 이미 지킨다 — ESC·X·tape-title·광원형 그림자.

import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import NbModal from '@/components/ui/nb/NbModal'
import NbButton from '@/components/ui/nb/NbButton'
import AXDotLoader from '@/components/ui/AXDotLoader'

export interface DeleteImpactView {
  label: string | null
  cascades: { what: string; count: number }[]
  detaches: { what: string; count: number }[]
  blocked: string | null
}

interface Props {
  /** 대화상자 제목 — "게시물을 지울까요?"처럼 무엇인지 드러낸다 */
  title: string
  /** 영향을 아직 세는 중이면 null */
  impact: DeleteImpactView | null
  /** 영향을 세는 중인가 */
  loading?: boolean
  /** 삭제 진행 중인가 */
  busy?: boolean
  /** 서버가 돌려준 실패 사유 */
  errorMessage?: string | null
  onConfirm: () => void
  onClose: () => void
}

export default function ConfirmDeleteDialog({
  title, impact, loading = false, busy = false, errorMessage = null, onConfirm, onClose,
}: Props) {
  // 실수로 엔터를 눌러 지우는 일을 막는다 — 확인 버튼에 자동 포커스를 주지 않는다.
  const [ready, setReady] = useState(false)
  useEffect(() => { const t = setTimeout(() => setReady(true), 250); return () => clearTimeout(t) }, [])

  const blocked = impact?.blocked ?? null
  const canDelete = !loading && !busy && ready && !blocked

  return (
    <NbModal title={title} onClose={busy ? () => {} : onClose} maxWidth={480} disableClose={busy}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {loading && (
          <p className="ci-basis" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <AXDotLoader size={5} /> 무엇이 사라지는지 확인하는 중입니다
          </p>
        )}

        {!loading && blocked && (
          <p className="ci-status ci-status-warn" role="status">{blocked}</p>
        )}

        {!loading && !blocked && impact && (
          <>
            {impact.label && (
              <p style={{ fontWeight: 600, wordBreak: 'break-all' }}>{impact.label}</p>
            )}

            {impact.cascades.length > 0 && (
              <div>
                <p className="ci-basis" style={{ marginBottom: 'var(--space-1)' }}>함께 사라집니다</p>
                <ul style={{ margin: 0, paddingLeft: '1.1em', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  {impact.cascades.map((c) => (
                    <li key={c.what}>{c.what} <span className="ci-num">{c.count}</span></li>
                  ))}
                </ul>
              </div>
            )}

            {impact.detaches.length > 0 && (
              <div>
                {/* 남는 것을 밝히지 않으면 "다 없어지는 줄 알고" 못 지운다 */}
                <p className="ci-basis" style={{ marginBottom: 'var(--space-1)' }}>남아 있습니다</p>
                <ul style={{ margin: 0, paddingLeft: '1.1em', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  {impact.detaches.map((d) => (
                    <li key={d.what}>{d.what} <span className="ci-num">{d.count}</span></li>
                  ))}
                </ul>
              </div>
            )}

            <p className="ci-status ci-status-danger" role="note"
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
              <AlertTriangle size={14} aria-hidden="true" />
              되돌릴 수 없습니다
            </p>
          </>
        )}

        {errorMessage && <p className="ci-status ci-status-danger" role="alert">{errorMessage}</p>}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}>
        <NbButton variant="ghost" onClick={onClose} disabled={busy}>취소</NbButton>
        <NbButton variant="danger" onClick={onConfirm} disabled={!canDelete}>
          {busy ? '지우는 중…' : '지웁니다'}
        </NbButton>
      </div>
    </NbModal>
  )
}
