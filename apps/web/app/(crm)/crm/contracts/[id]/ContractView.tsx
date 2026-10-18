'use client'

// 계약서 화면 — 보고, 고치고, 보내고, 체결한다 (P0132 I12a)
//
// **견적서 화면과 같은 뼈대다.** 머리줄(DocHeader)·도구줄·문서·변경 이력이 같은 자리에 있다.
// 같은 종류의 문서가 화면마다 다른 자리에 단추를 두면 사람은 다른 기능이라고 읽는다.
//
// **할 수 있는 동작은 상태가 정한다.** 단추마다 문자열을 비교하지 않고 contract-status.ts 의
// 규칙을 읽는다 — 서버가 거절하는 규칙과 화면이 그리는 규칙이 한 벌이어야 「눌렀더니 안 된다」가 없다.
// 체결과 해지 단추를 관리자에게만 그리는 것은 화면의 일일 뿐이고, 거절은 서버가 한다.

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { FileText, Lock, Pencil, RefreshCw, Send, Sparkles, Stamp, Ban, FilePlus2, XCircle } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import AXDotLoader from '@/components/ui/AXDotLoader'
import ErrorState from '@/components/ui/ErrorState'
import EmptyState from '@/components/ui/EmptyState'
import PageHeader from '@/components/ui/PageHeader'
import DocHeader from '@/components/ui/crm/doc/DocHeader'
import DocHistoryPanel from '@/components/ui/crm/doc/DocHistoryPanel'
import { useAskDialog } from '@/components/ui/useAskDialog'
import { backTarget } from '@/lib/crm/nav/back-link'
import { kstDateKey } from '@/lib/datetime/kst'
import type { StatusKey } from '@/lib/tokens/status-colors'
import { canAmend, canSend, canTransition, canWriteVersion, type ContractStatus } from '@/lib/crm/domain/contract-status'
import { ENTITY, failedTo, progress } from '@/lib/terms'
import {
  CONTRACT_DOC, CONTRACT_FIELD_LABEL, CONTRACT_MSG, CONTRACT_REFILL, CONTRACT_SCREEN, CONTRACT_STATUS_LABEL, DOC_HEADER,
} from '@/lib/terms/contract-doc'
import { contractApi, type ContractDetail, type Outcome } from './contract-api'
import ContractPaperFrame, { screenPaperHtml } from './ContractPaperFrame'
import ContractVersions from './ContractVersions'
import ContractPreview from './ContractPreview'
import ContractEditModal from './ContractEditModal'
import ContractAiEditModal from './ContractAiEditModal'
import ContractConcludeModal from './ContractConcludeModal'
import styles from './contract-view.module.css'

/** 화면이 그릴 수 있는 동작 — 서버 역할 판정을 페이지가 미리 읽어 넘긴다 */
export interface ContractAbilities {
  conclude: boolean
  terminate: boolean
  /** 파일로 빼기 — 미리보기도 내보내기 창구를 지나므로 같은 판정이다 */
  exportFiles: boolean
}

const STATUS_TONE: Record<string, StatusKey> = {
  DRAFT: 'note', CONCLUDED: 'done', TERMINATED: 'blocker', CANCELLED: 'blocker',
}

type Load =
  | { kind: 'loading' }
  | { kind: 'ok' }
  | { kind: 'denied' }
  | { kind: 'missing'; message: string }
  | { kind: 'error'; message: string }

type Notice = { tone: 'ok' | 'error'; text: string } | null
type ModalKind = 'edit' | 'ai' | 'conclude' | null

export default function ContractView({ contractId, abilities }: { contractId: string; abilities: ContractAbilities }) {
  const params = useSearchParams()
  const router = useRouter()
  const [detail, setDetail] = useState<ContractDetail | null>(null)
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  /** 지금 도는 동작 — 같은 단추를 두 번 눌러 버전이 둘 생기는 일을 막는다 */
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice>(null)
  /** 무엇을 하면 버전 기록과 변경 이력이 다시 읽는다 — 방금 한 일이 거기 없으면 안 된 줄 안다 */
  const [seq, setSeq] = useState(0)
  const [modal, setModal] = useState<ModalKind>(null)
  /** 미리보기로 연 버전 번호 */
  const [preview, setPreview] = useState<number | null>(null)
  const { ask, dialog } = useAskDialog()

  const loadFail = failedTo(CONTRACT_DOC.entity, '불러오지')

  const reload = useCallback(async () => {
    const out = await contractApi.get(contractId, loadFail)
    if (!out.ok) {
      // 권한 없음, 없음, 고장은 할 일이 다르다 — 한 문장으로 뭉치지 않는다
      if (out.status === 403) setLoad({ kind: 'denied' })
      else if (out.status === 404) setLoad({ kind: 'missing', message: out.message })
      else setLoad({ kind: 'error', message: out.message })
      return
    }
    setDetail(out.body)
    setLoad({ kind: 'ok' })
    setSeq((n) => n + 1)
  }, [contractId, loadFail])

  useEffect(() => { void reload() }, [reload])

  /**
   * 실패를 화면에 말한다. **버전이 어긋났으면 최신을 다시 읽는다** — 남이 먼저 고친 것을
   * 옛 화면 위에서 다시 누르면 또 어긋난다. 무엇이 바뀌었는지 보고 다시 하게 한다.
   */
  const failed = useCallback((out: Extract<Outcome<unknown>, { ok: false }>) => {
    if (out.code === 'CONFLICT') {
      setNotice({ tone: 'error', text: CONTRACT_SCREEN.conflictReloaded })
      void reload()
      return
    }
    setNotice({ tone: 'error', text: out.message })
  }, [reload])

  const done = useCallback((text: string) => {
    setNotice({ tone: 'ok', text })
    setModal(null)
    void reload()
  }, [reload])

  const run = useCallback(async <T,>(key: string, call: () => Promise<Outcome<T>>): Promise<T | null> => {
    if (busy) return null
    setBusy(key)
    setNotice(null)
    try {
      const out = await call()
      if (!out.ok) { failed(out); return null }
      return out.body
    } finally {
      setBusy(null)
    }
  }, [busy, failed])

  if (load.kind === 'loading' && !detail) return <div className="page-inner"><AXDotLoader /></div>

  const fallbackBack = { href: detail ? `/crm/deals/${detail.contract.dealId}` : '/crm/deals', label: ENTITY.deal.label }
  const back = backTarget(params, fallbackBack)

  if (load.kind === 'denied') {
    return (
      <div className="page-inner">
        <PageHeader title={CONTRACT_DOC.entity} back={back} />
        <EmptyState icon={<Lock size={24} aria-hidden />} title={CONTRACT_SCREEN.denied} />
      </div>
    )
  }
  if (load.kind === 'missing') {
    return (
      <div className="page-inner">
        <PageHeader title={CONTRACT_DOC.entity} back={back} />
        <EmptyState title={load.message} action={{ label: back.label, href: back.href }} />
      </div>
    )
  }
  if (load.kind === 'error' && !detail) {
    return <div className="page-inner"><ErrorState message={load.message} onRetry={() => void reload()} /></div>
  }
  if (!detail) return null

  const { contract, current, rendered, quoteChange } = detail
  const status = contract.status as ContractStatus
  const writable = canWriteVersion(status)
  const mayConclude = canTransition(status, 'CONCLUDED')
  const mayTerminate = canTransition(status, 'TERMINATED')
  const mayCancel = canTransition(status, 'CANCELLED')
  const fail = (verb: string) => failedTo(CONTRACT_DOC.entity, verb)

  async function send() {
    const yes = await ask.confirm({
      title: CONTRACT_SCREEN.sendTitle(contract.contractNo),
      body: CONTRACT_SCREEN.sendBody(contract.currentVersionNo),
      confirmLabel: CONTRACT_SCREEN.send,
    })
    if (!yes) return
    const out = await run('send', () => contractApi.act(contract.id, fail('보냄으로 표시하지'), { action: 'send', version: contract.version }))
    if (out) done(DOC_HEADER.sentVersion(kstDateKey(new Date().toISOString()), contract.currentVersionNo))
  }

  async function close(action: 'terminate' | 'cancel') {
    const t = action === 'terminate'
    const yes = await ask.confirm({
      title: t ? CONTRACT_SCREEN.terminateTitle(contract.contractNo) : CONTRACT_SCREEN.cancelTitle(contract.contractNo),
      body: t ? CONTRACT_SCREEN.terminateBody : CONTRACT_SCREEN.cancelBody,
      confirmLabel: t ? CONTRACT_SCREEN.terminate : CONTRACT_SCREEN.cancel,
      danger: true,
    })
    if (!yes) return
    const label = t ? CONTRACT_SCREEN.terminate : CONTRACT_SCREEN.cancel
    const out = await run(action, () => contractApi.act(contract.id, fail(`${label}하지`), { action, version: contract.version }))
    if (out) done(CONTRACT_STATUS_LABEL[out.status] ?? label)
  }

  async function amend() {
    const yes = await ask.confirm({
      title: CONTRACT_SCREEN.amendTitle(contract.contractNo),
      body: CONTRACT_SCREEN.amendBody,
      confirmLabel: CONTRACT_SCREEN.amend,
    })
    if (!yes) return
    const out = await run('amend', () => contractApi.amend(contract.id, failedTo(CONTRACT_SCREEN.amend.replace(/ 만들기$/, ''), '만들지')))
    // 새 계약서로 간다. 돌아갈 곳은 그대로 싣는다 — 딜에서 왔으면 딜로 돌아간다
    if (out) router.push(`/crm/contracts/${out.contract.id}${params.toString() ? `?${params}` : ''}`)
  }

  async function refill() {
    const out = await run('refill', () => contractApi.refill(contract.id, fail('다시 채우지'), contract.version))
    if (!out) return
    done(out.created ? CONTRACT_SCREEN.refillDone(out.versionNo) : CONTRACT_SCREEN.refillNone)
  }

  const label = (key: string) => CONTRACT_FIELD_LABEL[key] ?? key

  return (
    <div className="page-inner">
      <DocHeader
        title={contract.title}
        back={back}
        status={{ label: CONTRACT_STATUS_LABEL[status] ?? status, tone: STATUS_TONE[status] ?? 'note' }}
        sent={{ date: contract.sentAt ? kstDateKey(contract.sentAt) : null, versionNo: contract.sentVersionNo }}
        extra={<span className={styles.headNo}>{contract.contractNo} · {DOC_HEADER.current(contract.currentVersionNo)}</span>}
      />

      {/*
        도구줄 순서는 견적서와 같다 — 고치기가 앞, 미리보기가 맨 끝의 칠한 단추.
        상태를 바꾸는 단추는 칠하지 않는다: 미리보기로 확인하는 것이 먼저다.
      */}
      <div className={styles.toolbar}>
        {writable && (
          <>
            <NbButton variant="ghost" disabled={!!busy} onClick={() => setModal('edit')}>
              <Pencil size={16} aria-hidden /> {CONTRACT_DOC.edit}
            </NbButton>
            <NbButton variant="ghost" disabled={!!busy} onClick={() => setModal('ai')}>
              <Sparkles size={16} aria-hidden /> {CONTRACT_DOC.aiEdit}
            </NbButton>
          </>
        )}
        {canSend(status) && (
          <NbButton variant="ghost" disabled={!!busy} onClick={() => void send()}>
            <Send size={16} aria-hidden /> {busy === 'send' ? progress(CONTRACT_SCREEN.send) : CONTRACT_SCREEN.send}
          </NbButton>
        )}
        {mayConclude && abilities.conclude && (
          <NbButton variant="ghost" disabled={!!busy} onClick={() => setModal('conclude')}>
            <Stamp size={16} aria-hidden /> {CONTRACT_SCREEN.conclude}
          </NbButton>
        )}
        {mayCancel && (
          <NbButton variant="ghost" disabled={!!busy} onClick={() => void close('cancel')}>
            <XCircle size={16} aria-hidden /> {busy === 'cancel' ? progress(CONTRACT_SCREEN.cancel) : CONTRACT_SCREEN.cancel}
          </NbButton>
        )}
        {mayTerminate && abilities.terminate && (
          <NbButton variant="ghost" disabled={!!busy} onClick={() => void close('terminate')}>
            <Ban size={16} aria-hidden /> {busy === 'terminate' ? progress(CONTRACT_SCREEN.terminate) : CONTRACT_SCREEN.terminate}
          </NbButton>
        )}
        {canAmend(status) && (
          <NbButton variant="ghost" disabled={!!busy} onClick={() => void amend()}>
            <FilePlus2 size={16} aria-hidden /> {busy === 'amend' ? progress(CONTRACT_SCREEN.amend) : CONTRACT_SCREEN.amend}
          </NbButton>
        )}
        {abilities.exportFiles && (
          <NbButton onClick={() => setPreview(contract.currentVersionNo)}>
            <FileText size={16} aria-hidden /> {CONTRACT_SCREEN.preview}
          </NbButton>
        )}
      </div>

      {notice && (
        <p className={notice.tone === 'ok' ? styles.ok : styles.danger} role={notice.tone === 'ok' ? 'status' : 'alert'}>
          {notice.text}
        </p>
      )}
      {load.kind === 'error' && <ErrorState message={load.message} onRetry={() => void reload()} />}

      {/* 못 하는 것은 그 이유를 말한다 — 단추가 없기만 하면 「어디 있지」가 된다 */}
      {status === 'CONCLUDED' && <p className={styles.note}>{CONTRACT_MSG.notWritable}</p>}
      {((mayConclude && !abilities.conclude) || (mayTerminate && !abilities.terminate)) && (
        <p className={styles.note}>{CONTRACT_SCREEN.adminOnlyHint}</p>
      )}
      {contract.parentContractId && (
        <p className={styles.note}>
          <Link href={`/crm/contracts/${contract.parentContractId}`} className={styles.link}>{CONTRACT_SCREEN.parent}</Link>
        </p>
      )}

      {writable && quoteChange.state === 'changed' && (
        <section className={styles.refill} aria-labelledby="contract-refill-title">
          <h2 id="contract-refill-title" className={styles.refillTitle}>{CONTRACT_SCREEN.refillTitle}</h2>
          <p className={styles.refillBody}>
            {CONTRACT_SCREEN.refillBody(quoteChange.sourceQuoteVersion ?? 1, quoteChange.quoteVersion ?? 1)}
          </p>
          {quoteChange.changed.length > 0 && (
            <ul className={styles.fieldChips}>
              {quoteChange.changed.map((k) => <li key={k} className={styles.chip}>{label(k)}</li>)}
            </ul>
          )}
          {quoteChange.kept.length > 0 && (
            <p className={styles.refillBody}>
              {CONTRACT_SCREEN.refillKept}: {quoteChange.kept.map(label).join(', ')}
            </p>
          )}
          <div>
            <NbButton variant="ghost" disabled={!!busy} onClick={() => void refill()}>
              <RefreshCw size={16} aria-hidden /> {busy === 'refill' ? progress(CONTRACT_SCREEN.refill) : CONTRACT_SCREEN.refill}
            </NbButton>
          </div>
        </section>
      )}
      {writable && quoteChange.state === 'gone' && <p className={styles.note}>{CONTRACT_REFILL.quoteGone}</p>}

      <div className={styles.layout}>
        <section className={styles.main} aria-label={CONTRACT_SCREEN.paperTitle(contract.contractNo, current.versionNo)}>
          {rendered.length === 0 ? (
            <EmptyState
              title={CONTRACT_SCREEN.noClauses}
              description={writable ? CONTRACT_SCREEN.noClausesNext : undefined}
            />
          ) : (
            <ContractPaperFrame
              title={CONTRACT_SCREEN.paperTitle(contract.contractNo, current.versionNo)}
              html={screenPaperHtml(contract.title, contract.contractNo, rendered)}
            />
          )}
        </section>
        <aside className={styles.side}>
          <ContractVersions
            contractId={contract.id}
            contract={contract}
            reloadKey={seq}
            canPreview={abilities.exportFiles}
            onPreview={setPreview}
          />
          <DocHistoryPanel targetType="contract" targetId={contract.id} reloadKey={seq} />
        </aside>
      </div>

      {preview !== null && (
        <ContractPreview
          contractId={contract.id}
          contractNo={contract.contractNo}
          versionNo={preview}
          onClose={() => setPreview(null)}
        />
      )}

      {modal === 'edit' && (
        <ContractEditModal
          contract={contract}
          current={current}
          onClose={() => setModal(null)}
          onSaved={(r) => done(r.created ? CONTRACT_SCREEN.saved(r.versionNo) : CONTRACT_SCREEN.noChange)}
          onFailed={(o) => { setModal(null); failed(o) }}
        />
      )}
      {modal === 'ai' && (
        <ContractAiEditModal
          contract={contract}
          onClose={() => setModal(null)}
          onSaved={(r) => done(r.created ? CONTRACT_SCREEN.saved(r.versionNo) : CONTRACT_SCREEN.noChange)}
          onFailed={(o) => { setModal(null); failed(o) }}
        />
      )}
      {modal === 'conclude' && (
        <ContractConcludeModal
          contract={contract}
          onClose={() => setModal(null)}
          onDone={(row) => done(CONTRACT_STATUS_LABEL[row.status] ?? CONTRACT_SCREEN.conclude)}
          onFailed={(o) => { setModal(null); failed(o) }}
        />
      )}
      {dialog}
    </div>
  )
}
