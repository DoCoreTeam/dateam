'use client'

// components/ci/AssistantPanel.tsx — AI 어시스턴트 (설계서 §6.5)
// 현재 화면을 컨텍스트로 물려받아 Command를 실행한다.
// 되돌리기 어려운 작업(guarded)은 실행하지 않고 어디서 하면 되는지만 알려준다.

import { useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { Sparkles, X, CornerDownLeft } from 'lucide-react'
import type { ApiResponse } from '@/lib/ci/contracts'

interface Line { label: string; detail?: string; href?: string }
interface Reply {
  say: string
  command: string | null
  executed: boolean
  suggestion: string | null
  lines: Line[]
  href: string | null
}

const EXAMPLES = [
  '이번 주 떡상 보여줘',
  '수집함 보여줘',
  '관심 채널 목록',
  '성공 공식',
]

export default function AssistantPanel({ workspaceId }: { workspaceId: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [reply, setReply] = useState<Reply | null>(null)

  async function send(text?: string) {
    const message = (text ?? value).trim()
    if (!message) return
    setBusy(true)
    try {
      const res = await fetch('/api/ci/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CI-Workspace': workspaceId },
        body: JSON.stringify({ message, route: pathname }),
      }).then((r) => r.json() as Promise<ApiResponse<Reply>>)

      if (!res.success) {
        setReply({
          say: res.error.message, command: null, executed: false,
          suggestion: null, lines: [], href: null,
        })
        return
      }
      setReply(res.data)
      setValue('')
      if (res.data.executed) router.refresh()
    } catch {
      setReply({
        say: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요',
        command: null, executed: false, suggestion: null, lines: [], href: null,
      })
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="btn-primary"
        onClick={() => setOpen(true)}
        aria-label="AI 어시스턴트 열기"
        style={{
          position: 'fixed', right: 'var(--space-4)', bottom: 'var(--space-4)',
          zIndex: 'var(--z-sticky, 100)', display: 'inline-flex', alignItems: 'center',
          gap: 'var(--space-2)',
        }}
      >
        <Sparkles size={16} />어시스턴트
      </button>
    )
  }

  return (
    <aside
      aria-label="AI 어시스턴트"
      style={{
        position: 'fixed', right: 0, top: 0, bottom: 0, width: 'min(380px, 100%)',
        background: 'var(--color-surface)', borderLeft: 'var(--border-w) solid var(--border-color)',
        boxShadow: 'var(--shadow-modal)', zIndex: 'var(--z-modal)',
        display: 'flex', flexDirection: 'column',
      }}
    >
      <header className="ci-sheet-head">
        <h2 className="tape-title" style={{ margin: 0 }}>어시스턴트</h2>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)} aria-label="닫기">
          <X size={18} />
        </button>
      </header>

      <div className="ci-sheet-body">
        {!reply && (
          <>
            <p className="ci-empty-desc" style={{ marginBottom: 'var(--space-3)' }}>
              무엇을 도와드릴까요. 링크를 붙여넣거나 아래처럼 물어보세요.
            </p>
            <div className="ci-card-badges">
              {EXAMPLES.map((e) => (
                <button key={e} type="button" className="ci-metric" onClick={() => send(e)} disabled={busy}>
                  {e}
                </button>
              ))}
            </div>
          </>
        )}

        {reply && (
          <>
            <p style={{ fontWeight: 600, marginBottom: 'var(--space-2)' }}>{reply.say}</p>

            {reply.suggestion && (
              <p className="ci-status ci-status-warn" style={{ display: 'inline-flex', marginBottom: 'var(--space-3)' }}>
                {reply.suggestion}
              </p>
            )}

            {reply.lines.length > 0 && (
              <ul style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {reply.lines.map((l, i) => (
                  <li key={i} style={{
                    padding: 'var(--space-2)', border: 'var(--border-w-2) solid var(--border-color)',
                    borderRadius: 'var(--radius)',
                  }}>
                    <span style={{ fontSize: 'var(--fs-sm)' }}>{l.label}</span>
                    {l.detail && <p className="ci-basis">{l.detail}</p>}
                  </li>
                ))}
              </ul>
            )}

            {reply.href && (
              <p style={{ marginTop: 'var(--space-3)' }}>
                <Link href={reply.href} className="btn-primary" onClick={() => setOpen(false)}>
                  화면에서 보기
                </Link>
              </p>
            )}

            <button type="button" className="ci-metric" style={{ marginTop: 'var(--space-3)' }}
              onClick={() => setReply(null)}>
              다시 묻기
            </button>
          </>
        )}
      </div>

      <div style={{ padding: 'var(--space-3)', borderTop: 'var(--border-w-2) solid var(--border-color)' }}>
        <label className="label" htmlFor="ci-assistant-input" style={{ position: 'absolute', left: '-9999px' }}>
          어시스턴트에게 묻기
        </label>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <input className="input-field" id="ci-assistant-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); send() } }}
            placeholder="무엇이든 물어보세요"
            disabled={busy}
            style={{ flex: 1 }}
          />
          <button type="button" className="btn-primary" onClick={() => send()} disabled={busy || !value.trim()}>
            <CornerDownLeft size={16} />
          </button>
        </div>
      </div>
    </aside>
  )
}
