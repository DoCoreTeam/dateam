'use client'

// 조항 라이브러리 — 표준 조항을 쓰고, 관리자가 승인한다 (P0184 I05)
//
// **승인한 글은 안 고친다.** 승인본을 고치면 서버가 다음 버전 초안을 새로 만든다.
// 승인본은 표준 이탈 판정의 기준이라 그 글이 바뀌면 이미 판정한 계약의 근거가 사라진다.
// 승인 단추는 관리자에게만 그리고, 판정은 서버가 다시 한다.

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Pencil, Plus, Trash2 } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import NbModal from '@/components/ui/nb/NbModal'
import AXDotLoader from '@/components/ui/AXDotLoader'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import SettingsCard from '@/components/ui/settings/SettingsCard'
import { useAskDialog } from '@/components/ui/useAskDialog'
import { useCanEdit, useCanWrite } from '@/lib/crm/ui/can-edit'
import { ACTION, progress } from '@/lib/terms'
import { CONTRACT_CLAUSE_CARD, CONTRACT_CLAUSE_STATUS } from '@/lib/terms/contract-doc'
import styles from '@/components/ui/crm/contract/contract.module.css'

const TiptapEditor = dynamic(() => import('@/components/ui/TiptapEditor'), { ssr: false })

type Lang = 'ko' | 'en'

interface ClauseRow {
  id: string
  key: string
  lang: Lang
  versionNo: number
  title: string
  html: string
  status: 'DRAFT' | 'APPROVED'
  version: number
}

interface Draft {
  id: string | null
  key: string
  lang: Lang
  title: string
  html: string
  version: number
  approved: boolean
}

const EMPTY: Draft = { id: null, key: '', lang: 'ko', title: '', html: '<p></p>', version: 0, approved: false }

async function readError(res: Response, fallback: string): Promise<string> {
  try { return (await res.json())?.error?.message ?? fallback } catch { return fallback }
}

export default function ContractClausesCard() {
  const canApprove = useCanEdit()
  const canWrite = useCanWrite()
  const { ask, dialog } = useAskDialog()
  const [items, setItems] = useState<ClauseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/crm/contract-clauses')
      if (!res.ok) { setError(await readError(res, CONTRACT_CLAUSE_CARD.loadFailed)); return }
      setItems((await res.json()).items ?? [])
    } catch {
      setError(CONTRACT_CLAUSE_CARD.loadFailed)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const openNew = () => { setFormError(null); setDraft({ ...EMPTY }) }
  const openEdit = (c: ClauseRow) => {
    setFormError(null)
    setDraft({ id: c.id, key: c.key, lang: c.lang, title: c.title, html: c.html, version: c.version, approved: c.status === 'APPROVED' })
  }

  const save = async () => {
    if (!draft) return
    setBusy(true)
    setFormError(null)
    try {
      const body = draft.id
        ? { title: draft.title, html: draft.html, version: draft.version }
        : { key: draft.key, lang: draft.lang, title: draft.title, html: draft.html }
      const res = await fetch(draft.id ? `/api/crm/contract-clauses/${draft.id}` : '/api/crm/contract-clauses', {
        method: draft.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) { setFormError(await readError(res, CONTRACT_CLAUSE_CARD.saveFailed)); return }
      const out = await res.json()
      setNotice(out.forked ? CONTRACT_CLAUSE_CARD.forked(out.clause.versionNo) : null)
      setDraft(null)
      await load()
    } catch {
      setFormError(CONTRACT_CLAUSE_CARD.saveFailed)
    } finally {
      setBusy(false)
    }
  }

  const approve = async (c: ClauseRow) => {
    const ok = await ask.confirm({
      title: CONTRACT_CLAUSE_CARD.approveTitle(c.key, c.versionNo), body: CONTRACT_CLAUSE_CARD.approveBody,
      confirmLabel: CONTRACT_CLAUSE_CARD.approve,
    })
    if (!ok) return
    const res = await fetch(`/api/crm/contract-clauses/${c.id}/approve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: c.version }),
    })
    if (!res.ok) { setError(await readError(res, CONTRACT_CLAUSE_CARD.approveFailed)); return }
    setNotice(null)
    await load()
  }

  const remove = async (c: ClauseRow) => {
    const ok = await ask.confirm({
      title: CONTRACT_CLAUSE_CARD.deleteTitle(c.key, c.versionNo), body: CONTRACT_CLAUSE_CARD.deleteBody,
      confirmLabel: ACTION.delete, danger: true,
    })
    if (!ok) return
    const res = await fetch(`/api/crm/contract-clauses/${c.id}`, { method: 'DELETE' })
    if (!res.ok) { setError(await readError(res, CONTRACT_CLAUSE_CARD.deleteFailed)); return }
    await load()
  }

  if (loading && items.length === 0) return <AXDotLoader />

  const drafts = items.filter((c) => c.status === 'DRAFT').length

  const header = canWrite ? (
    <NbButton variant="ghost" onClick={openNew}><Plus size={14} /> {CONTRACT_CLAUSE_CARD.create}</NbButton>
  ) : null

  return (
    <SettingsCard title={CONTRACT_CLAUSE_CARD.cardTitle} headingLevel={3} headerAction={header}>
      <p className={styles.desc}>{CONTRACT_CLAUSE_CARD.cardDesc}</p>
      {drafts > 0 && <p role="note" className={`${styles.tag} ${styles.tagWarn}`}>{CONTRACT_CLAUSE_CARD.draftNote(drafts)}</p>}
      {error && <ErrorState message={error} onRetry={() => void load()} />}
      {notice && <p role="status" className={styles.desc}>{notice}</p>}

      {items.length === 0 ? (
        <EmptyState
          title={CONTRACT_CLAUSE_CARD.empty} description={CONTRACT_CLAUSE_CARD.emptyNext}
          action={canWrite ? { label: CONTRACT_CLAUSE_CARD.create, onClick: openNew } : undefined}
        />
      ) : (
        <ul className={styles.list}>
          {items.map((c) => (
            <li key={c.id} className={styles.item}>
              <div className={styles.itemMain}>
                <span className={styles.itemName}>{c.title}</span>
                <span className={styles.itemMeta}>
                  <span className={styles.tag}>{c.key}</span>
                  <span className={styles.tag}>{CONTRACT_CLAUSE_CARD.langLabel[c.lang]}</span>
                  <span className={styles.tag}>{CONTRACT_CLAUSE_CARD.version(c.versionNo)}</span>
                  <span className={`${styles.tag} ${c.status === 'APPROVED' ? styles.tagOk : styles.tagWarn}`}>
                    {CONTRACT_CLAUSE_STATUS[c.status]}
                  </span>
                </span>
              </div>
              <span className={styles.itemActions}>
                {canApprove && c.status === 'DRAFT' && (
                  <NbButton variant="ghost" onClick={() => void approve(c)}><CheckCircle2 size={14} /> {CONTRACT_CLAUSE_CARD.approve}</NbButton>
                )}
                {canWrite && (
                  <button type="button" className={styles.iconBtn} onClick={() => openEdit(c)} aria-label={`${c.title} ${ACTION.edit}`}><Pencil size={14} /></button>
                )}
                {canWrite && c.status === 'DRAFT' && (
                  <button type="button" className={styles.iconBtn} onClick={() => void remove(c)} aria-label={`${c.title} ${ACTION.delete}`}><Trash2 size={14} /></button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {draft && (
        <NbModal
          title={draft.id ? CONTRACT_CLAUSE_CARD.editTitle : CONTRACT_CLAUSE_CARD.create}
          onClose={() => !busy && setDraft(null)}
          maxWidth={760}
          footer={
            <div className={styles.foot}>
              <span className={styles.footNote}>{draft.approved ? CONTRACT_CLAUSE_CARD.forkNote : ''}</span>
              <span className={styles.itemActions}>
                <NbButton variant="ghost" onClick={() => setDraft(null)} disabled={busy}>{ACTION.cancel}</NbButton>
                <NbButton onClick={() => void save()} disabled={busy}>{busy ? progress(ACTION.save) : ACTION.save}</NbButton>
              </span>
            </div>
          }
        >
          <div className={styles.form}>
            <FormErrorBanner message={formError} />
            <div className={styles.row}>
              <div className={styles.field}>
                <label className="label" htmlFor="cc-key">{CONTRACT_CLAUSE_CARD.key}</label>
                <input id="cc-key" className="input-field" value={draft.key} disabled={Boolean(draft.id)}
                  placeholder={CONTRACT_CLAUSE_CARD.keyPlaceholder} onChange={(e) => setDraft({ ...draft, key: e.target.value })} />
                <p className={styles.desc}>{CONTRACT_CLAUSE_CARD.keyHelp}</p>
              </div>
              <div className={styles.field}>
                <label className="label" htmlFor="cc-lang">{CONTRACT_CLAUSE_CARD.lang}</label>
                <select id="cc-lang" className="input-field" value={draft.lang} disabled={Boolean(draft.id)}
                  onChange={(e) => setDraft({ ...draft, lang: e.target.value as Lang })}>
                  <option value="ko">{CONTRACT_CLAUSE_CARD.langLabel.ko}</option>
                  <option value="en">{CONTRACT_CLAUSE_CARD.langLabel.en}</option>
                </select>
              </div>
            </div>
            <div className={styles.field}>
              <label className="label" htmlFor="cc-title">{CONTRACT_CLAUSE_CARD.title}</label>
              <input id="cc-title" className="input-field" value={draft.title}
                placeholder={CONTRACT_CLAUSE_CARD.titlePlaceholder} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </div>
            <div className={styles.field}>
              <span className="label">{CONTRACT_CLAUSE_CARD.body}</span>
              <TiptapEditor value={draft.html} enableTable minHeight={120} onChange={(html) => setDraft({ ...draft, html })} />
            </div>
          </div>
        </NbModal>
      )}
      {dialog}
    </SettingsCard>
  )
}
