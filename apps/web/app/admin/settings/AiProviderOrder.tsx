'use client'

// 기본 공급자와 폴백 순서 — 한 카드에서
//
// 두 값은 한 질문의 두 부분이다. 「새 대화를 어느 공급자로 시작하나」와
// 「그게 막히면 어디로 넘어가나」를 다른 카드에서 정하면, 기본값이 폴백 순서 맨 앞이 아닐 때
// 무슨 일이 벌어지는지 아무도 화면에서 알 수 없다.
//
// 순서에 없는 공급자는 registry 가 명세 순서 뒤에 자동으로 붙인다 —
// 공급자를 하나 더해도 순서가 비지 않고, 조직이 고른 순서도 안 깨진다.

import { useState, useTransition } from 'react'
import { Sparkles, CheckCircle, XCircle, KeyRound } from 'lucide-react'
import SettingsCard from '@/components/ui/settings/SettingsCard'
import StatusPill from '@/components/ui/settings/StatusPill'
import FieldNote from '@/components/ui/settings/FieldNote'
import ReorderList from '@/components/ui/ReorderList'
import type { AiProviderId } from '@/lib/ai/provider-catalog'
import { saveAiChatDefaultProvider, saveAiProviderOrder } from './actions'

interface ProviderRow {
  id: AiProviderId
  label: string
  /** 키가 등록됐나. 없으면 순서에 있어도 건너뛴다 */
  hasKey: boolean
}

interface Props {
  /** 명세 순서대로의 전체 공급자 — 키 없는 것도 포함해 무엇이 왜 빠지는지 보이게 한다 */
  providers: ProviderRow[]
  /** 지금 저장된 폴백 순서 */
  order: AiProviderId[]
  current: AiProviderId | ''
}

export default function AiProviderOrder({ providers, order: initialOrder, current }: Props) {
  const [value, setValue] = useState<AiProviderId | ''>(current)
  const [order, setOrder] = useState<AiProviderId[]>(initialOrder)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = useTransition()

  const byId = new Map(providers.map((p) => [p.id, p]))
  const rows = order.map((id) => byId.get(id)).filter((p): p is ProviderRow => Boolean(p))
  const usable = providers.filter((p) => p.hasKey)

  function handleDefault(next: AiProviderId | '') {
    setValue(next)
    setMsg(null)
    start(async () => {
      const r = await saveAiChatDefaultProvider(next)
      setMsg(r.ok
        ? { ok: true, text: '기본 공급자를 저장했습니다' }
        : { ok: false, text: r.error ?? '저장 실패' })
      if (!r.ok) setValue(current)
    })
  }

  function handleReorder(ids: string[]) {
    const next = ids as AiProviderId[]
    const prev = order
    setOrder(next)
    setMsg(null)
    start(async () => {
      const r = await saveAiProviderOrder(next)
      setMsg(r.ok
        ? { ok: true, text: '폴백 순서를 저장했습니다' }
        : { ok: false, text: r.error ?? '저장 실패' })
      if (!r.ok) setOrder(prev)
    })
  }

  return (
    <SettingsCard
      title="기본 공급자와 폴백 순서"
      headingLevel={2}
      icon={<Sparkles size={16} />}
      description="새 대화를 어느 공급자로 시작하고, 그게 막히면 어디로 넘어갈지 정합니다."
    >
      <div>
        <label className="label" htmlFor="ai-default-provider">새 대화 기본 공급자</label>
        <select
          id="ai-default-provider"
          className="input-field"
          value={value}
          disabled={pending}
          onChange={(e) => handleDefault(e.target.value as AiProviderId | '')}
        >
          <option value="">자동 (순서에서 쓸 수 있는 첫 공급자)</option>
          {usable.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
        <FieldNote>키를 등록한 공급자만 고를 수 있습니다</FieldNote>
      </div>

      <div>
        <span className="label">폴백 순서</span>
        <FieldNote>위에 있는 공급자부터 시도합니다. 키가 없는 공급자는 순서에 있어도 건너뜁니다</FieldNote>
        <ReorderList
          items={rows}
          getId={(p) => p.id}
          getLabel={(p) => p.label}
          onReorder={handleReorder}
          disabled={pending}
        >
          {(p, i, controls) => (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0 }}>
              {controls}
              <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)' }}>{i + 1}</span>
              <span style={{ fontWeight: 600 }}>{p.label}</span>
              {p.hasKey
                ? <StatusPill tone="ok">키 있음</StatusPill>
                : <StatusPill tone="neutral" title="키를 넣기 전까지는 건너뜁니다">
                    <KeyRound size={12} /> 키 없음
                  </StatusPill>}
            </div>
          )}
        </ReorderList>
      </div>

      {msg && (
        <p role="status">
          <StatusPill tone={msg.ok ? 'ok' : 'danger'}>
            {msg.ok ? <CheckCircle size={12} /> : <XCircle size={12} />}
            {msg.text}
          </StatusPill>
        </p>
      )}
    </SettingsCard>
  )
}
