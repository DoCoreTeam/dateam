'use client'

// components/ci/AssistantPanel.tsx — AI 어시스턴트 (설계서 §6.5)
// 현재 화면을 컨텍스트로 물려받아 Command를 실행한다.
// 되돌리기 어려운 작업(guarded)은 실행하지 않고 어디서 하면 되는지만 알려준다.

import { useEffect, useRef, useState } from 'react'
import { isEnterKey } from '@/lib/ui/ime'
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
  /** 왜 못 했는지. 서버가 사유를 구분해 보낸다(못 알아들음·시간 초과·AI 불가) */
  failure?: 'not_understood' | 'ai_timeout' | 'ai_unavailable' | 'network' | null
}

const EXAMPLES = [
  '이번 주 떡상 보여줘',
  '수집함 보여줘',
  '관심 채널 목록',
  '성공 공식',
]

/**
 * 화면이 기다리는 한계. 서버의 AI 상한(20초)보다 넉넉히 잡는다 —
 * 서버가 스스로 끊고 답을 돌려줄 시간을 뺏으면, 사용자는 서버가 준비한
 * "AI가 늦어 규칙으로만 답했습니다" 대신 네트워크 오류만 보게 된다.
 */
const REQUEST_TIMEOUT_MS = 30_000

export default function AssistantPanel({ workspaceId }: { workspaceId: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [reply, setReply] = useState<Reply | null>(null)
  const asked = useRef('')

  /**
   * 기다리는 동안 초를 센다.
   *
   * 왜 필요한가(실측 2026-08-31): AI 응답이 2초~60초를 오가는데 패널에는
   * **로딩 표시가 한 줄도 없었다.** `busy` 는 버튼만 비활성화했고 화면은
   * 처음 인사말과 추천 칩 그대로였다 — 사용자는 눌린 줄도 모르고 멈춘 줄 알았다.
   */
  useEffect(() => {
    if (!busy) { setElapsed(0); return }
    const t = setInterval(() => setElapsed((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [busy])

  async function send(text?: string) {
    const message = (text ?? value).trim()
    if (!message) return
    asked.current = message
    setBusy(true)
    setReply(null)
    // 화면이 영원히 기다리지 않게 스스로 끊는다. 없으면 연결이 죽어도 «생각하는 중…»이 남는다.
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS)
    try {
      const res = await fetch('/api/ci/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CI-Workspace': workspaceId },
        body: JSON.stringify({ message, route: pathname }),
        signal: ctl.signal,
      }).then((r) => r.json() as Promise<ApiResponse<Reply>>)

      if (!res.success) {
        setReply({
          say: res.error.message, command: null, executed: false,
          suggestion: null, lines: [], href: null, failure: 'network',
        })
        return
      }
      setReply(res.data)
      setValue('')
      if (res.data.executed) router.refresh()
    } catch (e) {
      // 끊긴 이유를 구분한다 — 예전에는 둘 다 «요청을 처리하지 못했습니다» 한 문장이었고,
      // 그 문장이 서버의 오류 봉투와 글자까지 같아 어느 쪽인지 아무도 알 수 없었다.
      const aborted = e instanceof DOMException && e.name === 'AbortError'
      setReply({
        say: aborted
          ? '답이 시간 안에 오지 않아 멈췄습니다.'
          : '연결이 끊겨 보내지 못했습니다.',
        command: null, executed: false, suggestion: null, href: null,
        failure: aborted ? 'ai_timeout' : 'network',
        lines: aborted
          ? [{ label: '아래처럼 물으면 AI 없이 바로 답합니다' }, ...EXAMPLES.map((x) => ({ label: `"${x}"` }))]
          : [{ label: '인터넷 연결을 확인한 뒤 «다시 보내기»를 눌러 주세요' }],
      })
    } finally {
      clearTimeout(timer)
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
        // 좌표를 스스로 정하지 않는다 — Dock의 assistant 슬롯이 위치를 준다.
        // 예전에는 QuickAddFab과 좌표·z가 똑같아 실제로 겹쳐 잘렸다.
        style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}
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
        {busy && (
          <div aria-live="polite" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <p style={{ fontWeight: 600, margin: 0 }}>생각하는 중…</p>
            <p className="ci-basis" style={{ margin: 0 }}>
              {asked.current}
            </p>
            <p className="ci-basis" style={{ margin: 0 }}>
              {elapsed}초 지남 · 최대 {Math.round(REQUEST_TIMEOUT_MS / 1000)}초까지 기다립니다
            </p>
          </div>
        )}

        {!busy && !reply && (
          <>
            <p className="empty-state-desc" style={{ marginBottom: 'var(--space-3)' }}>
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

        {!busy && reply && (
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

            <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)', flexWrap: 'wrap' }}>
              {/* 실패했을 때 같은 문장을 다시 치게 하지 않는다 — 사용자가 잘못한 것이 아니다 */}
              {reply.failure && reply.failure !== 'not_understood' && asked.current && (
                <button type="button" className="ci-metric" onClick={() => send(asked.current)} disabled={busy}>
                  다시 보내기
                </button>
              )}
              <button type="button" className="ci-metric" onClick={() => setReply(null)}>
                다시 묻기
              </button>
            </div>
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
            onKeyDown={(e) => { if (isEnterKey(e)) { e.preventDefault(); send() } }}
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
