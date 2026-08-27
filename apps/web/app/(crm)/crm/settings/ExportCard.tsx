'use client'

// 내보내기 (dacrm FR-13, P0)
//
// **왜 필요한가**: 영업은 "엑셀로 뽑아 줘"를 매주 듣는다 — 임원 보고·정산·세무.
// 그걸 못 하면 사람은 CRM 을 **다시 엑셀로 옮겨 적는다**.
// 그 순간 CRM 은 이중 입력을 만드는 도구가 되고 아무도 최신으로 유지하지 않는다.
//
// 파일은 서버가 만들어 그대로 내려보낸다 — 화면이 만들면 큰 목록에서 브라우저가 멈추고,
// CSV 이스케이프(수식 인젝션 방어)를 화면이 또 구현하게 된다.

import { useState } from 'react'
import { downloadFromApi } from '@/lib/crm/api/download'
import { Download } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import { EXPORT_LABEL, type ExportKind } from '@/lib/crm/services/export'
import styles from './settings.module.css'

const KINDS: ExportKind[] = ['companies', 'people', 'deals', 'meetings', 'tasks']

export default function ExportCard() {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function download(kind: ExportKind) {
    setBusy(kind)
    setError(null)
    setNotice(null)
    try {
      // 내려받기·실패 표시·파일명 꺼내기는 공용 SSOT 가 한다(lib/crm/api/download)
      const out = await downloadFromApi(
        `/api/crm/export?kind=${kind}`, `crm_${kind}.csv`, '내려받지 못했습니다.',
      )
      if (!out.ok) { setError(out.message ?? '내려받지 못했습니다.'); return }

      const rows = out.headers?.get('X-Crm-Rows') ?? '?'
      const truncated = out.headers?.get('X-Crm-Truncated') === '1'

      setNotice(
        `${EXPORT_LABEL[kind]} ${rows}건을 받았어요.` +
        (truncated ? ' 너무 많아 앞부분만 담겼습니다 — 나머지는 화면에서 조건을 좁혀 확인해 주세요.' : ''),
      )
    } catch {
      setError('내려받지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className={`card ${styles.card}`}>
      <h2 className={styles.cardTitle}>엑셀로 내려받기</h2>
      <p className={styles.cardDesc}>
        보고·정산에 쓸 수 있게 CSV 로 받습니다. 엑셀에서 바로 열리고, 금액은 계산할 수 있는 숫자로 들어갑니다.
      </p>

      <FormErrorBanner message={error} />
      {notice && <p className={styles.undo}>{notice}</p>}

      <div className={styles.actions}>
        {KINDS.map((k) => (
          <NbButton key={k} variant="ghost" disabled={busy === k} onClick={() => void download(k)}>
            <Download size={14} /> {busy === k ? '받는 중…' : EXPORT_LABEL[k]}
          </NbButton>
        ))}
      </div>
    </div>
  )
}
