'use client'

// 계약서 템플릿 — 조항을 쓰고, 칸을 넣고, 발행한다 (P0132 I06)
//
// **저장과 발행이 다르다.** 저장은 작성 중 본문을 남길 뿐이고 계약서 만들기는 그것을 안 읽는다.
// 발행해야 다음 버전으로 굳고 그때부터 쓰인다. 이미 만든 계약서는 그때 버전을 들고 있어 안 바뀐다.

import { useCallback, useEffect, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import NbModal from '@/components/ui/nb/NbModal'
import AXDotLoader from '@/components/ui/AXDotLoader'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import SettingsCard from '@/components/ui/settings/SettingsCard'
import { useAskDialog } from '@/components/ui/useAskDialog'
import ClauseEditor, { type EditableClause } from '@/components/ui/crm/contract/ClauseEditor'
import { useCanEdit } from '@/lib/crm/ui/can-edit'
import { useBusinessTypes } from '@/lib/crm/ui/use-business-types'
import { selectableBusinessTypes } from '@/lib/crm/domain/business-type'
import { ACTION, progress } from '@/lib/terms'
import { CONTRACT_TEMPLATE } from '@/lib/terms/contract-doc'
import styles from '@/components/ui/crm/contract/contract.module.css'

interface TemplateRow {
  id: string
  name: string
  businessTypeKey: string | null
  isDefault: boolean
  draftBody: EditableClause[] | null
  currentVersionNo: number | null
  version: number
}

interface Draft {
  id: string | null
  name: string
  businessTypeKey: string
  isDefault: boolean
  clauses: EditableClause[]
  version: number
  currentVersionNo: number | null
}

const EMPTY: Draft = { id: null, name: '', businessTypeKey: '', isDefault: false, clauses: [], version: 0, currentVersionNo: null }

async function readError(res: Response, fallback: string): Promise<string> {
  try { return (await res.json())?.error?.message ?? fallback } catch { return fallback }
}

export default function ContractTemplatesCard() {
  const canEdit = useCanEdit()
  const { rows: bizTypes, labelOf } = useBusinessTypes()
  const { ask, dialog } = useAskDialog()
  const [items, setItems] = useState<TemplateRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/crm/contract-templates')
      if (!res.ok) { setError(await readError(res, CONTRACT_TEMPLATE.loadFailed)); return }
      setItems((await res.json()).items ?? [])
    } catch {
      setError(CONTRACT_TEMPLATE.loadFailed)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const openNew = () => {
    setFormError(null)
    setDraft({ ...EMPTY, clauses: [{ id: 'c1', title: '', html: '<p></p>' }] })
  }

  const openEdit = (t: TemplateRow) => {
    setFormError(null)
    setDraft({
      id: t.id, name: t.name, businessTypeKey: t.businessTypeKey ?? '', isDefault: t.isDefault,
      clauses: t.draftBody ?? [], version: t.version, currentVersionNo: t.currentVersionNo,
    })
  }

  /** 저장 — 새 것이면 만들고, 있던 것이면 작성 중 본문을 고친다. 고친 뒤의 행을 돌려준다 */
  const persist = async (d: Draft): Promise<TemplateRow | null> => {
    const payload = {
      name: d.name, businessTypeKey: d.businessTypeKey || null, isDefault: d.isDefault,
      draftBody: d.clauses.map(({ id, title, html, origin }) => ({ id, title, html, origin })),
    }
    const res = await fetch(d.id ? `/api/crm/contract-templates/${d.id}` : '/api/crm/contract-templates', {
      method: d.id ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(d.id ? { ...payload, version: d.version } : payload),
    })
    if (!res.ok) { setFormError(await readError(res, CONTRACT_TEMPLATE.saveFailed)); return null }
    return res.json()
  }

  const save = async () => {
    if (!draft) return
    setBusy(true)
    setFormError(null)
    try {
      const row = await persist(draft)
      if (!row) return
      setDraft({ ...draft, id: row.id, version: row.version })
      await load()
    } catch {
      setFormError(CONTRACT_TEMPLATE.saveFailed)
    } finally {
      setBusy(false)
    }
  }

  const publish = async () => {
    if (!draft) return
    setBusy(true)
    setFormError(null)
    try {
      const row = await persist(draft)
      if (!row) return
      const res = await fetch(`/api/crm/contract-templates/${row.id}/publish`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: row.version }),
      })
      if (!res.ok) { setFormError(await readError(res, CONTRACT_TEMPLATE.publishFailed)); return }
      setDraft(null)
      await load()
    } catch {
      setFormError(CONTRACT_TEMPLATE.publishFailed)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (t: TemplateRow) => {
    const ok = await ask.confirm({
      title: CONTRACT_TEMPLATE.deleteTitle(t.name), body: CONTRACT_TEMPLATE.deleteBody,
      confirmLabel: ACTION.delete, danger: true,
    })
    if (!ok) return
    const res = await fetch(`/api/crm/contract-templates/${t.id}`, { method: 'DELETE' })
    if (!res.ok) { setError(await readError(res, CONTRACT_TEMPLATE.deleteFailed)); return }
    await load()
  }

  if (loading && items.length === 0) return <AXDotLoader />

  const header = canEdit ? (
    <NbButton variant="ghost" onClick={openNew}><Plus size={14} /> {CONTRACT_TEMPLATE.create}</NbButton>
  ) : null

  return (
    <SettingsCard title={CONTRACT_TEMPLATE.cardTitle} headingLevel={3} headerAction={header}>
      <p className={styles.desc}>{CONTRACT_TEMPLATE.cardDesc}</p>
      {error && <ErrorState message={error} onRetry={() => void load()} />}

      {items.length === 0 ? (
        <EmptyState
          title={CONTRACT_TEMPLATE.empty} description={CONTRACT_TEMPLATE.emptyNext}
          action={canEdit ? { label: CONTRACT_TEMPLATE.create, onClick: openNew } : undefined}
        />
      ) : (
        <ul className={styles.list}>
          {items.map((t) => (
            <li key={t.id} className={styles.item}>
              <div className={styles.itemMain}>
                <span className={styles.itemName}>{t.name}</span>
                <span className={styles.itemMeta}>
                  <span className={styles.tag}>{t.businessTypeKey ? labelOf(t.businessTypeKey) : CONTRACT_TEMPLATE.allTypes}</span>
                  {t.isDefault && <span className={`${styles.tag} ${styles.tagOk}`}>{CONTRACT_TEMPLATE.defaultBadge}</span>}
                  <span className={`${styles.tag} ${t.currentVersionNo ? '' : styles.tagWarn}`}>
                    {t.currentVersionNo ? CONTRACT_TEMPLATE.inUse(t.currentVersionNo) : CONTRACT_TEMPLATE.neverPublished}
                  </span>
                </span>
              </div>
              {canEdit && (
                <span className={styles.itemActions}>
                  <button type="button" className={styles.iconBtn} onClick={() => openEdit(t)} aria-label={`${t.name} ${ACTION.edit}`}><Pencil size={14} /></button>
                  <button type="button" className={styles.iconBtn} onClick={() => void remove(t)} aria-label={`${t.name} ${ACTION.delete}`}><Trash2 size={14} /></button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {draft && (
        <NbModal
          title={draft.id ? CONTRACT_TEMPLATE.editTitle : CONTRACT_TEMPLATE.create}
          onClose={() => !busy && setDraft(null)}
          maxWidth={900}
          footer={
            <div className={styles.foot}>
              <span className={styles.footNote}>{CONTRACT_TEMPLATE.publishWhy}</span>
              <span className={styles.itemActions}>
                <NbButton variant="ghost" onClick={() => setDraft(null)} disabled={busy}>{ACTION.cancel}</NbButton>
                <NbButton variant="ghost" onClick={() => void save()} disabled={busy}>{busy ? progress(ACTION.save) : CONTRACT_TEMPLATE.saveDraft}</NbButton>
                <NbButton onClick={() => void publish()} disabled={busy || draft.clauses.length === 0}>
                  {CONTRACT_TEMPLATE.publish((draft.currentVersionNo ?? 0) + 1)}
                </NbButton>
              </span>
            </div>
          }
        >
          <div className={styles.form}>
            <FormErrorBanner message={formError} />
            <div className={styles.row}>
              <div className={styles.field}>
                <label className="label" htmlFor="ct-name">{CONTRACT_TEMPLATE.name}</label>
                <input id="ct-name" className="input-field" value={draft.name} placeholder={CONTRACT_TEMPLATE.namePlaceholder}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </div>
              <div className={styles.field}>
                <label className="label" htmlFor="ct-type">{CONTRACT_TEMPLATE.businessType}</label>
                <select id="ct-type" className="input-field" value={draft.businessTypeKey}
                  onChange={(e) => setDraft({ ...draft, businessTypeKey: e.target.value })}>
                  <option value="">{CONTRACT_TEMPLATE.allTypes}</option>
                  {selectableBusinessTypes(bizTypes, draft.businessTypeKey || null).map((b) => (
                    <option key={b.key} value={b.key}>{b.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <label className={`label ${styles.check}`}>
              <input type="checkbox" checked={draft.isDefault} onChange={(e) => setDraft({ ...draft, isDefault: e.target.checked })} />
              <span>{CONTRACT_TEMPLATE.isDefault}</span>
            </label>
            <ClauseEditor clauses={draft.clauses} onChange={(clauses) => setDraft({ ...draft, clauses })} disabled={busy} />
          </div>
        </NbModal>
      )}

      {dialog}
    </SettingsCard>
  )
}
