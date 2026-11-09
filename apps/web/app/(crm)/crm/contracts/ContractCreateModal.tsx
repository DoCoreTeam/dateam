'use client'

// 딜 없이 계약서 만들기 (P0184 I10)
//
// 방향을 고르면 당사자 칸이 그 방향의 보통 모양으로 채워진다 (매출: 우리 공급자 + 상대 고객,
// 매입: 상대 공급자 + 우리 고객, 공동수급: 주관사 + 구성원). 고친 뒤 저장하면 서버가 다시 검사한다.
// 회사 단위 계약은 관리자만 고를 수 있게 그리지만, 막는 것은 서버다 (I02).

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import NbButton from '@/components/ui/nb/NbButton'
import NbModal from '@/components/ui/nb/NbModal'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import { ACTION, progress } from '@/lib/terms'
import { CONTRACT_CREATE_BLANK as T, CONTRACT_KIND_LABEL as K } from '@/lib/terms/contract-doc'
import { crmSettingsHref } from '@/lib/crm/domain/settings-tab'
import ContractPartiesField, { partiesFor, toPartyInput, type Direction, type PartyDraft } from './ContractPartiesField'
import styles from '@/components/ui/crm/contract/contract.module.css'

interface TemplateOption { id: string; name: string; isDefault: boolean; currentVersionNo: number | null }

interface Props {
  /** 회사 단위 계약을 고를 수 있나 (관리자) — 화면 표시만, 판정은 서버 */
  canCorporate: boolean
  onClose: () => void
}

export const DIRECTIONS = Object.keys(K.direction) as Direction[]
export const FORM_OWNERS = Object.keys(K.formOwner) as (keyof typeof K.formOwner)[]
/** 변경계약은 원 계약에서 만든다 — 빈 계약서로 고르게 하지 않는다 */
export const DOC_LAYERS = (Object.keys(K.docLayer) as (keyof typeof K.docLayer)[]).filter((d) => d !== 'AMENDMENT')

async function readError(res: Response): Promise<string> {
  try { return (await res.json())?.error?.message ?? T.saveFailed } catch { return T.saveFailed }
}

export default function ContractCreateModal({ canCorporate, onClose }: Props) {
  const router = useRouter()
  const [direction, setDirection] = useState<Direction>('SALES')
  const [docLayer, setDocLayer] = useState<string>('STANDALONE')
  const [formOwner, setFormOwner] = useState<string>('OURS')
  const [title, setTitle] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [templates, setTemplates] = useState<TemplateOption[] | null>(null)
  const [parties, setParties] = useState<PartyDraft[]>(partiesFor('SALES'))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void fetch('/api/crm/contract-templates')
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((b) => { if (alive) setTemplates((b.items ?? []).filter((t: TemplateOption) => t.currentVersionNo)) })
      .catch(() => { if (alive) setTemplates([]) })
    return () => { alive = false }
  }, [])

  const pickDirection = (d: Direction) => { setDirection(d); setParties(partiesFor(d)) }

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/crm/contracts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction, docLayer, formOwner, title, templateId: templateId || undefined, parties: toPartyInput(parties) }),
      })
      if (!res.ok) { setError(await readError(res)); return }
      const { contract } = await res.json()
      router.push(`/crm/contracts/${contract.id}`)
    } catch {
      setError(T.saveFailed)
    } finally {
      setBusy(false)
    }
  }

  const noTemplate = templates !== null && templates.length === 0
  return (
    <NbModal
      title={T.title}
      onClose={() => !busy && onClose()}
      maxWidth={760}
      footer={
        <div className={styles.foot}>
          <span className={styles.footNote}>{direction === 'CORPORATE' ? T.corporateHint : ''}</span>
          <span className={styles.itemActions}>
            <NbButton variant="ghost" onClick={onClose} disabled={busy}>{ACTION.cancel}</NbButton>
            <NbButton onClick={() => void save()} disabled={busy}>{busy ? progress(ACTION.save) : ACTION.save}</NbButton>
          </span>
        </div>
      }
    >
      <div className={styles.form}>
        <FormErrorBanner message={error} />
        {noTemplate && (
          <p role="status" className={styles.desc}>
            {T.noTemplate} <Link href={crmSettingsHref('contract')}>{T.goTemplates}</Link>
          </p>
        )}
        <div className={styles.row}>
          <div className={styles.field}>
            <label className="label" htmlFor="cc-direction">{T.direction}</label>
            <select id="cc-direction" className="input-field" value={direction} onChange={(e) => pickDirection(e.target.value as Direction)}>
              {DIRECTIONS.filter((d) => d !== 'CORPORATE' || canCorporate).map((d) => <option key={d} value={d}>{K.direction[d]}</option>)}
            </select>
          </div>
          <div className={styles.field}>
            <label className="label" htmlFor="cc-layer">{T.docLayer}</label>
            <select id="cc-layer" className="input-field" value={docLayer} onChange={(e) => setDocLayer(e.target.value)}>
              {DOC_LAYERS.map((d) => <option key={d} value={d}>{K.docLayer[d]}</option>)}
            </select>
          </div>
          <div className={styles.field}>
            <label className="label" htmlFor="cc-owner">{T.formOwner}</label>
            <select id="cc-owner" className="input-field" value={formOwner} onChange={(e) => setFormOwner(e.target.value)}>
              {FORM_OWNERS.map((d) => <option key={d} value={d}>{K.formOwner[d]}</option>)}
            </select>
          </div>
        </div>
        <div className={styles.row}>
          <div className={styles.field}>
            <label className="label" htmlFor="cc-title">{T.name}</label>
            <input id="cc-title" className="input-field" value={title} placeholder={T.namePlaceholder} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className={styles.field}>
            <label className="label" htmlFor="cc-template">{T.template}</label>
            <select id="cc-template" className="input-field" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              <option value="">{T.templateDefault}</option>
              {(templates ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        </div>
        <ContractPartiesField parties={parties} onChange={setParties} />
      </div>
    </NbModal>
  )
}
