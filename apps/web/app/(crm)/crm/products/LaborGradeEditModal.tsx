'use client'

// 인건비 등급 만들기 고치기 — 단가를 바꾸면 가격 이력에 새 줄이 쌓인다(지난 견적은 안 바뀐다)

import { useState } from 'react'
import NbModal from '@/components/ui/nb/NbModal'
import NbButton from '@/components/ui/nb/NbButton'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import { ACTION, PRICEBOOK, progress } from '@/lib/terms'
import styles from './pricebook.module.css'

export interface GradeDraft {
  id: string | null
  version: number
  name: string
  roleLabel: string
  pricePerMmMinor: string
  publicRateMinor: string
  costPerMmMinor: string
  effectiveFrom: string
  position: string
}

interface Props {
  draft: GradeDraft
  canSeeCost: boolean
  onClose: () => void
  onSaved: () => void
}

const digits = (v: string) => v.replace(/[^\d]/g, '')

export default function LaborGradeEditModal({ draft, canSeeCost, onClose, onSaved }: Props) {
  const [form, setForm] = useState<GradeDraft>(draft)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const editing = draft.id !== null
  const set = (patch: Partial<GradeDraft>) => setForm((f) => ({ ...f, ...patch }))

  const save = async () => {
    if (!form.name.trim()) { setError('등급 이름을 입력해 주세요.'); return }
    setBusy(true)
    setError(null)
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        roleLabel: form.roleLabel.trim() || null,
        pricePerMmMinor: form.pricePerMmMinor || null,
        publicRateMinor: form.publicRateMinor || null,
        effectiveFrom: form.effectiveFrom || null,
        position: Number(form.position) || 0,
      }
      if (canSeeCost) body.costPerMmMinor = form.costPerMmMinor || '0'
      const res = editing
        ? await fetch(`/api/crm/labor-grades/${draft.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, version: draft.version }) })
        : await fetch('/api/crm/labor-grades', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json()
      if (!res.ok) { setError(json?.error?.message ?? '저장하지 못했습니다.'); return }
      onSaved()
    } catch {
      setError('저장하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <NbModal
      title={editing ? `${PRICEBOOK.gradeName} 수정` : PRICEBOOK.newGrade}
      onClose={onClose}
      maxWidth={560}
      footer={(
        <div className={styles.foot}>
          <NbButton variant="ghost" onClick={onClose} disabled={busy}>{ACTION.cancel}</NbButton>
          <NbButton onClick={() => void save()} disabled={busy}>{busy ? progress(ACTION.save) : ACTION.save}</NbButton>
        </div>
      )}
    >
      <div className={styles.form}>
        <FormErrorBanner message={error} />
        <div className={styles.row}>
          <div className={styles.field}>
            <label className="label" htmlFor="lg-name">{PRICEBOOK.gradeName}</label>
            <input id="lg-name" className="input-field" value={form.name} autoFocus onChange={(e) => set({ name: e.target.value })} placeholder="특급 · 고급 · 중급 · 초급" />
          </div>
          <div className={styles.field}>
            <label className="label" htmlFor="lg-role">{PRICEBOOK.gradeRole}</label>
            <input id="lg-role" className="input-field" value={form.roleLabel} onChange={(e) => set({ roleLabel: e.target.value })} placeholder="소프트웨어 엔지니어" />
          </div>
        </div>
        <div className={styles.row}>
          <div className={styles.field}>
            <label className="label" htmlFor="lg-price">{PRICEBOOK.gradePrice}</label>
            <input id="lg-price" className="input-field" inputMode="numeric" value={form.pricePerMmMinor} onChange={(e) => set({ pricePerMmMinor: digits(e.target.value) })} />
          </div>
          <div className={styles.field}>
            <label className="label" htmlFor="lg-public">{PRICEBOOK.gradePublic}</label>
            <input id="lg-public" className="input-field" inputMode="numeric" value={form.publicRateMinor} onChange={(e) => set({ publicRateMinor: digits(e.target.value) })} />
          </div>
        </div>
        <div className={styles.row}>
          {canSeeCost && (
            <div className={styles.field}>
              <label className="label" htmlFor="lg-cost">{PRICEBOOK.gradeCost}</label>
              <input id="lg-cost" className="input-field" inputMode="numeric" value={form.costPerMmMinor} onChange={(e) => set({ costPerMmMinor: digits(e.target.value) })} />
            </div>
          )}
          <div className={styles.field}>
            <label className="label" htmlFor="lg-from">{PRICEBOOK.gradeFrom}</label>
            <input id="lg-from" type="date" className="input-field" value={form.effectiveFrom} onChange={(e) => set({ effectiveFrom: e.target.value })} />
          </div>
        </div>
      </div>
    </NbModal>
  )
}
