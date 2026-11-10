'use client'

// 모듈 골라 조립 — 공통 조항 위에 고른 모듈을 얹어 본문을 새로 만든다 (P0184 I12)
//
// **들어갈 것은 서버가 센다.** 고를 때마다 같은 창구를 dryRun 으로 불러 조건이 맞아 저절로
// 들어가는 모듈과 승인본이 없는 조항을 받는다. 화면이 따로 판정하면 미리 본 것과 저장된 것이 갈린다.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Blocks } from 'lucide-react'
import NbModal from '@/components/ui/nb/NbModal'
import NbButton from '@/components/ui/nb/NbButton'
import AXDotLoader from '@/components/ui/AXDotLoader'
import ErrorState from '@/components/ui/ErrorState'
import { clauseIdOf } from '@/lib/crm/domain/contract-assemble'
import { withSubmitGuard } from '@/lib/forms/submit-guard'
import { crmSettingsHref } from '@/lib/crm/domain/settings-tab'
import { progress, ACTION } from '@/lib/terms'
import { CONTRACT_ASSEMBLY, CONTRACT_MODULE_KIND } from '@/lib/terms/contract-doc'
import {
  contractApi, type AssemblyJson, type ContractJson, type ContractModuleJson, type ContractVersionJson, type Outcome, type SaveResult,
} from './contract-api'
import styles from './contract-modal.module.css'

interface Props {
  contract: ContractJson
  current: ContractVersionJson
  onClose: () => void
  onSaved: (r: SaveResult) => void
  onFailed: (o: Extract<Outcome<unknown>, { ok: false }>) => void
}

type Load = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ok'; items: ContractModuleJson[] }

/** 지금 본문에 조항이 다 들어 있는 모듈은 고른 것으로 연다 — 고른 기록을 따로 두지 않고 본문에서 읽는다 */
function chosenFromBody(items: readonly ContractModuleJson[], current: ContractVersionJson): string[] {
  const ids = new Set(current.body.map((c) => c.id))
  return items
    .filter((m) => m.kind !== 'COMMON' && m.clauseKeys.length > 0 && m.clauseKeys.every((k) => ids.has(clauseIdOf(k))))
    .map((m) => m.key)
}

export default function ContractModulePicker({ contract, current, onClose, onSaved, onFailed }: Props) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [chosen, setChosen] = useState<string[]>([])
  const [plan, setPlan] = useState<AssemblyJson | null>(null)
  const [checking, setChecking] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const out = await contractApi.modules(CONTRACT_ASSEMBLY.failed)
      if (!out.ok) { setLoad({ kind: 'error', message: out.message }); return }
      const items = out.body.items.filter((m) => m.isActive)
      setLoad({ kind: 'ok', items })
      setChosen(chosenFromBody(items, current))
    })()
  }, [current])

  const chosenKey = chosen.join(',')
  useEffect(() => {
    if (load.kind !== 'ok') return
    let alive = true
    setChecking(true)
    void (async () => {
      try {
        const out = await contractApi.assemble(contract.id, CONTRACT_ASSEMBLY.failed, { version: contract.version, moduleKeys: chosen, dryRun: true })
        if (!alive) return
        if (out.ok) { setPlan(out.body); setError(null) } else { setPlan(null); setError(out.message) }
      } finally {
        if (alive) setChecking(false)
      }
    })()
    return () => { alive = false }
    // chosenKey 가 chosen 을 대신한다 — 배열은 매번 새 값이라 그대로 넣으면 끝없이 다시 부른다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosenKey, load.kind, contract.id, contract.version])

  const items = load.kind === 'ok' ? load.items : []
  const common = useMemo(() => items.filter((m) => m.kind === 'COMMON'), [items])
  const pickable = useMemo(() => items.filter((m) => m.kind !== 'COMMON'), [items])
  const automatic = new Set(plan?.automatic ?? [])
  const blocked = !plan || plan.missing.length > 0 || plan.clauseCount === 0
  // 조건이 정하는 모듈은 고른 목록에서 빼고 보낸다 — 고른 것과 저절로 든 것을 섞어 두면 조건이 바뀌어도 남는다
  const picked = chosen.filter((k) => !automatic.has(k))

  const toggle = (key: string) =>
    setChosen((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]))

  async function assemble() {
    if (saving || blocked) return
    setSaving(true)
    await withSubmitGuard(async () => {
      const out = await contractApi.assemble(contract.id, CONTRACT_ASSEMBLY.failed, { version: contract.version, moduleKeys: picked })
      if (out.ok && out.body.saved) { onSaved(out.body.saved); return }
      if (!out.ok && out.code === 'CONFLICT') { onFailed(out); return }
      setError(out.ok ? CONTRACT_ASSEMBLY.failed : out.message)
    }, { onError: setError, onDone: () => setSaving(false) })
  }

  return (
    <NbModal
      title={CONTRACT_ASSEMBLY.title}
      onClose={onClose}
      maxWidth={640}
      disableClose={saving}
      footer={(
        <div className={styles.foot}>
          {error && <span className={styles.tagBad} role="alert">{error}</span>}
          <NbButton variant="ghost" disabled={saving} onClick={onClose}>{ACTION.cancel}</NbButton>
          <NbButton disabled={saving || checking || blocked} onClick={() => void assemble()}>
            <Blocks size={16} aria-hidden /> {saving ? progress(CONTRACT_ASSEMBLY.assemble) : CONTRACT_ASSEMBLY.assemble}
          </NbButton>
        </div>
      )}
    >
      <div className={styles.body}>
        <p className={styles.hint}>{CONTRACT_ASSEMBLY.intro}</p>
        {load.kind === 'loading' && <AXDotLoader />}
        {load.kind === 'error' && <ErrorState message={load.message} />}
        {load.kind === 'ok' && items.length === 0 && (
          <p className={styles.hint}>
            {CONTRACT_ASSEMBLY.noModules} <Link href={crmSettingsHref('contract')}>{CONTRACT_ASSEMBLY.goModules}</Link>
          </p>
        )}
        {common.length > 0 && (
          <section className={styles.section} aria-labelledby="assembly-common">
            <h3 id="assembly-common" className={styles.sectionTitle}>{CONTRACT_ASSEMBLY.common}</h3>
            <ul className={styles.signedList}>
              {common.map((m) => <li key={m.key} className={styles.signedItem}>{m.title}</li>)}
            </ul>
          </section>
        )}
        {pickable.length > 0 && (
          <ul className={styles.signedList}>
            {pickable.map((m) => (
              <li key={m.key} className={styles.signedItem}>
                <label className={styles.pick}>
                  <input type="checkbox" checked={chosen.includes(m.key) || automatic.has(m.key)}
                    disabled={saving || automatic.has(m.key)} onChange={() => toggle(m.key)} />
                  <span className={styles.signedName}>{m.title}</span>
                </label>
                <span className={styles.src}>{CONTRACT_MODULE_KIND[m.kind]}</span>
                {automatic.has(m.key) && <span className={styles.tagWarn}>{CONTRACT_ASSEMBLY.automatic}</span>}
              </li>
            ))}
          </ul>
        )}
        {checking && <p className={styles.hint} role="status">{CONTRACT_ASSEMBLY.checking}</p>}
        {!checking && plan && plan.missing.length > 0 && (
          <p className={styles.tagBad} role="alert">{CONTRACT_ASSEMBLY.missing(plan.missing.join(', '))}</p>
        )}
        {!checking && plan && plan.missing.length === 0 && plan.clauseCount > 0 && (
          <p className={styles.hint}>{CONTRACT_ASSEMBLY.willInclude(plan.clauseCount)}</p>
        )}
        {!checking && plan && plan.missing.length === 0 && plan.drafts.length > 0 && (
          <p className={styles.tagWarn} role="note">{CONTRACT_ASSEMBLY.drafts(plan.drafts.length)}</p>
        )}
      </div>
    </NbModal>
  )
}
