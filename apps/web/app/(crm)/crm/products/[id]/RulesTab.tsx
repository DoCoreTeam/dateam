'use client'

// 규칙과 할인 — 같은 표의 두 얼굴이다(할인은 규칙의 한 종류).
// 규칙은 통째로 저장한다. 모양이 틀린 규칙은 거절하지 않고 끈 채로 남고 사유가 선다.
// 지우기는 바로 지우기지만 앞뒤가 감사 기록에 남는다.

import { useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import EmptyState from '@/components/ui/EmptyState'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import { ACTION, PRICEBOOK, RULE_KIND_LABEL, progress } from '@/lib/terms'
import { describeRule } from '@/lib/crm/domain/pricebook/rule-text'
import type { PriceRule } from '@/lib/crm/domain/pricebook/types'
import type { DetailJson, RuleJson } from './detail-shape'
import RuleAddModal from './RuleAddModal'
import styles from './detail.module.css'

interface Props { data: DetailJson; mode: 'rules' | 'discounts'; onSaved: () => void }

function toRule(r: RuleJson): PriceRule {
  return { ...r.body, kind: r.kind } as PriceRule
}

export default function RulesTab({ data, mode, onSaved }: Props) {
  const all = useMemo(() => data.rules.map((r) => ({ rule: toRule(r), json: r })), [data.rules])
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const nameOf = (id: string) => data.items.find((i) => i.id === id)?.name ?? null
  const shown = all.map((x, i) => ({ ...x, index: i })).filter((x) => (mode === 'discounts') === (x.rule.kind === 'DISCOUNT'))

  const save = async (rules: PriceRule[]) => {
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      const res = await fetch(`/api/crm/pricebook/products/${data.product.id}/rules`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: data.product.version, rules }),
      })
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '저장하지 못했습니다.'); return }
      if (body.disabled > 0) setNote(`규칙 ${body.disabled}개는 모양이 맞지 않아 끈 채로 저장했어요. 사유를 보고 고치세요.`)
      onSaved()
    } catch {
      setError('저장하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  const remove = (index: number) => void save(all.filter((_, i) => i !== index).map((x) => x.rule))

  return (
    <div className={styles.wrap}>
      <div className={styles.actions}>
        <NbButton onClick={() => setAdding(true)} disabled={busy}>
          <Plus size={14} /> {mode === 'discounts' ? `${PRICEBOOK.detailDiscounts} 추가` : `${PRICEBOOK.detailRules} 추가`}
        </NbButton>
      </div>
      <FormErrorBanner message={error} />
      {note && <p className={styles.small}>{note}</p>}
      {shown.length === 0 ? (
        <EmptyState title={mode === 'discounts' ? '할인 규칙이 없어요' : '규칙이 없어요'} description={mode === 'discounts' ? '할인 없이 정상가로 계산해요.' : '규칙이 없으면 선택한 품목만 들어가요.'} />
      ) : (
        <ul className={styles.ruleList}>
          {shown.map((x) => (
            <li key={x.json.id} className={`${styles.ruleItem} ${x.json.isEnabled ? '' : styles.ruleOff}`}>
              <div>
                <NbBadge status={x.json.isEnabled ? 'doing' : 'note'}>{RULE_KIND_LABEL[x.rule.kind] ?? x.rule.kind}</NbBadge>{' '}
                {describeRule(x.rule, nameOf)}
                {!x.json.isEnabled && x.json.disabledReason && <div className={styles.small}>꺼 둠: {x.json.disabledReason}</div>}
              </div>
              <NbButton variant="ghost" disabled={busy} onClick={() => remove(x.index)} aria-label={ACTION.delete}>
                <Trash2 size={14} /> {busy ? progress(ACTION.delete) : ACTION.delete}
              </NbButton>
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <RuleAddModal
          items={data.items.filter((i) => i.isActive)}
          discountOnly={mode === 'discounts'}
          onClose={() => setAdding(false)}
          onAdd={(rule) => { setAdding(false); void save([...all.map((x) => x.rule), rule]) }}
        />
      )}
    </div>
  )
}
