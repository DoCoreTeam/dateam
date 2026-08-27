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
import { SETTING_GROUP as GROUP, SETTING_GROUP_ORDER as GROUP_ORDER } from '@/lib/crm/domain/setting-group'
import styles from './settings.module.css'

interface Choice { value: string; label: string; hint?: string }

interface SettingItem {
  key: string
  label: string
  kind: 'text' | 'number' | 'secret' | 'choice' | 'multiline'
  /** 어느 카드에 설지 — 성격이 다른 설정을 한 목록에 늘어놓지 않는다 */
  group: string
  description: string
  value: string | null
  masked: string | null
  source: 'WORKSPACE' | 'GLOBAL' | 'FALLBACK'
  /** 고를 수 있는 것 — 지금 등록된 AI 키에 따라 달라진다 */
  choices?: Choice[]
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

  // 순서는 상수가 정한다 — 화면이 정하면 카드가 늘어날 때마다 여기가 갈린다
  const groups = GROUP_ORDER.filter((g) => items.some((s) => s.group === g))

  return (
    <>
      <FormErrorBanner message={error} />
      {groups.map((g) => (
    <div className={`card ${styles.card}`} key={g}>
      <div className={styles.head}>
        <h2 className={styles.title}>{GROUP[g].label}</h2>
      </div>

      <div className={styles.settings}>
        {items.filter((s) => s.group === g).map((s) => (
          <div key={s.key} className={styles.setting}>
            <div className={styles.settingHead}>
              <label className="label" htmlFor={`set-${s.key}`}>{s.label}</label>
              <NbBadge>{SOURCE_LABEL[s.source]}</NbBadge>
            </div>
            <p className={styles.hint}>{s.description}</p>

            <div className={styles.row}>
              <div className={styles.field}>
                {/*
                  고를 수 있는 설정은 **드롭다운**이다.
                  예전에는 텍스트 칸에 `gemini` 라고 직접 적으라고 했다 —
                  무엇을 적어야 하는지 모르고, 적어도 키가 없으면 그제야 실패를 듣는다.
                  고를 수 없는 것은 목록에 아예 없다.
                */}
                {s.kind === 'choice' ? (
                  <select
                    id={`set-${s.key}`}
                    className="input-field"
                    value={drafts[s.key] ?? ''}
                    onChange={(e) => setDrafts((d) => ({ ...d, [s.key]: e.target.value }))}
                  >
                    {(s.choices ?? []).map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                ) : s.kind === 'multiline' ? (
                  /*
                    여러 줄이 들어갈 값(거래 조건)을 한 줄 칸에 받으면 사용자는
                    줄바꿈을 못 넣고 전부 한 줄로 적는다 — 그게 그대로 인쇄된다.
                  */
                  <textarea
                    id={`set-${s.key}`}
                    className="input-field"
                    rows={3}
                    value={drafts[s.key] ?? ''}
                    onChange={(e) => setDrafts((d) => ({ ...d, [s.key]: e.target.value }))}
                  />
                ) : (
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
                )}
              </div>
              <NbButton onClick={() => void save(s.key)} disabled={savingKey === s.key}>
                {savingKey === s.key ? '저장 중…' : '저장'}
              </NbButton>
            </div>

            {/* 고른 것이 무슨 뜻인지 그 자리에서 말한다 — 설명이 목록 밖에 있으면 아무도 안 읽는다 */}
            {s.kind === 'choice' && (
              <p className={styles.hint}>
                {(s.choices ?? []).find((c) => c.value === (drafts[s.key] ?? ''))?.hint ?? ''}
              </p>
            )}
          </div>
        ))}
      </div>

      {g === 'ai' && items.some((s) => s.kind === 'choice' && (s.choices ?? []).length <= 2) && (
        <p className={styles.blocked}>
          아직 등록된 AI 키가 없어 &quot;AI 안 씀&quot;으로만 돌아갑니다.
          시스템 설정 → 통합에서 Gemini·Claude·OpenAI 중 하나를 등록하면 여기에 나타납니다.
        </p>
      )}

      <p className={styles.hint}>{GROUP[g].description}</p>
    </div>
      ))}
    </>
  )
}
