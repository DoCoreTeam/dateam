'use client'

// AI 공급자 설정 — 사내 서빙 등록이 여기 있다.
//
// **등록 전에는 NDA 문서 분석이 막힌다.** 그 사실을 화면이 말해야
// 관리자가 왜 등록해야 하는지 안다.

import { useState } from 'react'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import { RFP_ADMIN, RFP_COMMON, DOC_CLASS_LABEL } from '@/lib/rfp/terms'
import { checkEndpoint } from '@/lib/rfp/ai/self-hosted'

export interface VendorRow {
  id: string
  name: string
  isInternal: boolean
  hasCredential: boolean
  baseUrl: string | null
  modelName: string | null
  allowedDocClasses: string[]
}

export interface VendorSettingsProps {
  vendors: VendorRow[]
}

export default function VendorSettings({ vendors }: VendorSettingsProps) {
  const [baseUrl, setBaseUrl] = useState('')
  const [modelName, setModelName] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState<string | null>(null)

  // 저장 전에 화면에서 먼저 본다 — 서버까지 갔다 오지 않아도 무엇이 틀렸는지 안다
  const check = checkEndpoint({ baseUrl, modelName, apiKey: apiKey || null })

  return (
    <section className="card">
      <h2 className="label">{RFP_ADMIN.vendors}</h2>
      {error && <FormErrorBanner message={error} />}

      <ul>
        {vendors.map((v) => (
          <li key={v.id}>
            <span>{v.name}</span>
            {v.isInternal && <NbBadge status="note">{RFP_ADMIN.internalVendor}</NbBadge>}
            {v.hasCredential
              ? <NbBadge status="done">{v.modelName ?? ''}</NbBadge>
              : <NbBadge status="blocker">{RFP_ADMIN.notRegistered}</NbBadge>}
            <span style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-xs)' }}>
              {v.allowedDocClasses.map((c) => DOC_CLASS_LABEL[c as 'public'] ?? c).join(', ')}
            </span>
          </li>
        ))}
      </ul>

      {/* 사내 서빙 등록 — 주소와 모델 이름 둘이면 된다 */}
      <p style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-sm)' }}>{RFP_ADMIN.internalHint}</p>

      <div className="field">
        <label className="label" htmlFor="v-url">{RFP_ADMIN.vendorBaseUrl}</label>
        <input id="v-url" className="input-field" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
      </div>
      <div className="field">
        <label className="label" htmlFor="v-model">{RFP_ADMIN.vendorModel}</label>
        <input id="v-model" className="input-field" value={modelName} onChange={(e) => setModelName(e.target.value)} />
      </div>
      <div className="field">
        <label className="label" htmlFor="v-key">{RFP_ADMIN.vendorKey}</label>
        <input id="v-key" className="input-field" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
      </div>

      {!check.ok && (baseUrl || modelName) && (
        <p style={{ color: 'var(--danger)', fontSize: 'var(--fs-sm)' }}>{check.problems.join(', ')}</p>
      )}

      <NbButton
        disabled={!check.ok}
        onClick={() => setError(RFP_ADMIN.saveFailed)}
      >
        {RFP_COMMON.save}
      </NbButton>
    </section>
  )
}
