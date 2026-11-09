'use client'

// 계약 정보 고치기 — 만들 때 고른 방향 양식 종류 제목 당사자 (P0184 I10)
//
// 당사자를 바꾸면 서버가 당사자에서 채운 칸을 새로 채운 다음 버전을 남긴다.
// 견적에서 만든 계약의 당사자는 견적을 따르므로 여기서 안 고친다.

import { useState } from 'react'
import NbButton from '@/components/ui/nb/NbButton'
import NbModal from '@/components/ui/nb/NbModal'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import { ACTION, progress } from '@/lib/terms'
import { CONTRACT_CREATE_BLANK as T, CONTRACT_KIND_LABEL as K, CONTRACT_META } from '@/lib/terms/contract-doc'
import ContractPartiesField, { fromPartyRows, toPartyInput, type Direction, type PartyDraft } from '../ContractPartiesField'
import { DIRECTIONS, DOC_LAYERS, FORM_OWNERS } from '../ContractCreateModal'
import styles from '@/components/ui/crm/contract/contract.module.css'

export interface ContractMetaSource {
  id: string
  version: number
  title: string
  direction: string
  formOwner: string
  docLayer: string
  quoteId: string | null
}

interface Props {
  contract: ContractMetaSource
  parties: { role: string; isSelf: boolean; snapshot: { name?: string; bizNo?: string } }[]
  canCorporate: boolean
  onClose: () => void
  onSaved: () => void
}

export default function ContractMetaModal({ contract, parties: initial, canCorporate, onClose, onSaved }: Props) {
  const [direction, setDirection] = useState<Direction>(contract.direction as Direction)
  const [docLayer, setDocLayer] = useState(contract.docLayer)
  const [formOwner, setFormOwner] = useState(contract.formOwner)
  const [title, setTitle] = useState(contract.title)
  const [parties, setParties] = useState<PartyDraft[]>(fromPartyRows(initial))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fromQuote = contract.quoteId !== null

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/crm/contracts/${contract.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: contract.version, title, direction, formOwner, docLayer,
          ...(fromQuote ? {} : { parties: toPartyInput(parties) }),
        }),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => null)
        setError(b?.error?.message ?? CONTRACT_META.saveFailed)
        return
      }
      onSaved()
    } catch {
      setError(CONTRACT_META.saveFailed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <NbModal
      title={CONTRACT_META.title}
      onClose={() => !busy && onClose()}
      maxWidth={760}
      footer={
        <div className={styles.foot}>
          <span className={styles.footNote}>{fromQuote ? CONTRACT_META.partiesFollowQuote : ''}</span>
          <span className={styles.itemActions}>
            <NbButton variant="ghost" onClick={onClose} disabled={busy}>{ACTION.cancel}</NbButton>
            <NbButton onClick={() => void save()} disabled={busy}>{busy ? progress(ACTION.save) : ACTION.save}</NbButton>
          </span>
        </div>
      }
    >
      <div className={styles.form}>
        <FormErrorBanner message={error} />
        <div className={styles.field}>
          <label className="label" htmlFor="cm-title">{T.name}</label>
          <input id="cm-title" className="input-field" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className={styles.row}>
          <div className={styles.field}>
            <label className="label" htmlFor="cm-direction">{T.direction}</label>
            <select id="cm-direction" className="input-field" value={direction} onChange={(e) => setDirection(e.target.value as Direction)}>
              {DIRECTIONS.filter((d) => d !== 'CORPORATE' || canCorporate || contract.direction === 'CORPORATE').map((d) => <option key={d} value={d}>{K.direction[d]}</option>)}
            </select>
          </div>
          <div className={styles.field}>
            <label className="label" htmlFor="cm-layer">{T.docLayer}</label>
            <select id="cm-layer" className="input-field" value={docLayer} onChange={(e) => setDocLayer(e.target.value)}>
              {[...new Set([...DOC_LAYERS, contract.docLayer])].map((d) => <option key={d} value={d}>{K.docLayer[d as keyof typeof K.docLayer] ?? d}</option>)}
            </select>
          </div>
          <div className={styles.field}>
            <label className="label" htmlFor="cm-owner">{T.formOwner}</label>
            <select id="cm-owner" className="input-field" value={formOwner} onChange={(e) => setFormOwner(e.target.value)}>
              {FORM_OWNERS.map((d) => <option key={d} value={d}>{K.formOwner[d]}</option>)}
            </select>
          </div>
        </div>
        {!fromQuote && <ContractPartiesField parties={parties} onChange={setParties} />}
      </div>
    </NbModal>
  )
}
