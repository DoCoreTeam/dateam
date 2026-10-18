'use client'

// AI로 고치기 — 지시를 받아 고칠 조각을 제안받고, 고른 조각만 다음 버전으로 남긴다 (P0132 I12a)
//
// **제안은 저장이 아니다.** 제안 창구(POST)는 아무것도 안 쓰고, 고른 조각을 반영(PATCH)할 때만
// 버전이 생긴다. 반영할 수 없는 조각(원문과 안 맞음, 여러 곳 등)은 고를 수 없게 그리고 까닭을 적는다.
// 숫자나 날짜가 바뀌는 조각은 기본으로 고르지 않는다 — 사람이 보고 고르게 한다.

import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import NbModal from '@/components/ui/nb/NbModal'
import NbButton from '@/components/ui/nb/NbButton'
import { failedTo, progress, ACTION } from '@/lib/terms'
import { CONTRACT_AI, CONTRACT_AI_REJECT, CONTRACT_DOC, CONTRACT_SCREEN } from '@/lib/terms/contract-doc'
import { contractApi, type ContractEditProposalJson, type ContractJson, type Outcome, type SaveResult } from './contract-api'
import styles from './contract-modal.module.css'

/** 서버가 받는 지시 길이 상한과 같다(CONTRACT_AI.instructionTooLong) */
const MAX_INSTRUCTION = 1000

interface Props {
  contract: ContractJson
  onClose: () => void
  onSaved: (r: SaveResult) => void
  onFailed: (o: Extract<Outcome<unknown>, { ok: false }>) => void
}

export default function ContractAiEditModal({ contract, onClose, onSaved, onFailed }: Props) {
  const [instruction, setInstruction] = useState('')
  const [proposal, setProposal] = useState<ContractEditProposalJson | null>(null)
  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set())
  const [busy, setBusy] = useState<'propose' | 'apply' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function propose() {
    if (busy) return
    const text = instruction.trim()
    if (!text) { setError(CONTRACT_AI.instructionRequired); return }
    setBusy('propose')
    setError(null)
    setProposal(null)
    const out = await contractApi.propose(contract.id, failedTo(CONTRACT_SCREEN.aiPropose, '받지'), text)
    setBusy(null)
    if (!out.ok) { setError(out.message); return }
    setProposal(out.body)
    setPicked(new Set(out.body.pieces.flatMap((p, i) => (p.ok && !p.numeric ? [i] : []))))
  }

  async function apply() {
    if (busy || !proposal) return
    const pieces = proposal.pieces.filter((p, i) => p.ok && picked.has(i))
    if (pieces.length === 0) { setError(CONTRACT_AI.noPieces); return }
    setBusy('apply')
    setError(null)
    const out = await contractApi.applyAi(contract.id, failedTo(CONTRACT_DOC.entity, '고치지'), {
      version: proposal.version,
      instruction: proposal.instruction,
      pieces: pieces.map(({ clause, before, after }) => ({ clause, before, after })),
    })
    setBusy(null)
    if (out.ok) { onSaved(out.body); return }
    if (out.code === 'CONFLICT') { onFailed(out); return }
    setError(out.message)
  }

  const toggle = (i: number) => setPicked((s) => {
    const next = new Set(s)
    if (next.has(i)) next.delete(i)
    else next.add(i)
    return next
  })

  const usable = proposal?.pieces.filter((p) => p.ok).length ?? 0
  const count = proposal ? proposal.pieces.filter((p, i) => p.ok && picked.has(i)).length : 0

  return (
    <NbModal
      title={CONTRACT_SCREEN.aiTitle}
      onClose={onClose}
      maxWidth={880}
      disableClose={busy !== null}
      footer={(
        <div className={styles.foot}>
          {error && <span className={styles.tagBad} role="alert">{error}</span>}
          <NbButton variant="ghost" disabled={busy !== null} onClick={onClose}>{ACTION.cancel}</NbButton>
          {proposal && usable > 0 && (
            <NbButton disabled={busy !== null || count === 0} onClick={() => void apply()}>
              {busy === 'apply' ? progress(CONTRACT_SCREEN.aiApply(count)) : CONTRACT_SCREEN.aiApply(count)}
            </NbButton>
          )}
        </div>
      )}
    >
      <div className={styles.body}>
        <label className={styles.field}>
          <span className="label">{CONTRACT_SCREEN.aiInstruction}</span>
          <textarea
            className="input-field" rows={3} value={instruction} maxLength={MAX_INSTRUCTION}
            placeholder={CONTRACT_SCREEN.aiPlaceholder} disabled={busy !== null}
            onChange={(e) => setInstruction(e.target.value)}
          />
        </label>
        <p className={styles.hint}>{CONTRACT_SCREEN.aiProposeHint}</p>
        <div>
          <NbButton variant="ghost" disabled={busy !== null} onClick={() => void propose()}>
            <Sparkles size={16} aria-hidden /> {busy === 'propose' ? progress(CONTRACT_SCREEN.aiPropose) : CONTRACT_SCREEN.aiPropose}
          </NbButton>
        </div>

        {proposal && usable === 0 && <p className={styles.hint} role="status">{CONTRACT_SCREEN.aiNoUsable}</p>}
        {proposal && proposal.pieces.length > 0 && (
          <ol className={styles.pieces}>
            {proposal.pieces.map((p, i) => {
              const on = p.ok && picked.has(i)
              const cls = [styles.piece, on ? styles.piecePicked : '', p.ok ? '' : styles.pieceRejected].filter(Boolean).join(' ')
              return (
                <li key={`${p.clause}-${i}`} className={cls}>
                  <div className={styles.pieceHead}>
                    <strong>{CONTRACT_SCREEN.aiClause(p.clause)}</strong>
                    {p.numeric && <span className={styles.tagWarn}>{CONTRACT_AI.numeric}</span>}
                    {p.ok ? (
                      <label className={styles.pick}>
                        <input type="checkbox" checked={on} disabled={busy !== null} onChange={() => toggle(i)} />
                        {CONTRACT_SCREEN.aiPick(i + 1)}
                      </label>
                    ) : (
                      <span className={styles.tagBad}>
                        {CONTRACT_SCREEN.aiRejected}{p.reject ? ` · ${CONTRACT_AI_REJECT[p.reject] ?? p.reject}` : ''}
                      </span>
                    )}
                  </div>
                  <div className={styles.compare}>
                    <div className={styles.side}>
                      <span className={styles.sideLabel}>{CONTRACT_SCREEN.aiBefore}</span>
                      <p className={styles.before}>{p.before}</p>
                    </div>
                    <div className={styles.side}>
                      <span className={styles.sideLabel}>{CONTRACT_SCREEN.aiAfter}</span>
                      <p className={styles.after}>{p.after}</p>
                    </div>
                  </div>
                  {p.why && <p className={styles.why}>{p.why}</p>}
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </NbModal>
  )
}
