'use client'

// 규칙과 할인 — 줄마다 고치기, 켜고 끄기, 복제, 지우기(확인창), 끌어서 순서. 할인은 제안값 확정까지.
//
// 저장은 통째로(규칙 창구 한 번)다. 켬과 끔을 같은 자리 배열로 함께 보낸다 — 안 보내면
// 사람이 꺼 둔 규칙이 다른 규칙을 더할 때 다시 켜진다.
// 모양이 틀려 꺼진 규칙은 사유가 서고, 사람이 끈 규칙은 「사람이 끔」으로 갈려 보인다.

import { useMemo, useState } from 'react'
import { Plus, Trash2, Pencil, Copy, Power, BadgeCheck } from 'lucide-react'
import ReorderList from '@/components/ui/ReorderList'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import EmptyState from '@/components/ui/EmptyState'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import { useAskDialog } from '@/components/ui/useAskDialog'
import { ACTION, PRICEBOOK, RULE_KIND_LABEL } from '@/lib/terms'
import { describeRule } from '@/lib/crm/domain/pricebook/rule-text'
import type { PriceRule } from '@/lib/crm/domain/pricebook/types'
import type { DetailJson, RuleJson } from './detail-shape'
import RuleAddModal from './RuleAddModal'
import styles from './detail.module.css'

interface Props { data: DetailJson; mode: 'rules' | 'discounts'; onSaved: () => void }

interface Row { key: string; rule: PriceRule; enabled: boolean; reason: string | null }

function toRule(r: RuleJson): PriceRule {
  return { ...r.body, kind: r.kind } as PriceRule
}

export default function RulesTab({ data, mode, onSaved }: Props) {
  const all = useMemo<Row[]>(() => data.rules.map((r) => ({ key: r.id, rule: toRule(r), enabled: r.isEnabled, reason: r.disabledReason })), [data.rules])
  const [editing, setEditing] = useState<{ index: number | null; rule: PriceRule | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const { ask, dialog } = useAskDialog()
  const nameOf = (id: string) => data.items.find((i) => i.id === id)?.name ?? null
  const isMine = (r: PriceRule) => (mode === 'discounts') === (r.kind === 'DISCOUNT')
  const shown = all.map((x, index) => ({ ...x, index })).filter((x) => isMine(x.rule))

  const save = async (rows: Row[]) => {
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      const res = await fetch(`/api/crm/pricebook/products/${data.product.id}/rules`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: data.product.version, rules: rows.map((r) => r.rule), enabled: rows.map((r) => r.enabled) }),
      })
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '저장하지 못했습니다.'); return }
      if (body.disabled > 0) setNote(PRICEBOOK.rulesDisabled(body.disabled))
      onSaved()
    } catch {
      setError('저장하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  const replaceAt = (index: number, patch: Partial<Row>) => void save(all.map((x, i) => (i === index ? { ...x, ...patch } : x)))
  const remove = async (index: number) => {
    const target = all[index]
    const ok = await ask.confirm({
      title: PRICEBOOK.ruleDeleteTitle,
      body: describeRule(target.rule, nameOf),
      confirmLabel: ACTION.delete,
      danger: true,
    })
    if (ok) void save(all.filter((_, i) => i !== index))
  }
  const duplicate = (index: number) => void save([...all.slice(0, index + 1), { ...all[index], key: `${all[index].key}-copy` }, ...all.slice(index + 1)])

  /** 끌어 놓은 순서 — 이 탭의 줄만 바뀌고 다른 탭(규칙과 할인)의 줄은 제자리 */
  const reorder = (ids: string[]) => {
    const mine = ids.map((id) => all.find((x) => x.key === id)).filter((x): x is Row => Boolean(x))
    let k = 0
    void save(all.map((x) => (isMine(x.rule) ? mine[k++] : x)))
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.actions}>
        <NbButton onClick={() => setEditing({ index: null, rule: null })} disabled={busy}>
          <Plus size={14} /> {mode === 'discounts' ? `${PRICEBOOK.detailDiscounts} 추가` : `${PRICEBOOK.detailRules} 추가`}
        </NbButton>
      </div>
      <FormErrorBanner message={error} />
      {note && <p className={styles.small} role="status">{note}</p>}
      {shown.length === 0 ? (
        <EmptyState title={mode === 'discounts' ? '할인 규칙이 없어요' : '규칙이 없어요'} description={mode === 'discounts' ? '할인 없이 정상가로 계산해요.' : '규칙이 없으면 선택한 품목만 들어가요.'} />
      ) : (
        <ReorderList
          items={shown}
          getId={(x) => x.key}
          getLabel={(x) => RULE_KIND_LABEL[x.rule.kind] ?? x.rule.kind}
          disabled={busy}
          className={styles.ruleList}
          itemClassName={`${styles.ruleItem}`}
          onReorder={reorder}
        >
          {(x, _i, controls) => {
            const discount = x.rule.kind === 'DISCOUNT' ? x.rule : null
            return (
              <div className={`${styles.ruleRow} ${x.enabled ? '' : styles.ruleOff}`}>
                <div className={styles.boardControls}>{controls}</div>
                <div className={styles.ruleText}>
                  <NbBadge status={x.enabled ? 'doing' : 'note'}>{RULE_KIND_LABEL[x.rule.kind] ?? x.rule.kind}</NbBadge>{' '}
                  {describeRule(x.rule, nameOf)}
                  {!x.enabled && x.reason && <div className={styles.small}>{PRICEBOOK.ruleOffReason(x.reason)}</div>}
                </div>
                <div className={styles.ruleActions}>
                  {discount && !discount.confirmed && (
                    <NbButton variant="ghost" disabled={busy} onClick={() => replaceAt(x.index, { rule: { ...discount, confirmed: true } })}>
                      <BadgeCheck size={14} /> {PRICEBOOK.confirmProposal}
                    </NbButton>
                  )}
                  <NbButton variant="ghost" disabled={busy} aria-pressed={x.enabled} onClick={() => replaceAt(x.index, { enabled: !x.enabled })}>
                    <Power size={14} /> {x.enabled ? PRICEBOOK.ruleTurnOff : PRICEBOOK.ruleTurnOn}
                  </NbButton>
                  <NbButton variant="ghost" disabled={busy} onClick={() => setEditing({ index: x.index, rule: x.rule })}><Pencil size={14} /> {ACTION.edit}</NbButton>
                  <NbButton variant="ghost" disabled={busy} onClick={() => duplicate(x.index)}><Copy size={14} /> {PRICEBOOK.duplicate}</NbButton>
                  <NbButton variant="ghost" disabled={busy} onClick={() => void remove(x.index)} aria-label={ACTION.delete}><Trash2 size={14} /> {ACTION.delete}</NbButton>
                </div>
              </div>
            )
          }}
        </ReorderList>
      )}
      {editing && (
        <RuleAddModal
          items={data.items.filter((i) => i.isActive)}
          discountOnly={mode === 'discounts'}
          initial={editing.rule}
          onClose={() => setEditing(null)}
          onAdd={(rule) => {
            const at = editing.index
            setEditing(null)
            if (at === null) void save([...all, { key: `new-${all.length}`, rule, enabled: true, reason: null }])
            else replaceAt(at, { rule, enabled: true })
          }}
        />
      )}
      {dialog}
    </div>
  )
}
