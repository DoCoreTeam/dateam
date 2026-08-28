'use client'

// 원터치 생성 입력 (dacrm T1-05, 구현명세 §3.1-1)
//
// 딜 화면 맨 위에 둔다 — 명함을 받고 가장 먼저 여는 화면이 여기이기 때문이다.
// "회사 만들고 → 인물 만들고 → 딜 만들고" 세 번 오가던 것을 한 번으로 줄이는 게 목적이다.
//
// 실패해도 **붙여넣은 글은 지우지 않는다.** 다시 찾아오게 만들면 사용자는 두 번 다시 안 쓴다.

import { useState } from 'react'
import NbButton from '@/components/ui/nb/NbButton'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import GapFillModal, { type QuickCreateResult } from './GapFillModal'
import type { BoardPipeline } from './DealBoard'
import styles from './quick-create.module.css'

interface Props {
  pipelines: BoardPipeline[]
  pipelineId: string
  onDone: () => void
  /**
   * 펼쳐졌나 — **부모가 쥔다.**
   *
   * 트리거 버튼이 부모의 도구 줄에 있으므로 상태도 부모에 있어야 한다.
   * (예전엔 이 부품이 자기 트리거와 상태를 함께 들고 화면 위쪽 한 줄을 통째로 썼다)
   */
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function QuickCreateBar({ pipelines, pipelineId, onDone, open, onOpenChange }: Props) {
  const setOpen = onOpenChange
  const [text, setText] = useState('')
  const [withDeal, setWithDeal] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<QuickCreateResult | null>(null)

  const pipeline = pipelines.find((p) => p.id === pipelineId)
  const firstOpenStage = pipeline?.stages.find((s) => s.kind === 'OPEN')

  async function submit() {
    if (!text.trim()) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/crm/quick-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          createDeal: withDeal,
          pipelineId: withDeal ? pipelineId : null,
          stageId: withDeal ? firstOpenStage?.id ?? null : null,
        }),
      })
      const body = await res.json()
      if (!res.ok) {
        // 원문은 그대로 둔다 — 다시 시도 버튼이 곧 이 상태다
        setError(body?.error?.message ?? '등록하지 못했습니다.')
        return
      }
      setResult(body)
      onDone()
    } catch {
      setError('등록하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  /*
    접혀 있을 때는 **아무것도 그리지 않는다.**
    예전엔 여기서 트리거 버튼과 설명 한 줄을 그렸는데, 위에 이미 탭 두 줄이 있어
    도구만 네 줄을 먹었다(사용자 지적: 「쓸데없는 공간 너무 많고」).
    트리거는 부모의 도구 한 줄에 들어간다 — 이 부품은 **펼쳐졌을 때의 입력**만 맡는다.
  */
  if (!open) return null

  return (
    <div className={`card ${styles.wrap}`}>
      <FormErrorBanner message={error} />

      <label className="label" htmlFor="crm-quick-text">붙여넣기</label>
      <textarea
        id="crm-quick-text" className="input-field" rows={5} value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'예)\n㈜데이터얼라이언스\n김도현 팀장\nkim@data-alliance.com / 02-1234-5678'}
        autoFocus
      />

      <div className={styles.actions}>
        <label className="label" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontWeight: 400 }}>
          <input type="checkbox" checked={withDeal} onChange={(e) => setWithDeal(e.target.checked)} />
          <span>딜도 함께 만들기{firstOpenStage ? ` (${pipeline?.name} · ${firstOpenStage.name})` : ''}</span>
        </label>
        <div className={styles.buttons}>
          <NbButton variant="ghost" onClick={() => { setOpen(false); setError(null) }} disabled={busy}>닫기</NbButton>
          <NbButton onClick={() => void submit()} disabled={busy || !text.trim()}>
            {busy ? '읽는 중…' : '등록'}
          </NbButton>
        </div>
      </div>

      {result && (
        <GapFillModal
          result={result}
          pipelines={pipelines}
          onClose={() => { setResult(null); setText(''); setOpen(false); onDone() }}
          onFilled={onDone}
        />
      )}
    </div>
  )
}
