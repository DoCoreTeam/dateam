'use client'

// 회사 프로필 — **적합도를 가르는 다섯 부분 전부**를 여기서 고친다.
//
// ## 왜 다시 짰나
//
// 예전에는 회사 이름·자본금 같은 여섯 칸만 있었다. 그런데 적합도를 실제로 가르는 것은
// 실적·인증·기술·협력사 넷이다 — 표도 있고 판정 코드도 있는데 **입력할 자리가 없었다.**
// 그래서 화면은 「이걸로 뭘 판정한다는 건가」로 보였고, 회사소개서 초안을 뽑아 봐야
// 채울 칸이 없어 그대로 버려졌다.
//
// ## 왜 「올리면 채워집니다」가 먼저인가
//
// 「회사 정보를 다 입력하세요」로 시작하는 기능은 첫 화면에서 버려진다.
// 회사소개서는 이미 갖고 있는 문서다. 올리면 대부분 채워지고 사람은 확인만 한다.

import { useCallback, useRef, useState } from 'react'
import { Upload, Plus, X } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import { RFP_PROFILE, RFP_COMMON } from '@/lib/rfp/terms'
import styles from '@/app/(rfp)/rfp.module.css'

export interface ProfileBasic {
  companyName: string
  businessNumber: string | null
  capitalKrw: number | null
  annualRevenueKrw: number | null
  headcount: number | null
  region: string | null
}

export interface Certification { name: string; issuer: string | null; validUntil: string | null }
export interface TrackRecord {
  projectName: string; client: string | null; amountKrw: number | null
  startDate: string | null; endDate: string | null; domainTags: string[]
}
export interface Capability { tag: string; level: number }
export interface Partner { name: string; capabilities: string[] }

export interface ProfileEditorProps {
  initial: ProfileBasic | null
  initialVersion: number | null
  initialStatus: string | null
  initialCertifications?: Certification[]
  initialTrackRecords?: TrackRecord[]
  initialCapabilities?: Capability[]
  initialPartners?: Partner[]
  initialMissing?: string[]
}

const EMPTY: ProfileBasic = {
  companyName: '', businessNumber: null, capitalKrw: null,
  annualRevenueKrw: null, headcount: null, region: null,
}

const NEW_CERT: Certification = { name: '', issuer: null, validUntil: null }
const NEW_RECORD: TrackRecord = {
  projectName: '', client: null, amountKrw: null, startDate: null, endDate: null, domainTags: [],
}
const NEW_CAP: Capability = { tag: '', level: 3 }
const NEW_PARTNER: Partner = { name: '', capabilities: [] }

export default function ProfileEditor({
  initial, initialVersion, initialStatus,
  initialCertifications = [], initialTrackRecords = [],
  initialCapabilities = [], initialPartners = [], initialMissing = [],
}: ProfileEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [basic, setBasic] = useState<ProfileBasic>(initial ?? EMPTY)
  const [certs, setCerts] = useState<Certification[]>(initialCertifications)
  const [records, setRecords] = useState<TrackRecord[]>(initialTrackRecords)
  const [caps, setCaps] = useState<Capability[]>(initialCapabilities)
  const [partners, setPartners] = useState<Partner[]>(initialPartners)
  const [version, setVersion] = useState(initialVersion)
  const [status, setStatus] = useState(initialStatus)
  const [missing, setMissing] = useState<string[]>(initialMissing)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  /** 서버가 준 프로필 한 벌을 화면에 붓는다 — 초안과 저장 결과가 같은 모양이다 */
  const apply = useCallback((p: Record<string, any> | null, gaps: string[]) => {
    setBasic({ ...EMPTY, ...(p?.basic ?? {}) })
    setCerts(p?.certifications ?? [])
    setRecords(p?.trackRecords ?? [])
    setCaps(p?.capabilities ?? [])
    setPartners(p?.partners ?? [])
    setVersion(p?.version ?? null)
    setStatus(p?.status ?? 'draft')
    setMissing(gaps)
  }, [])

  const draft = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setError(null)
    setBusy(true)
    try {
      const form = new FormData()
      for (const f of Array.from(files)) form.append('file', f)
      const res = await fetch('/api/rfp/profile/draft', { method: 'POST', body: form })
      const body = await res.json()
      if (!res.ok) { setError(RFP_COMMON.error); return }
      apply(body.profile, body.missing ?? [])
    } catch {
      setError(RFP_COMMON.error)
    } finally {
      setBusy(false)
    }
  }, [apply])

  const save = useCallback(async (asDraft: boolean) => {
    setError(null)
    setSaved(false)
    setBusy(true)
    try {
      const res = await fetch('/api/rfp/profile', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          basic, certifications: certs, trackRecords: records,
          capabilities: caps, partners,
          status: asDraft ? 'draft' : 'active',
        }),
      })
      const body = await res.json()
      if (!res.ok) { setError(RFP_COMMON.error); return }
      apply(body.profile, body.missing ?? [])
      setSaved(true)
    } catch {
      setError(RFP_COMMON.error)
    } finally {
      setBusy(false)
    }
  }, [basic, certs, records, caps, partners, apply])

  const field = (key: keyof ProfileBasic, label: string, numeric = false) => (
    <div className={styles.field} key={key}>
      <label className="label" htmlFor={`p-${key}`}>{label}</label>
      <input
        id={`p-${key}`}
        className="input-field"
        value={basic[key] === null || basic[key] === undefined ? '' : String(basic[key])}
        onChange={(e) => {
          const v = e.target.value
          setBasic((prev) => ({
            ...prev,
            [key]: numeric ? (v ? Number(v.replace(/[^0-9]/g, '')) : null) : v,
          }))
        }}
      />
    </div>
  )

  return (
    <div className={styles.stack}>
      {error && <FormErrorBanner message={error} />}

      {/* ① 문서로 채우기가 먼저다 — 빈 폼부터 보여 주면 사람은 화면을 떠난다 */}
      <section className="card">
        <div className={styles.sectionHead}>
          <div className={styles.between}>
            <span className={styles.sectionTitle}>{RFP_PROFILE.draftTitle}</span>
            <span className={styles.row}>
              {version !== null && (
                <NbBadge status={status === 'active' ? 'done' : 'doing'}>
                  {status === 'active' ? RFP_COMMON.save : RFP_PROFILE.saveDraft} · {version}
                </NbBadge>
              )}
              {saved && <NbBadge status="done">{RFP_COMMON.save}</NbBadge>}
            </span>
          </div>
          <span className={styles.sectionDesc}>{RFP_PROFILE.draftHint}</span>
        </div>
        <input ref={inputRef} type="file" multiple style={{ display: 'none' }}
          onChange={(e) => void draft(e.target.files)} />
        <NbButton variant="secondary" onClick={() => inputRef.current?.click()} disabled={busy}>
          <Upload size={14} /> {RFP_PROFILE.draftUpload}
        </NbButton>
      </section>

      {/* 무엇이 비었는지 이름으로 말한다 — 「부족합니다」만으로는 못 채운다 */}
      {missing.length > 0 && (
        <section className="card">
          <div className={styles.sectionHead}>
            <span className={styles.sectionTitle}>{RFP_PROFILE.missing}</span>
            <span className={styles.sectionDesc}>{RFP_PROFILE.missingHint}</span>
          </div>
          <div className={styles.row}>
            {missing.map((m) => (
              <NbBadge key={m} status="doing">{RFP_PROFILE.missingLabel[m] ?? m}</NbBadge>
            ))}
          </div>
        </section>
      )}

      {/* ② 기본정보 */}
      <section className="card">
        <div className={styles.sectionHead}>
          <span className={styles.sectionTitle}>{RFP_PROFILE.basicTitle}</span>
          <span className={styles.sectionDesc}>{RFP_PROFILE.basicDesc}</span>
        </div>
        <div className={styles.fieldGrid}>
          {field('companyName', RFP_PROFILE.companyName)}
          {field('businessNumber', RFP_PROFILE.businessNumber)}
          {field('capitalKrw', RFP_PROFILE.capital, true)}
          {field('annualRevenueKrw', RFP_PROFILE.revenue, true)}
          {field('headcount', RFP_PROFILE.headcount, true)}
          {field('region', RFP_PROFILE.region)}
        </div>
      </section>

      {/* ③ 실적 — 실적 요건을 이걸로 판정한다 */}
      <RowSection
        title={RFP_PROFILE.trackRecords}
        desc={RFP_PROFILE.trackRecordsDesc}
        rows={records}
        onAdd={() => setRecords((p) => [...p, { ...NEW_RECORD }])}
        onRemove={(i) => setRecords((p) => p.filter((_, k) => k !== i))}
        render={(row, i) => (
          <div className={styles.fieldGrid}>
            <TextField label={RFP_PROFILE.recordName} value={row.projectName}
              onChange={(v) => setRecords(patch(i, (r) => ({ ...r, projectName: v })))} />
            <TextField label={RFP_PROFILE.recordClient} value={row.client ?? ''}
              onChange={(v) => setRecords(patch(i, (r) => ({ ...r, client: v || null })))} />
            <TextField label={RFP_PROFILE.recordAmount} value={row.amountKrw === null ? '' : String(row.amountKrw)}
              numeric onChange={(v) => setRecords(patch(i, (r) => ({ ...r, amountKrw: v ? Number(v) : null })))} />
            <TextField label={RFP_PROFILE.recordStart} type="date" value={row.startDate ?? ''}
              onChange={(v) => setRecords(patch(i, (r) => ({ ...r, startDate: v || null })))} />
            <TextField label={RFP_PROFILE.recordEnd} type="date" value={row.endDate ?? ''}
              onChange={(v) => setRecords(patch(i, (r) => ({ ...r, endDate: v || null })))} />
            <TextField label={RFP_PROFILE.recordTags} value={row.domainTags.join(', ')}
              onChange={(v) => setRecords(patch(i, (r) => ({ ...r, domainTags: splitTags(v) })))} />
          </div>
        )}
      />

      {/* ④ 인증 */}
      <RowSection
        title={RFP_PROFILE.certifications}
        desc={RFP_PROFILE.certificationsDesc}
        rows={certs}
        onAdd={() => setCerts((p) => [...p, { ...NEW_CERT }])}
        onRemove={(i) => setCerts((p) => p.filter((_, k) => k !== i))}
        render={(row, i) => (
          <div className={styles.fieldGrid}>
            <TextField label={RFP_PROFILE.certName} value={row.name}
              onChange={(v) => setCerts(patch(i, (c) => ({ ...c, name: v })))} />
            <TextField label={RFP_PROFILE.certIssuer} value={row.issuer ?? ''}
              onChange={(v) => setCerts(patch(i, (c) => ({ ...c, issuer: v || null })))} />
            <TextField label={RFP_PROFILE.certValidUntil} type="date" value={row.validUntil ?? ''}
              onChange={(v) => setCerts(patch(i, (c) => ({ ...c, validUntil: v || null })))} />
          </div>
        )}
      />

      {/* ⑤ 기술 */}
      <RowSection
        title={RFP_PROFILE.capabilities}
        desc={RFP_PROFILE.capabilitiesDesc}
        rows={caps}
        onAdd={() => setCaps((p) => [...p, { ...NEW_CAP }])}
        onRemove={(i) => setCaps((p) => p.filter((_, k) => k !== i))}
        render={(row, i) => (
          <div className={styles.fieldGrid}>
            <TextField label={RFP_PROFILE.capTag} value={row.tag}
              onChange={(v) => setCaps(patch(i, (c) => ({ ...c, tag: v })))} />
            <TextField label={RFP_PROFILE.capLevel} value={String(row.level)} numeric
              onChange={(v) => setCaps(patch(i, (c) => ({ ...c, level: clampLevel(v) })))} />
          </div>
        )}
      />

      {/* ⑥ 협력사 */}
      <RowSection
        title={RFP_PROFILE.partners}
        desc={RFP_PROFILE.partnersDesc}
        rows={partners}
        onAdd={() => setPartners((p) => [...p, { ...NEW_PARTNER }])}
        onRemove={(i) => setPartners((p) => p.filter((_, k) => k !== i))}
        render={(row, i) => (
          <div className={styles.fieldGrid}>
            <TextField label={RFP_PROFILE.partnerName} value={row.name}
              onChange={(v) => setPartners(patch(i, (x) => ({ ...x, name: v })))} />
            <TextField label={RFP_PROFILE.partnerCapabilities} value={row.capabilities.join(', ')}
              onChange={(v) => setPartners(patch(i, (x) => ({ ...x, capabilities: splitTags(v) })))} />
          </div>
        )}
      />

      <div className={styles.actions}>
        <NbButton onClick={() => void save(false)} disabled={busy || !basic.companyName.trim()}>
          {RFP_PROFILE.confirm}
        </NbButton>
        <NbButton variant="secondary" onClick={() => void save(true)} disabled={busy}>
          {RFP_PROFILE.saveDraft}
        </NbButton>
      </div>
    </div>
  )
}

/** 줄 하나만 바꾸고 나머지는 그대로 — 통째로 다시 만들면 입력 중이던 다른 칸이 튄다 */
function patch<T>(index: number, fn: (row: T) => T) {
  return (prev: T[]): T[] => prev.map((row, i) => (i === index ? fn(row) : row))
}

function splitTags(v: string): string[] {
  return v.split(',').map((x) => x.trim()).filter(Boolean)
}

function clampLevel(v: string): number {
  const n = Number(v || 3)
  return Math.min(5, Math.max(1, Number.isFinite(n) ? Math.round(n) : 3))
}

interface RowSectionProps<T> {
  title: string
  desc: string
  rows: T[]
  onAdd: () => void
  onRemove: (index: number) => void
  render: (row: T, index: number) => React.ReactNode
}

/** 줄이 늘어나는 절 — 넷이 같은 골격을 쓴다(따로 그리면 넷이 서로 달라진다) */
function RowSection<T>({ title, desc, rows, onAdd, onRemove, render }: RowSectionProps<T>) {
  return (
    <section className="card">
      <div className={styles.sectionHead}>
        <div className={styles.between}>
          <span className={styles.sectionTitle}>{title}</span>
          <NbBadge status="note">{rows.length}</NbBadge>
        </div>
        <span className={styles.sectionDesc}>{desc}</span>
      </div>

      {rows.length === 0 && <span className={styles.sectionDesc}>{RFP_PROFILE.emptyRows}</span>}

      <div className={styles.ruleList}>
        {rows.map((row, i) => (
          <div key={i} className={styles.ruleItem}>
            {render(row, i)}
            <NbButton variant="ghost" onClick={() => onRemove(i)} aria-label={RFP_PROFILE.removeRow}>
              <X size={12} />
            </NbButton>
          </div>
        ))}
      </div>

      <div className={styles.actions}>
        <NbButton variant="secondary" onClick={onAdd}>
          <Plus size={14} /> {RFP_PROFILE.addRow}
        </NbButton>
      </div>
    </section>
  )
}

interface TextFieldProps {
  label: string
  value: string
  onChange: (v: string) => void
  numeric?: boolean
  type?: string
}

function TextField({ label, value, onChange, numeric, type }: TextFieldProps) {
  return (
    <div className={styles.field}>
      <label className="label">{label}</label>
      <input
        className="input-field"
        type={type ?? 'text'}
        value={value}
        onChange={(e) => onChange(numeric ? e.target.value.replace(/[^0-9]/g, '') : e.target.value)}
      />
    </div>
  )
}
