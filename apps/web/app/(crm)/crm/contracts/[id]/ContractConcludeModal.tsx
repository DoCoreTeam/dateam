'use client'

// 체결 — 서명본을 고르고 지금 버전으로 체결한다 (P0132 I12a)
//
// 서명본은 이 딜에 계약서 종류로 올린 파일 중에서만 고른다(서버가 같은 조건으로 다시 본다).
// 올리기는 기존 첨부 부품을 그대로 쓴다 — 올리고 나면 목록을 다시 읽어 바로 고를 수 있다.
// 이 단추를 관리자에게만 그리는 것은 화면의 일이고, 거절은 서버가 한다.

import { useCallback, useEffect, useState } from 'react'
import { Stamp } from 'lucide-react'
import NbModal from '@/components/ui/nb/NbModal'
import NbButton from '@/components/ui/nb/NbButton'
import AXDotLoader from '@/components/ui/AXDotLoader'
import ErrorState from '@/components/ui/ErrorState'
import AttachmentPanel from '@/components/ui/crm/AttachmentPanel'
import { failedTo, progress, ACTION } from '@/lib/terms'
import { CONTRACT_DOC, CONTRACT_SCREEN } from '@/lib/terms/contract-doc'
import { contractApi, type ContractJson, type Outcome, type SignedFile } from './contract-api'
import styles from './contract-modal.module.css'

interface Props {
  contract: ContractJson
  onClose: () => void
  onDone: (row: ContractJson) => void
  onFailed: (o: Extract<Outcome<unknown>, { ok: false }>) => void
}

type Load = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ok'; items: SignedFile[] }

export default function ContractConcludeModal({ contract, onClose, onDone, onFailed }: Props) {
  const [files, setFiles] = useState<Load>({ kind: 'loading' })
  const [picked, setPicked] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [seq, setSeq] = useState(0)

  const load = useCallback(async () => {
    setFiles({ kind: 'loading' })
    const out = await contractApi.signedFiles(contract.dealId, CONTRACT_SCREEN.signedLoadFailed)
    if (!out.ok) { setFiles({ kind: 'error', message: out.message }); return }
    const items = out.body
    setFiles({ kind: 'ok', items })
    setPicked((p) => (p && items.some((f) => f.id === p) ? p : items[0]?.id ?? null))
  }, [contract.dealId])

  useEffect(() => { void load() }, [load])

  async function conclude() {
    if (busy) return
    if (!picked) { setError(CONTRACT_SCREEN.signedRequired); return }
    setBusy(true)
    setError(null)
    const out = await contractApi.act(contract.id, failedTo(CONTRACT_DOC.entity, '체결하지'), {
      action: 'conclude', version: contract.version, signedAttachmentId: picked,
    })
    setBusy(false)
    if (out.ok) { onDone(out.body); return }
    if (out.code === 'CONFLICT') { onFailed(out); return }
    setError(out.message)
  }

  return (
    <NbModal
      title={CONTRACT_SCREEN.concludeTitle(contract.contractNo)}
      onClose={onClose}
      maxWidth={640}
      disableClose={busy}
      footer={(
        <div className={styles.foot}>
          {error && <span className={styles.tagBad} role="alert">{error}</span>}
          <NbButton variant="ghost" disabled={busy} onClick={onClose}>{ACTION.cancel}</NbButton>
          <NbButton disabled={busy || !picked} onClick={() => void conclude()}>
            <Stamp size={16} aria-hidden /> {busy ? progress(CONTRACT_SCREEN.conclude) : CONTRACT_SCREEN.conclude}
          </NbButton>
        </div>
      )}
    >
      <div className={styles.body}>
        <p className={styles.hint}>{CONTRACT_SCREEN.concludeBody(contract.currentVersionNo)}</p>
        <section className={styles.section} aria-labelledby="contract-signed-title">
          <h3 id="contract-signed-title" className={styles.sectionTitle}>{CONTRACT_SCREEN.pickSigned}</h3>
          {files.kind === 'loading' && <AXDotLoader />}
          {files.kind === 'error' && <ErrorState message={files.message} onRetry={() => void load()} />}
          {files.kind === 'ok' && files.items.length === 0 && <p className={styles.hint}>{CONTRACT_SCREEN.signedNone}</p>}
          {files.kind === 'ok' && files.items.length > 0 && (
            <ul className={styles.signedList}>
              {files.items.map((f) => (
                <li key={f.id} className={styles.signedItem}>
                  <label className={styles.pick}>
                    <input
                      type="radio" name="contract-signed" value={f.id} checked={picked === f.id}
                      disabled={busy} onChange={() => setPicked(f.id)}
                    />
                    <span className={styles.signedName}>{f.fileName}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </section>
        <AttachmentPanel
          target="DEAL"
          targetId={contract.dealId}
          defaultKind="CONTRACT"
          reloadKey={seq}
          onChanged={() => { setSeq((n) => n + 1); void load() }}
        />
      </div>
    </NbModal>
  )
}
