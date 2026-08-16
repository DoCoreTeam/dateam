'use client'

// 설정 카드 (dacrm T1-08)
//
// 카드마다 저장한다(§2-5-4) — 탭 하단 일괄 저장 바를 두지 않는다.
// 각 설정이 서로 다른 시스템을 가리키고, 하나가 실패해도 나머지는 저장돼야 하기 때문이다.
//
// 시크릿은 **저장하면 다시 볼 수 없다.** 그 사실을 화면이 먼저 말해야
// 사용자가 "어? 아까 넣은 키가 왜 안 보이지"를 겪지 않는다.

import { useCallback, useEffect, useState } from 'react'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import AXDotLoader from '@/components/ui/AXDotLoader'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import styles from './settings.module.css'

interface SettingItem {
  key: string
  label: string
  kind: 'text' | 'number' | 'secret'
  description: string
  value: string | null
  masked: string | null
  source: 'WORKSPACE' | 'GLOBAL' | 'FALLBACK'
}

/** 값이 어디서 왔는지 — "설정했는데 왜 안 바뀌지"를 없애는 유일한 표시 */
const SOURCE_LABEL: Record<SettingItem['source'], string> = {
  WORKSPACE: '이 워크스페이스',
  GLOBAL: '공통 설정',
  FALLBACK: '기본값',
}

export default function SettingsCard() {
  const [items, setItems] = useState<SettingItem[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/crm/settings')
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '설정을 불러오지 못했습니다.'); return }
      const list: SettingItem[] = body.items ?? []
      setItems(list)
      // 시크릿은 초안을 비워 둔다 — 마스킹된 값을 그대로 저장하면 그게 키가 된다
      setDrafts(Object.fromEntries(list.map((s) => [s.key, s.kind === 'secret' ? '' : (s.value ?? '')])))
    } catch {
      setError('설정을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function save(key: string) {
    setSavingKey(key)
    setError(null)
    try {
      const res = await fetch('/api/crm/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value: drafts[key] ?? '' }),
      })
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '저장하지 못했습니다.'); return }
      void load()
    } catch {
      setError('저장하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setSavingKey(null)
    }
  }

  if (loading && items.length === 0) return <AXDotLoader />

  return (
    <div className={`card ${styles.card}`}>
      <div className={styles.head}>
        <h2 className={styles.title}>AI·연동 설정</h2>
      </div>

      <FormErrorBanner message={error} />

      <div className={styles.settings}>
        {items.map((s) => (
          <div key={s.key} className={styles.setting}>
            <div className={styles.settingHead}>
              <label className="label" htmlFor={`set-${s.key}`}>{s.label}</label>
              <NbBadge>{SOURCE_LABEL[s.source]}</NbBadge>
            </div>
            <p className={styles.hint}>{s.description}</p>

            <div className={styles.row}>
              <div className={styles.field}>
                <input
                  id={`set-${s.key}`}
                  className="input-field"
                  type={s.kind === 'secret' ? 'password' : 'text'}
                  value={drafts[s.key] ?? ''}
                  onChange={(e) => setDrafts((d) => ({ ...d, [s.key]: e.target.value }))}
                  placeholder={s.kind === 'secret'
                    ? (s.masked ? `저장됨 ${s.masked} — 바꾸려면 새 값을 넣으세요` : '아직 없음')
                    : ''}
                  autoComplete="off"
                />
              </div>
              <NbButton onClick={() => void save(s.key)} disabled={savingKey === s.key}>
                {savingKey === s.key ? '저장 중…' : '저장'}
              </NbButton>
            </div>
          </div>
        ))}
      </div>

      <p className={styles.hint}>
        비워서 저장하면 공통 설정이나 기본값으로 돌아갑니다. 키는 저장 후 다시 볼 수 없고 바꿀 수만 있습니다.
      </p>
    </div>
  )
}
