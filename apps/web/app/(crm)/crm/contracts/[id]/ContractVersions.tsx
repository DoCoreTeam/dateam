'use client'

// 버전 기록과 두 버전 비교 (P0132 I12a)
//
// 버전은 지워지지 않는다 — 고치면 다음 번호가 생길 뿐이다. 그래서 이 칸은 읽기만 한다.
// 비교는 서버(compare 창구)가 한다. 화면이 두 본문을 받아 따로 비교하면
// 버전 비교와 AI 제안 검증이 서로 다른 「같음」을 쓰게 된다.

import { useCallback, useEffect, useState } from 'react'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import AXDotLoader from '@/components/ui/AXDotLoader'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'
import { RecordPanel } from '@/components/ui/crm/RecordLayout'
import { formatKstDateTimeExact } from '@/lib/datetime/kst'
import { failedTo, progress } from '@/lib/terms'
import {
  CONTRACT_FIELD_LABEL, CONTRACT_SCREEN, CONTRACT_VERSION_KIND, DOC, versionLabel,
} from '@/lib/terms/contract-doc'
import { contractApi, type ContractCompareJson, type ContractJson, type ContractVersionItem } from './contract-api'
import styles from './contract-view.module.css'

interface Props {
  contractId: string
  contract: Pick<ContractJson, 'currentVersionNo' | 'sentVersionNo' | 'status'>
  reloadKey: number
  canPreview: boolean
  onPreview: (versionNo: number) => void
}

type Load = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ok'; items: ContractVersionItem[] }

export default function ContractVersions({ contractId, contract, reloadKey, canPreview, onPreview }: Props) {
  const [state, setState] = useState<Load>({ kind: 'loading' })
  const [a, setA] = useState<number | null>(null)
  const [b, setB] = useState<number | null>(null)
  const [diff, setDiff] = useState<ContractCompareJson | null>(null)
  const [comparing, setComparing] = useState(false)
  const [compareError, setCompareError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setState({ kind: 'loading' })
    const out = await contractApi.versions(contractId, failedTo(DOC.versionHistory, '불러오지'))
    if (!out.ok) { setState({ kind: 'error', message: out.message }); return }
    const items = [...out.body.items].sort((x, y) => y.versionNo - x.versionNo)
    setState({ kind: 'ok', items })
    // 기본은 바로 앞 버전과 지금 버전 — 「방금 무엇이 바뀌었나」가 가장 흔한 질문이다
    setB(items[0]?.versionNo ?? null)
    setA(items[1]?.versionNo ?? null)
    setDiff(null)
  }, [contractId])

  useEffect(() => { void load() }, [load, reloadKey])

  async function compare() {
    if (a === null || b === null || comparing) return
    setComparing(true)
    setCompareError(null)
    const out = await contractApi.compare(contractId, failedTo(DOC.compareVersions, '하지'), Math.min(a, b), Math.max(a, b))
    setComparing(false)
    if (!out.ok) { setCompareError(out.message); return }
    setDiff(out.body)
  }

  const tags = (n: number): string[] => ([
    n === contract.currentVersionNo ? CONTRACT_SCREEN.versionCurrent : null,
    n === contract.sentVersionNo ? CONTRACT_SCREEN.versionSent : null,
    contract.status === 'CONCLUDED' && n === contract.currentVersionNo ? CONTRACT_SCREEN.versionConcluded : null,
  ] as (string | null)[]).filter((t): t is string => t !== null)

  return (
    <RecordPanel title={DOC.versionHistory}>
      {state.kind === 'loading' && <AXDotLoader />}
      {state.kind === 'error' && <ErrorState message={state.message} onRetry={() => void load()} />}
      {state.kind === 'ok' && state.items.length === 0 && <EmptyState title={CONTRACT_SCREEN.versionsEmpty} />}
      {state.kind === 'ok' && state.items.length > 0 && (
        <>
          <ol className={styles.versions}>
            {state.items.map((v) => (
              <li key={v.versionNo} className={styles.version}>
                <div className={styles.versionHead}>
                  <span className={styles.versionNo}>{versionLabel(v.versionNo)}</span>
                  <time className={styles.versionMeta} dateTime={v.createdAt}>{formatKstDateTimeExact(v.createdAt)}</time>
                </div>
                <span className={styles.versionMeta}>
                  {CONTRACT_VERSION_KIND[v.kind] ?? v.kind}{v.note ? ` · ${v.note}` : ''}
                </span>
                {tags(v.versionNo).length > 0 && (
                  <span className={styles.tags}>
                    {tags(v.versionNo).map((t) => <NbBadge key={t} status="note">{t}</NbBadge>)}
                  </span>
                )}
                {canPreview && (
                  <div>
                    <NbButton variant="ghost" onClick={() => onPreview(v.versionNo)}>{CONTRACT_SCREEN.viewVersion}</NbButton>
                  </div>
                )}
              </li>
            ))}
          </ol>

          {state.items.length < 2 ? (
            <p className={styles.note}>{CONTRACT_SCREEN.compareNeedsTwo}</p>
          ) : (
            <div className={styles.compareBar}>
              <label>
                {CONTRACT_SCREEN.compareA}
                <select className="input-field" value={a ?? ''} onChange={(e) => setA(Number(e.target.value))}>
                  {state.items.map((v) => <option key={v.versionNo} value={v.versionNo}>{versionLabel(v.versionNo)}</option>)}
                </select>
              </label>
              <label>
                {CONTRACT_SCREEN.compareB}
                <select className="input-field" value={b ?? ''} onChange={(e) => setB(Number(e.target.value))}>
                  {state.items.map((v) => <option key={v.versionNo} value={v.versionNo}>{versionLabel(v.versionNo)}</option>)}
                </select>
              </label>
              <NbButton variant="ghost" disabled={comparing || a === b} onClick={() => void compare()}>
                {comparing ? progress(CONTRACT_SCREEN.compareRun) : CONTRACT_SCREEN.compareRun}
              </NbButton>
            </div>
          )}
          {compareError && <p className={styles.danger} role="alert">{compareError}</p>}
          {diff && <CompareResult diff={diff} />}
        </>
      )}
    </RecordPanel>
  )
}

function CompareResult({ diff }: { diff: ContractCompareJson }) {
  if (diff.clauses.length === 0 && diff.fields.length === 0) {
    return <p className={styles.note} role="status">{CONTRACT_SCREEN.compareSame}</p>
  }
  return (
    <div role="status">
      {diff.clauses.length > 0 && (
        <>
          <h3 className={styles.refillTitle}>{CONTRACT_SCREEN.compareClauses}</h3>
          <ul className={styles.diffs}>
            {diff.clauses.map((d) => (
              <li key={`${d.id}-${d.kind}`} className={styles.diff}>
                <strong>{(d.after ?? d.before)?.title ?? d.id}</strong> · {CONTRACT_SCREEN.diffKind[d.kind]}
                {d.segments.length > 0 && (
                  <div>
                    {d.segments.map((s, i) => (
                      <span key={i} className={s.type === 'del' ? styles.del : s.type === 'ins' ? styles.ins : undefined}>{s.text}</span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {diff.fields.length > 0 && (
        <>
          <h3 className={styles.refillTitle}>{CONTRACT_SCREEN.compareFields}</h3>
          <ul className={styles.diffs}>
            {diff.fields.map((f) => (
              <li key={f.key} className={styles.diff}>
                {CONTRACT_FIELD_LABEL[f.key] ?? f.key}: <span className={styles.del}>{f.before}</span> → <span className={styles.ins}>{f.after}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
