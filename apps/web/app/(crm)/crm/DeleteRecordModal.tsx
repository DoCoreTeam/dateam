'use client'

// 레코드 삭제 확인 (dacrm — 사용자 결정: 휴지통 + 영구 삭제 둘 다)
//
// 회사·인물·딜이 같은 모달을 쓴다. 화면마다 확인창을 새로 그리면
// 어떤 화면에서는 되돌릴 수 있고 어떤 화면에서는 없는데 문구가 같아지는 일이 생긴다.
//
// 문구는 lib/crm/domain/soft-delete 의 describeDelete 가 만든다(SSOT).
// 두 방식의 결과가 다르므로 **고른 순간 문구가 바뀐다** — 무엇을 누르는지 모르고 누르면 안 된다.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import NbModal from '@/components/ui/nb/NbModal'
import NbButton from '@/components/ui/nb/NbButton'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import { planDelete, describeDelete, type DeleteMode, type DeleteImpact } from '@/lib/crm/domain/soft-delete'

interface Props {
  entity: string
  name: string
  /** DELETE 를 받는 주소. mode 는 이 모달이 쿼리로 붙인다 */
  endpoint: string
  redirectTo: string
  impact?: DeleteImpact
  onClose: () => void
}

export default function DeleteRecordModal({
  entity, name, endpoint, redirectTo, impact, onClose,
}: Props) {
  const router = useRouter()
  const [mode, setMode] = useState<DeleteMode>('trash')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const plan = planDelete(mode)
  const text = describeDelete(plan, impact ?? { removed: [], kept: [] })
  const blocked = impact?.blockedReason

  async function run() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`${endpoint}?mode=${mode}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setError(body?.error?.message ?? '삭제하지 못했습니다.')
        return
      }
      router.push(redirectTo)
      router.refresh()
    } catch {
      setError('삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <NbModal
      title={text.title}
      onClose={onClose}
      maxWidth={460}
      footer={
        <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
          <NbButton variant="ghost" onClick={onClose} disabled={busy}>취소</NbButton>
          <NbButton variant="danger" onClick={() => void run()} disabled={busy || Boolean(blocked)}>
            {busy ? '처리 중…' : text.confirmLabel}
          </NbButton>
        </div>
      }
    >
      <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
        <FormErrorBanner message={error ?? blocked ?? null} />

        <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
          {entity} <strong style={{ color: 'var(--text)' }}>{name}</strong> 을(를) 삭제합니다.
        </p>

        <div>
          <span className="label">삭제 방식</span>
          <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
            <label className="label" style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start', fontWeight: 400 }}>
              {/* 네이티브 라디오는 클래스를 붙이지 않는다 — 필드 배경·보더가 토글 렌더와 싸운다 */}
              <input type="radio" name="crm-delete-mode"
                checked={mode === 'trash'} onChange={() => setMode('trash')} />
              <span>
                <strong>휴지통으로 보내기</strong>
                <span style={{ display: 'block', fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)' }}>
                  30일 안에 되돌릴 수 있습니다.
                </span>
              </span>
            </label>
            <label className="label" style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start', fontWeight: 400 }}>
              <input type="radio" name="crm-delete-mode"
                checked={mode === 'purge'} onChange={() => setMode('purge')} />
              <span>
                <strong>영구 삭제</strong>
                <span style={{ display: 'block', fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)' }}>
                  기록이 완전히 사라집니다. 되돌릴 수 없습니다.
                </span>
              </span>
            </label>
          </div>
        </div>

        <ul style={{ margin: 0, paddingLeft: '1.1em', display: 'grid', gap: 4 }}>
          {text.body.map((line) => (
            <li key={line} style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)' }}>{line}</li>
          ))}
        </ul>
      </div>
    </NbModal>
  )
}
