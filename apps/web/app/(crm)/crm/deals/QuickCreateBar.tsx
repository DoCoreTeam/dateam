'use client'

// 원터치 생성 입력 (dacrm T1-05, 구현명세 §3.1-1)
//
// 딜 화면 맨 위에 둔다 — 명함을 받고 가장 먼저 여는 화면이 여기이기 때문이다.
// "회사 만들고 → 인물 만들고 → 딜 만들고" 세 번 오가던 것을 한 번으로 줄이는 게 목적이다.
//
// 실패해도 **붙여넣은 글은 지우지 않는다.** 다시 찾아오게 만들면 사용자는 두 번 다시 안 쓴다.

import { useState } from 'react'
import { Sparkles } from 'lucide-react'
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
   * 처음부터 펼쳐 둘까.
   *
   * **왜 필요한가**: 이건 이 제품에서 가장 강한 기능인데(텍스트를 붙여넣으면
   * 회사·인물·딜이 한 번에 생긴다) **접혀 있어서 처음 온 사람은 그게 뭔지 모르고 지나갔다.**
   * 딜이 0건일 때만 펼친다 — 늘 펼쳐 두면 익숙한 사람에게는 자리만 차지한다.
   */
  defaultOpen?: boolean
}

export default function QuickCreateBar({ pipelines, pipelineId, onDone, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen)
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

  if (!open) {
    return (
      <div className={styles.collapsed}>
        <NbButton variant="ghost" onClick={() => setOpen(true)}>
          <Sparkles size={16} /> 붙여넣기로 등록
        </NbButton>
        <span className={styles.hint}>명함·메일 서명을 그대로 붙여넣으면 회사와 담당자를 만들어 둡니다.</span>
      </div>
    )
  }

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
