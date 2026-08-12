'use client'

// 연동 카드 UI 시스템 (SSOT)
//
// 왜 있나: 같은 "외부 연동" 카드인데 카드마다 제각각이었다 —
//  · 용어: 삭제 / 연결 해제 · 헬스체크 / 연결 테스트 · 저장 / 테마 적용
//  · 버튼: 어떤 건 파란 큰 버튼, 어떤 건 텍스트 버튼, 어떤 건 작은 아웃라인
//  · 기능: 삭제가 있는 카드/없는 카드, 연결 테스트가 있는 카드/없는 카드
//    (Claude·OpenAI는 서버액션이 있는데 UI가 부르지 않아 "없는 기능"처럼 보였다)
//
// 새 연동을 붙일 때 이 파일의 부품만 쓰면 위 셋이 저절로 맞는다.
// 라벨은 LABEL 상수만 쓴다 — 화면에 문자열을 직접 적으면 또 갈라진다.

import type { ReactNode } from 'react'
import { CheckCircle, XCircle, Unplug, RefreshCw } from 'lucide-react'
import AXDotLoader from '@/components/ui/AXDotLoader'

/** 연동 카드에서 쓰는 모든 사용자 문구. 여기 없는 표현을 새로 만들지 않는다. */
export const LABEL = {
  connected: '연결됨',
  notConnected: '연결 안 됨',
  change: '변경',
  disconnect: '연결 해제',
  test: '연결 테스트',
  testRun: '테스트',
  save: '저장',
  saving: '저장 중…',
} as const

/* ── 카드 골격 ──────────────────────────────────────────────── */

interface CardProps {
  icon: ReactNode
  title: string
  /** 무엇에 쓰이는지 한 줄. 없으면 사용자가 이 연동을 왜 켜야 하는지 모른다 */
  desc?: ReactNode
  children: ReactNode
}

export function IntegrationCard({ icon, title, desc, children }: CardProps) {
  return (
    <div className="card integration-card">
      <div className="integration-card-head">
        <span className="integration-card-icon">{icon}</span>
        <h2 className="tape-title" style={{ margin: 0 }}>{title}</h2>
      </div>
      {desc && <p className="integration-card-desc">{desc}</p>}
      <div className="integration-card-body">{children}</div>
    </div>
  )
}

/* ── 연결 상태 ──────────────────────────────────────────────── */

interface StatusProps {
  /** 연결된 것을 식별하는 값(마스킹된 키·계정 이메일). null이면 미연결 */
  value: string | null
  /** 미연결일 때 무엇이 제한되는지. 정직하게 알린다 */
  emptyHint?: string
  onChange: () => void
  /** 해제를 지원하면 넘긴다. 서버액션이 있는데 안 넘기면 기능이 사라진 것처럼 보인다 */
  onDisconnect?: () => void
  disconnectPending?: boolean
  /** 상태 조회 중 */
  loading?: boolean
  /** 미연결일 때 누르는 버튼(OAuth 연결 등). 없으면 폼이 대신한다 */
  connectAction?: { label: string; onClick: () => void }
}

export function IntegrationStatus({
  value, emptyHint, onChange, onDisconnect, disconnectPending, loading, connectAction,
}: StatusProps) {
  if (loading) {
    return (
      <p className="integration-status integration-status-loading">
        <AXDotLoader size={4} color="var(--text-faint)" /> 연결 상태 확인 중…
      </p>
    )
  }

  if (!value) {
    return (
      <div className="integration-status integration-status-empty">
        <p className="integration-status-empty-text">
          <XCircle size={14} />
          <span>{LABEL.notConnected}{emptyHint ? ` — ${emptyHint}` : ''}</span>
        </p>
        {connectAction && (
          <button type="button" className="btn-primary" onClick={connectAction.onClick}>
            {connectAction.label}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="integration-status integration-status-set">
      <div className="integration-status-head">
        <span className="integration-status-label">
          <CheckCircle size={14} />
          {LABEL.connected}
        </span>
        <span className="integration-status-actions">
          <button type="button" className="integration-status-btn" onClick={onChange}>
            {LABEL.change}
          </button>
          {onDisconnect && (
            <button
              type="button"
              className="integration-status-btn is-danger"
              onClick={onDisconnect}
              disabled={disconnectPending}
            >
              {disconnectPending ? <AXDotLoader size={4} color="var(--danger)" /> : <Unplug size={12} />}
              {LABEL.disconnect}
            </button>
          )}
        </span>
      </div>
      <code className="integration-status-value">{value}</code>
    </div>
  )
}

/* ── 연결 테스트 ────────────────────────────────────────────── */

interface TestProps {
  onRun: () => void
  pending?: boolean
  result?: { ok: boolean; text: string } | null
  /** 무엇을 확인하는지 */
  desc?: string
}

export function IntegrationTest({ onRun, pending, result, desc }: TestProps) {
  return (
    <div className="integration-test">
      <div className="integration-test-head">
        <span className="integration-test-title">{LABEL.test}</span>
        <button type="button" className="btn-ghost" onClick={onRun} disabled={pending}>
          {pending ? <AXDotLoader size={4} color="var(--brand)" /> : <RefreshCw size={13} />}
          {LABEL.testRun}
        </button>
      </div>
      {desc && !result && <p className="integration-test-desc">{desc}</p>}
      {result && (
        <p className={`ci-status ${result.ok ? 'ci-status-ok' : 'ci-status-danger'}`} role="status">
          {result.text}
        </p>
      )}
    </div>
  )
}
