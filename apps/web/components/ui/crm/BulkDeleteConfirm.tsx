'use client'

// components/ui/crm/BulkDeleteConfirm.tsx — 여러 건을 지우기 전 확인 (R-5)
//
// **왜 확인창이 필요한가**: 목록에서 20건을 골라 한 번 누르면 20건이 사라진다.
// 한 건짜리 삭제에는 `DeleteRecordModal` 이 있었는데 일괄에는 아무것도 없었다 —
// 없으면 **되돌릴 수 없는 일이 확인 없이 일어난다**(R-5: 확인창이 유일한 안전장치다).
//
// 여기서는 개별 영향을 미리 볼 수 없다(N건의 관계를 다 세면 화면을 여는 데만 오래 걸린다).
// 대신 **되돌릴 수 있다는 사실과 그 기한**을 분명히 말한다 — 그것이 사용자가
// "눌러도 되나"를 판단하는 데 실제로 필요한 정보다.

import NbModal from '@/components/ui/nb/NbModal'
import NbButton from '@/components/ui/nb/NbButton'
import { TRASH_RETENTION_DAYS } from '@/lib/crm/domain/soft-delete'

interface Props {
  /** 사람이 읽는 대상 이름 — "회사"·"인물"·"딜" */
  entity: string
  /** 고른 이름들. 앞 몇 개만 보여 주고 나머지는 수로 접는다 */
  names: string[]
  busy?: boolean
  onConfirm: () => void
  onClose: () => void
}

/** 이름을 다 적으면 확인창이 목록이 된다 — 앞 5개만 보여 주고 나머지는 센다 */
const NAMES_SHOWN = 5

export default function BulkDeleteConfirm({ entity, names, busy, onConfirm, onClose }: Props) {
  const shown = names.slice(0, NAMES_SHOWN)
  const rest = names.length - shown.length

  return (
    <NbModal
      title={`${entity} ${names.length.toLocaleString()}건을 휴지통으로 보낼까요?`}
      onClose={onClose}
      maxWidth={460}
      footer={
        <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
          <NbButton variant="ghost" onClick={onClose} disabled={busy}>취소</NbButton>
          <NbButton variant="danger" onClick={onConfirm} disabled={busy}>
            {busy ? '처리 중…' : '휴지통으로 보내기'}
          </NbButton>
        </div>
      }
    >
      <p style={{ margin: 0, color: 'var(--text)' }}>
        {shown.join(' · ')}
        {rest > 0 && ` 외 ${rest.toLocaleString()}건`}
      </p>
      <p style={{ margin: 'var(--space-3) 0 0', color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>
        {TRASH_RETENTION_DAYS}일 안에는 휴지통에서 되돌릴 수 있어요.
      </p>
    </NbModal>
  )
}
