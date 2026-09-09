'use client'

import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import AXDotLoader from '@/components/ui/AXDotLoader'

interface Props {
  revision: number
  regrouping: boolean
  onRegroup: (newCommand: string) => void
}

/** 재지시 루프 — "다시 묶기". 원문은 그대로 두고 절단만 재실행한다(리비전 +1). */
export default function RegroupBar({ revision, regrouping, onRegroup }: Props) {
  const [newCommand, setNewCommand] = useState('')

  function submit() {
    if (regrouping) return
    onRegroup(newCommand)
  }

  return (
    <div className="card" style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="tape-title">다시 묶기</span>
        <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-faint)' }}>리비전 {revision}</span>
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <label className="label" htmlFor="regroup-command">
            새 지시
          </label>
          <textarea className="input-field"
            id="regroup-command"
            rows={2}
            value={newCommand}
            onChange={(e) => setNewCommand(e.target.value)}
            placeholder="예: 더 크게 묶어 / 쪼개서 세분화 / 카테고리 단위로"
            style={{ resize: 'vertical', fontFamily: 'inherit', width: '100%' }}
          />
        </div>
        <NbButton
          variant="secondary"
          onClick={submit}
          disabled={regrouping || !newCommand.trim()}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', minHeight: 44, flexShrink: 0 }}
        >
          {regrouping ? <AXDotLoader size={5} color="currentColor" /> : <RefreshCw size={14} />}
          다시 묶기
        </NbButton>
      </div>
    </div>
  )
}
