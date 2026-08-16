'use client'

// 자동화 (dacrm FR-08)
//
// **왜 필요한가**: 영업에서 잊히는 일은 생각이 안 나서가 아니라 **손이 안 가서**다.
// 제안을 보냈으면 사흘 뒤 확인해야 하는데, 그 할 일을 만드는 데 드는 30초가
// 딜 열두 개에서는 열두 번이라 결국 아무도 안 만든다.
// 그래서 **단계를 옮기는 순간 할 일이 저절로 생기게** 한다.
//
// **규칙은 기본이 꺼짐이다.** 만들자마자 도는 것보다 사람이 켜는 편이 안전하다 —
// 잘못 만든 규칙이 딜을 옮길 때마다 할 일을 쏟아내면 그때부터 아무도 할 일 목록을 안 본다.

import { useCallback, useEffect, useState } from 'react'
import { Plus, Trash2, Zap } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import AXDotLoader from '@/components/ui/AXDotLoader'
import EmptyState from '@/components/ui/EmptyState'
import {
  TRIGGER_LABEL, MAX_RULES,
  type AutomationRule, type TriggerKind,
} from '@/lib/crm/services/automation'
import styles from './settings.module.css'

interface Stage { id: string; name: string; pipelineName: string }

const TRIGGERS = Object.keys(TRIGGER_LABEL) as TriggerKind[]

/** 새 규칙의 id — 시간과 난수로 충분하다(서버가 다시 검증한다) */
function newId(): string {
  return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export default function AutomationCard() {
  const [rules, setRules] = useState<AutomationRule[]>([])
  const [stages, setStages] = useState<Stage[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/crm/automations')
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '불러오지 못했습니다.'); return }
      setRules(body.rules ?? [])
      setStages(body.stages ?? [])
    } catch {
      setError('불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  function patch(id: string, next: Partial<AutomationRule>) {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, ...next } : r)))
    setNotice(null)
  }

  function add() {
    if (rules.length >= MAX_RULES) {
      setError(`규칙은 ${MAX_RULES}개까지 만들 수 있어요.`)
      return
    }
    setError(null)
    setNotice(null)
    setRules((prev) => [...prev, {
      id: newId(),
      name: '',
      enabled: false,
      trigger: 'deal.entered_stage',
      stageId: null,
      stalledDays: 7,
      minAmountMinor: null,
      action: 'create_task',
      taskTitle: '{회사} 확인 연락',
      taskDueInDays: 3,
    }])
  }

  async function save() {
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/crm/automations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rules }),
      })
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '저장하지 못했습니다.'); return }
      setRules(body.rules ?? [])
      const on = (body.rules ?? []).filter((r: AutomationRule) => r.enabled).length
      setNotice(`저장했어요. ${on}개가 켜져 있습니다.`)
    } catch {
      setError('저장하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={`card ${styles.card}`}>
      <h2 className={styles.cardTitle}>자동화</h2>
      <p className={styles.cardDesc}>
        딜이 움직이면 할 일을 대신 만들어 둡니다. 제목에 <code>{'{회사}'}</code>·<code>{'{딜}'}</code>를
        넣으면 실제 이름으로 채워져요. 만든 규칙은 <strong>켜야</strong> 돕니다.
      </p>

      <FormErrorBanner message={error} />
      {notice && <p className={styles.undo}>{notice}</p>}

      {loading ? <AXDotLoader /> : (
        <>
          {rules.length === 0 && (
            <EmptyState
              title="아직 규칙이 없어요"
              description="예를 들어 “제안 단계에 들어오면 3일 뒤 확인 연락” 같은 걸 만들 수 있습니다."
              icon={<Zap size={28} />}
            />
          )}

          {rules.map((r) => (
            <div key={r.id} className={styles.ruleRow}>
              <div className={styles.ruleHead}>
                <label className="label">
                  <input
                    type="checkbox"
                    checked={r.enabled}
                    onChange={(e) => patch(r.id, { enabled: e.target.checked })}
                  />{' '}
                  {r.enabled ? '켜짐' : '꺼짐'}
                </label>
                <input
                  className="input-field"
                  value={r.name}
                  placeholder="규칙 이름 (예: 제안 후 확인 연락)"
                  onChange={(e) => patch(r.id, { name: e.target.value })}
                  aria-label="규칙 이름"
                />
                <NbButton
                  variant="ghost"
                  onClick={() => setRules((prev) => prev.filter((x) => x.id !== r.id))}
                  aria-label="규칙 지우기"
                >
                  <Trash2 size={14} />
                </NbButton>
              </div>

              <div className={styles.ruleGrid}>
                <label className="label">
                  언제
                  <select
                    className="input-field"
                    value={r.trigger}
                    onChange={(e) => patch(r.id, { trigger: e.target.value as TriggerKind })}
                  >
                    {TRIGGERS.map((t) => <option key={t} value={t}>{TRIGGER_LABEL[t]}</option>)}
                  </select>
                </label>

                {(r.trigger === 'deal.entered_stage' || r.trigger === 'deal.stalled') && (
                  <label className="label">
                    어느 단계
                    <select
                      className="input-field"
                      value={r.stageId ?? ''}
                      onChange={(e) => patch(r.id, { stageId: e.target.value || null })}
                    >
                      <option value="">모든 단계</option>
                      {stages.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.pipelineName ? `${s.pipelineName} · ` : ''}{s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {r.trigger === 'deal.stalled' && (
                  <label className="label">
                    며칠 이상
                    <input
                      className="input-field"
                      type="number"
                      min={1}
                      value={r.stalledDays ?? 7}
                      onChange={(e) => patch(r.id, { stalledDays: Number(e.target.value) })}
                    />
                  </label>
                )}

                <label className="label">
                  할 일 제목
                  <input
                    className="input-field"
                    value={r.taskTitle}
                    placeholder="{회사} 확인 연락"
                    onChange={(e) => patch(r.id, { taskTitle: e.target.value })}
                  />
                </label>

                <label className="label">
                  기한 (며칠 뒤)
                  <input
                    className="input-field"
                    type="number"
                    min={1}
                    value={r.taskDueInDays ?? 3}
                    onChange={(e) => patch(r.id, { taskDueInDays: Number(e.target.value) })}
                  />
                </label>
              </div>
            </div>
          ))}

          <div className={styles.actions}>
            <NbButton variant="ghost" onClick={add}><Plus size={14} /> 규칙 추가</NbButton>
            <NbButton onClick={() => void save()} disabled={saving}>
              <Zap size={14} /> {saving ? '저장 중…' : '저장'}
            </NbButton>
          </div>
        </>
      )}
    </div>
  )
}
