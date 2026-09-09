'use client'

// 어디를 뒤질까 — **나라장터만이 아니다.**
//
// 입찰 공고는 기관 자기 게시판에도 올라온다. 지자체·공사·출연연은 자체 게시판에 먼저 붙이고
// 나라장터에는 늦게 올리거나 아예 안 올리기도 한다. 그동안 「어디를 볼지」를 정할 자리가
// 아예 없어서 나라장터 하나로 고정돼 있었고, 그 나라장터마저 **서비스 키를 넣을 화면이 없었다.**

import { useCallback, useState } from 'react'
import { Plus, X, Globe } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import { RFP_RADAR, RFP_COMMON } from '@/lib/rfp/terms'
import styles from '@/app/(rfp)/rfp.module.css'

export interface SiteRow {
  id: string
  name: string
  kind: 'g2b' | 'web'
  url: string | null
  enabled: boolean
  last_run_at: string | null
  last_result: { found?: number; inserted?: number; reason?: string | null; rulesOnly?: boolean } | null
}

export interface SourceSitesProps {
  initialSites: SiteRow[]
  initialHasServiceKey: boolean
}

export default function SourceSites({ initialSites, initialHasServiceKey }: SourceSitesProps) {
  const [sites, setSites] = useState(initialSites)
  const [hasKey, setHasKey] = useState(initialHasServiceKey)
  const [keyInput, setKeyInput] = useState('')
  const [draft, setDraft] = useState<{ name: string; url: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const saveKey = useCallback(async () => {
    if (!keyInput.trim()) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/rfp/sites', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ serviceKey: keyInput.trim() }),
      })
      if (!res.ok) { setError(RFP_COMMON.error); return }
      setHasKey(true)
      // 입력칸을 비운다 — 화면에 키가 남아 있으면 어깨너머로 읽힌다
      setKeyInput('')
    } catch {
      setError(RFP_COMMON.error)
    } finally {
      setBusy(false)
    }
  }, [keyInput])

  const addSite = useCallback(async () => {
    if (!draft) return
    setError(null)
    setBusy(true)
    try {
      const res = await fetch('/api/rfp/sites', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(draft),
      })
      const body = await res.json()
      if (!res.ok) { setError(RFP_COMMON.error); return }
      setSites((p) => [...p, body.site])
      setDraft(null)
    } catch {
      setError(RFP_COMMON.error)
    } finally {
      setBusy(false)
    }
  }, [draft])

  const toggle = useCallback(async (site: SiteRow) => {
    setSites((p) => p.map((s) => (s.id === site.id ? { ...s, enabled: !s.enabled } : s)))
    await fetch('/api/rfp/sites', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: site.id, enabled: !site.enabled }),
    })
  }, [])

  const remove = useCallback(async (id: string) => {
    setSites((p) => p.filter((s) => s.id !== id))
    await fetch(`/api/rfp/sites?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
  }, [])

  return (
    <section className="card">
      {error && <FormErrorBanner message={error} />}

      <div className={styles.sectionHead}>
        <div className={styles.between}>
          <span className={styles.sectionTitle}>{RFP_RADAR.sitesTitle}</span>
          <NbBadge status="note">{sites.filter((s) => s.enabled).length} / {sites.length}</NbBadge>
        </div>
        <span className={styles.sectionDesc}>{RFP_RADAR.sitesDesc}</span>
      </div>

      <div className={styles.ruleList}>
        {sites.map((s) => (
          <div key={s.id} className={styles.ruleItem}>
            <label className={styles.tight}>
              <span className={styles.row}>
                <input type="checkbox" checked={s.enabled} onChange={() => void toggle(s)} />
                <span className={styles.ruleName}>{s.name}</span>
                {s.kind === 'g2b' && (
                  <NbBadge status={hasKey ? 'done' : 'blocker'}>
                    {hasKey ? RFP_RADAR.serviceKeySaved : RFP_RADAR.serviceKeyMissing}
                  </NbBadge>
                )}
              </span>
              {/* 「이 사이트는 왜 0건인지」를 화면이 말한다 */}
              <span className={styles.sectionDesc}>
                {s.url ?? ''}
                {s.last_run_at
                  ? ` · ${RFP_RADAR.lastRun} ${s.last_run_at.slice(0, 10)}`
                  : ` · ${RFP_RADAR.siteNever}`}
                {s.last_result?.reason ? ` · ${s.last_result.reason}` : ''}
                {s.last_result?.rulesOnly ? ` · ${RFP_RADAR.siteRulesOnly}` : ''}
              </span>
            </label>
            {/* 나라장터는 뺄 수 없다 — 빼면 되돌릴 길이 화면에 없다 */}
            {s.kind === 'web' && (
              <NbButton variant="ghost" onClick={() => void remove(s.id)} aria-label={RFP_RADAR.removeSite}>
                <X size={12} />
              </NbButton>
            )}
          </div>
        ))}
      </div>

      {/* 나라장터 서비스 키 — 넣을 자리가 없어서 레이더가 늘 no_service_key 였다 */}
      <div className={styles.field}>
        <label className="label" htmlFor="g2b-key">{RFP_RADAR.serviceKey}</label>
        <div className={styles.row}>
          <input
            id="g2b-key"
            className="input-field"
            type="password"
            value={keyInput}
            placeholder={hasKey ? RFP_RADAR.serviceKeySaved : RFP_RADAR.serviceKeyMissing}
            onChange={(e) => setKeyInput(e.target.value)}
          />
          <NbButton variant="secondary" onClick={() => void saveKey()} disabled={busy || !keyInput.trim()}>
            {RFP_RADAR.saveKey}
          </NbButton>
        </div>
        <span className={styles.sectionDesc}>{RFP_RADAR.serviceKeyHint}</span>
      </div>

      {draft && (
        <div className={styles.fieldGrid}>
          <div className={styles.field}>
            <label className="label">{RFP_RADAR.siteName}</label>
            <input className="input-field" value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </div>
          <div className={styles.field}>
            <label className="label">{RFP_RADAR.siteUrl}</label>
            <input className="input-field" value={draft.url}
              onChange={(e) => setDraft({ ...draft, url: e.target.value })} />
            <span className={styles.sectionDesc}>{RFP_RADAR.siteUrlHint}</span>
          </div>
        </div>
      )}

      <div className={styles.actions}>
        {draft ? (
          <>
            <NbButton onClick={() => void addSite()} disabled={busy}>{RFP_COMMON.save}</NbButton>
            <NbButton variant="secondary" onClick={() => setDraft(null)}>{RFP_COMMON.cancel}</NbButton>
          </>
        ) : (
          <NbButton variant="secondary" onClick={() => setDraft({ name: '', url: '' })}>
            <Plus size={14} /> {RFP_RADAR.addSite}
          </NbButton>
        )}
        <NbButton variant="ghost" href="https://www.data.go.kr" target="_blank">
          <Globe size={14} /> {RFP_RADAR.serviceKey}
        </NbButton>
      </div>
    </section>
  )
}
