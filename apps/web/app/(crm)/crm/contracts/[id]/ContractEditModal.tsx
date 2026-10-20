'use client'

// 계약서 고치기 — 제목, 칸 값, 조항을 한 번에 고쳐 다음 버전으로 남긴다 (P0132 I12a)
//
// **바뀐 것만 보낸다.** 그대로인 칸까지 보내면 견적 값이 손으로 넣은 값으로 굳는다 —
// 그러면 다시 채우기가 그 칸을 영영 건너뛴다. 칸을 비우면 견적 값으로 돌아간다(서버 규칙).

import { useMemo, useState } from 'react'
import NbModal from '@/components/ui/nb/NbModal'
import NbButton from '@/components/ui/nb/NbButton'
import ClauseEditor, { type EditableClause } from '@/components/ui/crm/contract/ClauseEditor'
import { CONTRACT_FIELDS } from '@/lib/crm/domain/contract-fields'
import { withSubmitGuard } from '@/lib/forms/submit-guard'
import { failedTo, progress, ACTION } from '@/lib/terms'
import { CONTRACT_DOC, CONTRACT_MSG, CONTRACT_SCREEN } from '@/lib/terms/contract-doc'
import { contractApi, type ContractJson, type ContractVersionJson, type Outcome, type SaveResult } from './contract-api'
import styles from './contract-modal.module.css'

interface Props {
  contract: ContractJson
  current: ContractVersionJson
  onClose: () => void
  onSaved: (r: SaveResult) => void
  onFailed: (o: Extract<Outcome<unknown>, { ok: false }>) => void
}

const manualValue = (current: ContractVersionJson, key: string): string =>
  current.fieldValues[key]?.source === 'manual' ? current.fieldValues[key].value : ''

export default function ContractEditModal({ contract, current, onClose, onSaved, onFailed }: Props) {
  const [title, setTitle] = useState(contract.title)
  const [note, setNote] = useState('')
  const [clauses, setClauses] = useState<EditableClause[]>(() => current.body.map((c) => ({ ...c })))
  const [manual, setManual] = useState<Record<string, string>>(
    () => Object.fromEntries(CONTRACT_FIELDS.map((f) => [f.key, manualValue(current, f.key)])),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const changedManual = useMemo(
    () => Object.fromEntries(Object.entries(manual).filter(([k, v]) => v.trim() !== manualValue(current, k))
      .map(([k, v]) => [k, v.trim()])),
    [manual, current],
  )
  const bodyChanged = JSON.stringify(clauses) !== JSON.stringify(current.body)

  async function save() {
    if (saving) return
    if (!title.trim()) { setError(CONTRACT_MSG.titleRequired); return }
    if (clauses.length === 0) { setError(CONTRACT_MSG.noClauses); return }
    setSaving(true)
    setError(null)
    await withSubmitGuard(async () => {
      const out = await contractApi.save(contract.id, failedTo(CONTRACT_DOC.entity, '저장하지'), {
        version: contract.version,
        ...(bodyChanged ? { body: clauses } : {}),
        ...(Object.keys(changedManual).length > 0 ? { manual: changedManual } : {}),
        ...(title.trim() !== contract.title ? { title: title.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      })
      if (out.ok) { onSaved(out.body); return }
      // 버전이 어긋났으면 화면이 최신을 다시 읽는다 — 이 창은 닫는다
      if (out.code === 'CONFLICT') { onFailed(out); return }
      setError(out.message)
    }, { onError: setError, onDone: () => setSaving(false) })
  }

  return (
    <NbModal
      title={CONTRACT_SCREEN.editTitle}
      onClose={onClose}
      maxWidth={880}
      disableClose={saving}
      footer={(
        <div className={styles.foot}>
          {error && <span className={styles.tagBad} role="alert">{error}</span>}
          <NbButton variant="ghost" disabled={saving} onClick={onClose}>{ACTION.cancel}</NbButton>
          <NbButton disabled={saving} onClick={() => void save()}>{saving ? progress(ACTION.save) : ACTION.save}</NbButton>
        </div>
      )}
    >
      <div className={styles.body}>
        <label className={styles.field}>
          <span className="label">{CONTRACT_SCREEN.titleLabel}</span>
          <input className="input-field" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        </label>

        <section className={styles.section} aria-labelledby="contract-edit-fields">
          <h3 id="contract-edit-fields" className={styles.sectionTitle}>{CONTRACT_SCREEN.fieldsSection}</h3>
          <p className={styles.hint}>{CONTRACT_SCREEN.fieldHint}</p>
          <div className={styles.fields}>
            {CONTRACT_FIELDS.map((f) => {
              const auto = current.fieldValues[f.key]
              const isManual = (manual[f.key] ?? '').trim() !== ''
              const id = `contract-field-${f.key}`
              return (
                <div key={f.key} className={styles.field}>
                  <div className={styles.fieldHead}>
                    <label htmlFor={id} className="label">{f.label}</label>
                    <span className={isManual ? `${styles.src} ${styles.srcManual}` : styles.src}>
                      {isManual ? CONTRACT_SCREEN.fieldManual : CONTRACT_SCREEN.fieldAuto}
                    </span>
                  </div>
                  {f.kind === 'block' || f.kind === 'longtext' ? (
                    <textarea
                      id={id} className="input-field" rows={f.kind === 'longtext' ? 5 : 3} value={manual[f.key] ?? ''}
                      placeholder={auto?.source === 'auto' ? auto.value : ''}
                      onChange={(e) => setManual((m) => ({ ...m, [f.key]: e.target.value }))}
                    />
                  ) : (
                    <input
                      id={id} className="input-field" value={manual[f.key] ?? ''}
                      placeholder={auto?.source === 'auto' ? auto.value : ''}
                      onChange={(e) => setManual((m) => ({ ...m, [f.key]: e.target.value }))}
                    />
                  )}
                </div>
              )
            })}
          </div>
        </section>

        <section className={styles.section} aria-labelledby="contract-edit-clauses">
          <h3 id="contract-edit-clauses" className={styles.sectionTitle}>{CONTRACT_SCREEN.clausesSection}</h3>
          <ClauseEditor clauses={clauses} onChange={setClauses} disabled={saving} />
        </section>

        <label className={styles.field}>
          <span className="label">{CONTRACT_SCREEN.noteLabel}</span>
          <input
            className="input-field" value={note} maxLength={200}
            placeholder={CONTRACT_SCREEN.notePlaceholder} onChange={(e) => setNote(e.target.value)}
          />
        </label>
      </div>
    </NbModal>
  )
}
