'use client'

// 자동 반영 설정 (dacrm 정정판)
//
// **이 카드가 없어서 인박스의 '자동 반영됨' 탭이 구조적으로 영원히 비어 있었다.**
// 설정 행이 하나도 없으니 판정은 언제나 "자동 반영 꺼짐"을 받았다.
//
// 이 화면이 정하는 것은 편의가 아니라 **신뢰의 범위**다 —
// "AI 가 이 칸은 알아서 채워도 된다"고 사람이 허락하는 자리다.
// 그래서 두 가지를 분명히 보여 준다: 못 켜는 칸은 **왜** 못 켜는지,
// 켠 칸은 **얼마나 확신할 때** 반영되는지.

import { useCallback, useEffect, useState } from 'react'
import NbBadge from '@/components/ui/nb/NbBadge'
import AXDotLoader from '@/components/ui/AXDotLoader'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import styles from './settings.module.css'

interface Row {
  targetType: string
  field: string
  label: string
  autoApply: boolean
  minConfidence: number
  configurable: boolean
  reason?: string
}

const TARGET_LABEL: Record<string, string> = { company: '회사', person: '인물', deal: '딜' }

export default function AutoApplyCard() {
  const [items, setItems] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/crm/field-config')
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '설정을 불러오지 못했습니다.'); return }
      setItems(body.items ?? [])
    } catch {
      setError('설정을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function save(row: Row, patch: { autoApply?: boolean; minConfidence?: number }) {
    const key = `${row.targetType}.${row.field}`
    setBusy(key)
    setError(null)
    // 먼저 반영한다 — 토글이 늦게 움직이면 사람은 두 번 누른다
    setItems((list) => list.map((r) =>
      r.targetType === row.targetType && r.field === row.field ? { ...r, ...patch } : r))
    try {
      const res = await fetch('/api/crm/field-config', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetType: row.targetType, field: row.field, ...patch }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body?.error?.message ?? '저장하지 못했습니다.')
        await load()  // 실패했으면 서버 값으로 되돌린다
      }
    } catch {
      setError('저장하지 못했습니다. 잠시 후 다시 시도해 주세요.')
      await load()
    } finally {
      setBusy(null)
    }
  }

  if (loading && items.length === 0) return <AXDotLoader />

  const grouped = ['company', 'person', 'deal'].map((t) => ({
    target: t, rows: items.filter((r) => r.targetType === t),
  })).filter((g) => g.rows.length > 0)

  const onCount = items.filter((r) => r.autoApply).length

  return (
    <div className={`card ${styles.card}`}>
      <div className={styles.head}>
        <h2 className={styles.title}>AI 자동 반영</h2>
        <NbBadge status={onCount > 0 ? 'doing' : 'note'}>
          {onCount > 0 ? `${onCount}개 칸 허용` : '전부 사람 확인'}
        </NbBadge>
      </div>

      <FormErrorBanner message={error} />

      <p className={styles.hint}>
        켜 둔 칸은 AI가 확신할 때 바로 채웁니다. 꺼 둔 칸은 인박스에서 사람이 확인한 뒤에 반영됩니다.
        레코드에서 자물쇠로 확정한 값은 켜 두어도 덮지 않습니다.
      </p>

      {grouped.map((g) => (
        <div key={g.target} className={styles.autoGroup}>
          <h3 className={styles.autoGroupTitle}>{TARGET_LABEL[g.target] ?? g.target}</h3>
          <ul className={styles.autoList}>
            {g.rows.map((r) => {
              const key = `${r.targetType}.${r.field}`
              return (
                <li key={key} className={styles.autoItem}>
                  <span className={styles.autoLabel}>{r.label}</span>

                  {!r.configurable ? (
                    // 못 켜는 칸은 토글 대신 이유를 보여 준다 — 없는 스위치를 찾게 두지 않는다
                    <span className={styles.autoLocked}>{r.reason}</span>
                  ) : (
                    <>
                      <label className={styles.autoToggle}>
                        <input
                          type="checkbox"
                          checked={r.autoApply}
                          disabled={busy === key}
                          onChange={(e) => void save(r, { autoApply: e.target.checked })}
                        />
                        <span>{r.autoApply ? '자동 반영' : '사람 확인'}</span>
                      </label>

                      {r.autoApply && (
                        <label className={styles.autoConf}>
                          <span className={styles.autoConfLabel}>확신</span>
                          <select
                            className="input-field"
                            value={String(r.minConfidence)}
                            disabled={busy === key}
                            onChange={(e) => void save(r, { minConfidence: Number(e.target.value) })}
                            aria-label={`${r.label} 기준 확신도`}
                          >
                            <option value="0.7">70% 이상</option>
                            <option value="0.85">85% 이상 (권장)</option>
                            <option value="0.95">95% 이상</option>
                          </select>
                        </label>
                      )}
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}
