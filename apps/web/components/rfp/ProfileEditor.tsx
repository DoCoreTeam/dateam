'use client'

// 회사 프로필 — 문서를 올려 초안을 만들고 사람이 확인한다.
//
// 「회사 정보를 다 입력하세요」로 시작하는 기능은 첫 화면에서 버려진다.
// 회사소개서는 이미 갖고 있는 문서다 — 올리면 대부분 채워진다.

import { useCallback, useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import { RFP_PROFILE, RFP_COMMON } from '@/lib/rfp/terms'

export interface ProfileBasic {
  companyName: string
  businessNumber: string | null
  capitalKrw: number | null
  annualRevenueKrw: number | null
  headcount: number | null
  region: string | null
}

export interface ProfileEditorProps {
  initial: ProfileBasic | null
  initialVersion: number | null
  initialStatus: string | null
}

const EMPTY: ProfileBasic = {
  companyName: '', businessNumber: null, capitalKrw: null,
  annualRevenueKrw: null, headcount: null, region: null,
}

export default function ProfileEditor({ initial, initialVersion, initialStatus }: ProfileEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [basic, setBasic] = useState<ProfileBasic>(initial ?? EMPTY)
  const [version, setVersion] = useState(initialVersion)
  const [status, setStatus] = useState(initialStatus)
  const [missing, setMissing] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

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
      setBasic({ ...EMPTY, ...(body.profile?.basic ?? {}) })
      setVersion(body.profile?.version ?? null)
      // 초안은 draft 다 — 확인 전에는 판정에 안 쓰인다
      setStatus(body.profile?.status ?? 'draft')
      setMissing(body.missing ?? [])
    } catch {
      setError(RFP_COMMON.error)
    } finally {
      setBusy(false)
    }
  }, [])

  const save = useCallback(async () => {
    setError(null)
    setSaved(false)
    setBusy(true)
    try {
      const res = await fetch('/api/rfp/profile', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ basic }),
      })
      const body = await res.json()
      if (!res.ok) { setError(RFP_PROFILE.confirm); return }
      setVersion(body.profile?.version ?? null)
      setStatus(body.profile?.status ?? 'active')
      setSaved(true)
    } catch {
      setError(RFP_COMMON.error)
    } finally {
      setBusy(false)
    }
  }, [basic])

  const field = (key: keyof ProfileBasic, label: string, numeric = false) => (
    <div className="field" key={key}>
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
    <div className="card">
      {error && <FormErrorBanner message={error} />}

      <p style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-sm)' }}>{RFP_PROFILE.draftHint}</p>
      <input ref={inputRef} type="file" multiple style={{ display: 'none' }}
        onChange={(e) => void draft(e.target.files)} />
      <NbButton variant="ghost" onClick={() => inputRef.current?.click()} disabled={busy}>
        <Upload size={14} /> {RFP_PROFILE.draftUpload}
      </NbButton>

      {version !== null && <NbBadge status={status === 'active' ? 'done' : 'doing'}>{version}</NbBadge>}
      {saved && <NbBadge status="done">{RFP_COMMON.save}</NbBadge>}

      {field('companyName', RFP_PROFILE.companyName)}
      {field('businessNumber', RFP_PROFILE.businessNumber)}
      {field('capitalKrw', RFP_PROFILE.capital, true)}
      {field('annualRevenueKrw', RFP_PROFILE.revenue, true)}
      {field('headcount', RFP_PROFILE.headcount, true)}
      {field('region', RFP_PROFILE.region)}

      {missing.length > 0 && (
        <p style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-xs)' }}>
          {RFP_PROFILE.missing} {missing.join(', ')}
        </p>
      )}

      <NbButton onClick={() => void save()} disabled={busy || !basic.companyName.trim()}>
        {RFP_PROFILE.confirm}
      </NbButton>
    </div>
  )
}
