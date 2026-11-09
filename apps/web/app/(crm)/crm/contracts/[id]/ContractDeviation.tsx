'use client'

// 표준 이탈 칸 — 표준과 다른 조항을 보이고 관리자가 이 버전을 승인한다 (P0184 I12b)
//
// 판정은 서버(contract-deviation.ts)가 한다. 화면은 받은 목록을 그리고, 체결 가능 여부를
// 부모에 넘겨 체결 단추를 막는다. 승인 단추를 관리자에게만 그리는 것은 화면의 일이고, 거절은 서버가 한다.

import { useCallback, useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import { useAskDialog } from '@/components/ui/useAskDialog'
import { withSubmitGuard } from '@/lib/forms/submit-guard'
import { formatKstDateTimeExact } from '@/lib/datetime/kst'
import { progress } from '@/lib/terms'
import { CONTRACT_DEVIATION_MSG, CONTRACT_DEVIATION_PANEL as T } from '@/lib/terms/contract-doc'
import { contractApi, type ContractJson, type DeviationStateJson } from './contract-api'
import styles from './contract-view.module.css'

interface Props {
  contract: ContractJson
  canApprove: boolean
  onState: (s: DeviationStateJson | null) => void
  onApproved: (text: string) => void
}

export default function ContractDeviation({ contract, canApprove, onState, onApproved }: Props) {
  const { ask, dialog } = useAskDialog()
  const [state, setState] = useState<DeviationStateJson | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const out = await contractApi.deviations(contract.id, T.loadFailed)
    if (out.ok) { setState(out.body); setError(null); onState(out.body) } else { setState(null); setError(out.message); onState(null) }
  }, [contract.id, onState])

  // 버전이 바뀔 때마다 다시 센다 — 본문을 고치면 이탈과 승인 효력이 바뀐다
  useEffect(() => { void load() }, [load, contract.version])

  async function approve(n: number) {
    const ok = await ask.confirm({ title: T.approveTitle(n), body: T.approveBody, confirmLabel: T.approve })
    if (!ok) return
    setBusy(true)
    await withSubmitGuard(async () => {
      const out = await contractApi.approveDeviations(contract.id, T.approveFailed, { version: contract.version })
      if (!out.ok) { setError(out.message); return }
      setState(out.body)
      onState(out.body)
      onApproved(T.approvedDone)
    }, { onError: setError, onDone: () => setBusy(false) })
  }

  if (error) return <p className={styles.danger} role="alert">{error}</p>
  if (!state || state.deviations.length === 0) return null
  const n = state.deviations.length
  const approvedHere = state.canConclude && state.approval

  return (
    <section className={styles.refill} aria-labelledby="contract-deviation-title">
      <h2 id="contract-deviation-title" className={styles.refillTitle}>{T.title(n)}</h2>
      <ul className={styles.fieldChips}>
        {state.deviations.map((d) => (
          <li key={`${d.clauseId}-${d.reason}`} className={styles.chip}>{d.title} · {CONTRACT_DEVIATION_MSG.reason[d.reason]}</li>
        ))}
      </ul>
      {approvedHere ? (
        <p className={styles.refillBody}>{T.approved(formatKstDateTimeExact(state.approval!.approvedAt))}</p>
      ) : (
        <p className={styles.refillBody}>{canApprove ? T.needsApproval : T.askAdmin}</p>
      )}
      {canApprove && !approvedHere && contract.status === 'DRAFT' && (
        <div>
          <NbButton variant="ghost" disabled={busy} onClick={() => void approve(n)}>
            <ShieldCheck size={16} aria-hidden /> {busy ? progress(T.approve) : T.approve}
          </NbButton>
        </div>
      )}
      {dialog}
    </section>
  )
}
