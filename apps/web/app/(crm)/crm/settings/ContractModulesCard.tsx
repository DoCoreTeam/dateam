'use client'

// 계약 모듈 — 조항을 묶고 켜는 조건을 정한다 (P0184 I11)
//
// 모듈은 어떤 조항이 어느 계약에 들어가는지를 정하므로 관리자만 만들고 고친다.
// 단추는 관리자에게만 그리고, 판정은 서버가 다시 한다.

import { useCallback, useEffect, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import AXDotLoader from '@/components/ui/AXDotLoader'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'
import SettingsCard from '@/components/ui/settings/SettingsCard'
import { useAskDialog } from '@/components/ui/useAskDialog'
import { useCanEdit } from '@/lib/crm/ui/can-edit'
import { ACTION } from '@/lib/terms'
import { CONTRACT_MODULE_CARD, CONTRACT_MODULE_KIND } from '@/lib/terms/contract-doc'
import styles from '@/components/ui/crm/contract/contract.module.css'
import ContractModuleEditor, {
  conditionToRules, rulesToCondition, type ClauseOption, type ModuleDraft, type ModuleKind,
} from './ContractModuleEditor'

interface ModuleRow {
  id: string
  key: string
  kind: ModuleKind
  title: string
  clauseKeys: string[]
  enableWhen: { all: { field: string; op: 'in' | 'notIn' | 'truthy'; values?: string[] }[] } | null
  isActive: boolean
  position: number
  version: number
}

const EMPTY: ModuleDraft = {
  id: null, key: '', kind: 'PERFORMANCE', title: '', clauseKeys: [], rules: [], isActive: true, position: 0, version: 0,
}

async function readError(res: Response, fallback: string): Promise<string> {
  try { return (await res.json())?.error?.message ?? fallback } catch { return fallback }
}

/** 같은 키의 조항은 버전마다 줄이 있다 — 고르는 목록에는 키 하나에 한 줄 (가장 최근 제목) */
function uniqueClauses(items: readonly { key: string; title: string; lang: string }[]): ClauseOption[] {
  const seen = new Map<string, string>()
  for (const c of items) if (c.lang === 'ko' && !seen.has(c.key)) seen.set(c.key, c.title)
  return [...seen].map(([key, title]) => ({ key, title }))
}

export default function ContractModulesCard() {
  const canEdit = useCanEdit()
  const { ask, dialog } = useAskDialog()
  const [items, setItems] = useState<ModuleRow[]>([])
  const [clauses, setClauses] = useState<ClauseOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<ModuleDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [mRes, cRes] = await Promise.all([fetch('/api/crm/contract-modules'), fetch('/api/crm/contract-clauses')])
      if (!mRes.ok) { setError(await readError(mRes, CONTRACT_MODULE_CARD.loadFailed)); return }
      if (!cRes.ok) { setError(await readError(cRes, CONTRACT_MODULE_CARD.loadFailed)); return }
      setItems((await mRes.json()).items ?? [])
      setClauses(uniqueClauses((await cRes.json()).items ?? []))
    } catch {
      setError(CONTRACT_MODULE_CARD.loadFailed)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const openNew = () => { setFormError(null); setDraft({ ...EMPTY }) }
  const openEdit = (m: ModuleRow) => {
    setFormError(null)
    setDraft({
      id: m.id, key: m.key, kind: m.kind, title: m.title, clauseKeys: [...m.clauseKeys],
      rules: conditionToRules(m.enableWhen), isActive: m.isActive, position: m.position, version: m.version,
    })
  }

  const save = async () => {
    if (!draft) return
    setBusy(true)
    setFormError(null)
    try {
      const common = {
        title: draft.title, clauseKeys: draft.clauseKeys, enableWhen: rulesToCondition(draft.rules),
        isActive: draft.isActive, position: draft.position,
      }
      const body = draft.id ? { ...common, version: draft.version } : { ...common, key: draft.key, kind: draft.kind }
      const res = await fetch(draft.id ? `/api/crm/contract-modules/${draft.id}` : '/api/crm/contract-modules', {
        method: draft.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) { setFormError(await readError(res, CONTRACT_MODULE_CARD.saveFailed)); return }
      setDraft(null)
      await load()
    } catch {
      setFormError(CONTRACT_MODULE_CARD.saveFailed)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (m: ModuleRow) => {
    const ok = await ask.confirm({
      title: CONTRACT_MODULE_CARD.deleteTitle(m.key), body: CONTRACT_MODULE_CARD.deleteBody,
      confirmLabel: ACTION.delete, danger: true,
    })
    if (!ok) return
    const res = await fetch(`/api/crm/contract-modules/${m.id}`, { method: 'DELETE' })
    if (!res.ok) { setError(await readError(res, CONTRACT_MODULE_CARD.deleteFailed)); return }
    await load()
  }

  if (loading && items.length === 0) return <AXDotLoader />

  const header = canEdit ? (
    <NbButton variant="ghost" onClick={openNew}><Plus size={14} /> {CONTRACT_MODULE_CARD.create}</NbButton>
  ) : null

  return (
    <SettingsCard title={CONTRACT_MODULE_CARD.cardTitle} headingLevel={3} headerAction={header}>
      <p className={styles.desc}>{CONTRACT_MODULE_CARD.cardDesc}</p>
      {!canEdit && <p className={styles.desc}>{CONTRACT_MODULE_CARD.adminOnly}</p>}
      {error && <ErrorState message={error} onRetry={() => void load()} />}

      {items.length === 0 ? (
        <EmptyState
          title={CONTRACT_MODULE_CARD.empty} description={CONTRACT_MODULE_CARD.emptyNext}
          action={canEdit ? { label: CONTRACT_MODULE_CARD.create, onClick: openNew } : undefined}
        />
      ) : (
        <ul className={styles.list}>
          {items.map((m) => (
            <li key={m.id} className={styles.item}>
              <div className={styles.itemMain}>
                <span className={styles.itemName}>{m.title}</span>
                <span className={styles.itemMeta}>
                  <span className={styles.tag}>{CONTRACT_MODULE_KIND[m.kind]}</span>
                  <span className={styles.tag}>{m.key}</span>
                  <span className={styles.tag}>{CONTRACT_MODULE_CARD.clauseCount(m.clauseKeys.length)}</span>
                  {m.enableWhen && <span className={styles.tag}>{CONTRACT_MODULE_CARD.ruleSummary(m.enableWhen.all.length)}</span>}
                  <span className={`${styles.tag} ${m.isActive ? styles.tagOk : styles.tagWarn}`}>
                    {m.isActive ? CONTRACT_MODULE_CARD.active : CONTRACT_MODULE_CARD.inactive}
                  </span>
                </span>
              </div>
              {canEdit && (
                <span className={styles.itemActions}>
                  <button type="button" className={styles.iconBtn} onClick={() => openEdit(m)} aria-label={`${m.title} ${ACTION.edit}`}><Pencil size={14} /></button>
                  <button type="button" className={styles.iconBtn} onClick={() => void remove(m)} aria-label={`${m.title} ${ACTION.delete}`}><Trash2 size={14} /></button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {draft && (
        <ContractModuleEditor
          draft={draft} clauses={clauses} busy={busy} error={formError}
          onChange={setDraft} onSave={() => void save()} onClose={() => setDraft(null)}
        />
      )}
      {dialog}
    </SettingsCard>
  )
}
