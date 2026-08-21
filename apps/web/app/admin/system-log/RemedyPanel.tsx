'use client'

// app/admin/system-log/RemedyPanel.tsx — "이걸 어떻게 고치나"
//
// **누를 때만 부른다.** 화면을 열 때 자동으로 부르면 로그 100줄이 곧 AI 100회가 되고,
// 관측 도구가 한도를 태우는 자기모순이 된다.
//
// 한도·키·설정·DB 사유는 서버가 **미리 써 둔 답**(플레이북)을 돌려준다 — AI 를 부르지 않는다.
// 그 사유들이야말로 AI 가 죽어 있을 때 가장 필요한 답이기 때문이다.

import { useState } from 'react'
import { Sparkles, BookOpen, AlertTriangle } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import AXDotLoader from '@/components/ui/AXDotLoader'
import InlineError from '@/components/ui/InlineError'
import { playbookFor } from '@/lib/system-log/playbook'

interface Remedy {
  diagnosis: string
  confidence: 'high' | 'low' | 'unknown'
  checks: string[]
  actions: { what: string; risk: 'safe' | 'careful'; reversible: boolean }[]
  files?: string[]
  isPlaybook: boolean
}

export default function RemedyPanel({ fingerprint, reason }: { fingerprint: string; reason: string }) {
  const [remedy, setRemedy] = useState<Remedy | null>(null)
  const [model, setModel] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 우리가 답을 아는 사유인가 — 버튼 글자가 달라진다(AI 를 부르는 척하지 않는다)
  const hasPlaybook = playbookFor(reason) !== null

  const ask = async () => {
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/admin/system-log/remedy', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fingerprint }),
      })
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '해결 방법을 가져오지 못했습니다.'); return }
      setRemedy(body.remedy as Remedy)
      setModel(body.model ?? null)
    } catch {
      setError('해결 방법을 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  if (!remedy) {
    return (
      <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
        <div>
          <NbButton onClick={() => void ask()} disabled={busy}>
            {busy ? <AXDotLoader /> : hasPlaybook ? <BookOpen size={14} /> : <Sparkles size={14} />}
            {busy ? '가져오는 중…' : '해결 방법 보기'}
          </NbButton>
          <span style={{ marginLeft: 'var(--space-2)', fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
            {hasPlaybook
              ? '이 원인은 미리 정리해 둔 답이 있어 AI를 쓰지 않습니다.'
              : '누를 때만 AI가 한 번 만듭니다. 같은 오류에는 다시 부르지 않아요.'}
          </span>
        </div>
        {error && <InlineError compact>{error}</InlineError>}
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
      <div>
        <p style={{ margin: 0, fontWeight: 600, color: 'var(--text)' }}>{remedy.diagnosis}</p>
        <p style={{ margin: 'var(--space-1) 0 0', fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
          {remedy.isPlaybook
            ? '미리 정리해 둔 답입니다 (AI 미사용)'
            : `AI가 만든 추정입니다${model ? ` · ${model}` : ''}`}
          {remedy.confidence !== 'high' && ' · 확신이 낮으니 원문을 함께 확인해 주세요'}
        </p>
      </div>

      {remedy.checks.length > 0 && (
        <div>
          <p style={{ margin: '0 0 var(--space-1)', fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text)' }}>
            먼저 확인할 것
          </p>
          <ul style={{ margin: 0, paddingLeft: 'var(--space-5)', display: 'grid', gap: 'var(--space-1)' }}>
            {remedy.checks.map((c, i) => (
              <li key={i} style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      {remedy.actions.length > 0 && (
        <div>
          <p style={{ margin: '0 0 var(--space-1)', fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text)' }}>
            할 수 있는 조치
          </p>
          <ul style={{ margin: 0, paddingLeft: 'var(--space-5)', display: 'grid', gap: 'var(--space-1)' }}>
            {remedy.actions.map((a, i) => (
              <li key={i} style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
                {a.what}
                {/* 되돌릴 수 없는 조치는 반드시 표시한다 — 읽고 바로 실행하는 사람이 있다 */}
                {!a.reversible && (
                  <span style={{ marginLeft: 'var(--space-2)', color: 'var(--danger)', fontSize: 'var(--fs-xs)' }}>
                    <AlertTriangle size={11} style={{ verticalAlign: '-1px' }} /> 되돌릴 수 없음
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p style={{ margin: 'var(--space-2) 0 0', fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
            조치는 자동으로 실행되지 않습니다. 읽고 직접 판단해 주세요.
          </p>
        </div>
      )}

      {remedy.files && remedy.files.length > 0 && (
        <p style={{ margin: 0, fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
          관련: {remedy.files.join(' · ')}
        </p>
      )}
    </div>
  )
}
