'use client'

/**
 * 시작하기 절의 인증 아래, 키 범위와 만료와 내 키 확인 (P0164 I01)
 *
 * 문구와 표는 전부 lib/api-docs/auth-doc.ts 에서 온다, 이 파일은 조판만 한다
 * 표는 모바일에서 카드로 바뀌는 공용 스타일(.table-card)을 쓴다, 가로 스크롤 금지
 */

import CodeBlock from './CodeBlock'
import {
  AUTH_DOC, AUTH_SCOPE_ROWS, AUTH_EXPIRY_ROWS, AUTH_SCOPE_403_SAMPLE, AUTH_EXPIRED_SAMPLE,
  AUTH_ME_FIELDS, AUTH_ME_SAMPLE,
} from '@/lib/api-docs/auth-doc'

interface Props {
  onCopy: (text: string, id: string) => void
  copiedId: string | null
}

const CELL = { color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' } as const
const CODE = { color: 'var(--brand)', fontSize: 'var(--fs-xs)' } as const

function H3({ children }: { children: React.ReactNode }) {
  return (
    <h3 style={{ fontSize: 'var(--fs-lg)', fontWeight: 700, color: 'var(--text)', margin: 'var(--space-6) 0 var(--space-3)' }}>
      {children}
    </h3>
  )
}

function P({ children }: { children: React.ReactNode }) {
  return <p style={{ color: 'var(--text-muted)', lineHeight: 1.7, fontSize: 'var(--fs-md)', marginBottom: 'var(--space-4)' }}>{children}</p>
}

function ScopeTable() {
  const h = AUTH_DOC.scopeHead
  return (
    <div style={{ marginBottom: 'var(--space-5)' }}>
      <table className="table-base table-card">
        <thead><tr><th>{h.scope}</th><th>{h.label}</th><th>{h.roles}</th><th>{h.missing}</th></tr></thead>
        <tbody>
          {AUTH_SCOPE_ROWS.map((r) => (
            <tr key={r.scope}>
              <td className="card-header"><code style={CODE}>{r.scope}</code></td>
              <td data-label={h.label} style={CELL}>{r.label}</td>
              <td data-label={h.roles} style={CELL}>{r.roles.join(', ')}</td>
              <td data-label={h.missing} style={CELL}>{r.whenMissing}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ExpiryTable() {
  const h = AUTH_DOC.expiryHead
  return (
    <div style={{ marginBottom: 'var(--space-5)' }}>
      <table className="table-base table-card">
        <thead><tr><th>{h.label}</th><th>{h.days}</th><th>{h.note}</th></tr></thead>
        <tbody>
          {AUTH_EXPIRY_ROWS.map((r) => (
            <tr key={r.days}>
              <td className="card-header">{r.label}</td>
              <td data-label={h.days} style={CELL}>{r.days}</td>
              <td data-label={h.note} style={CELL}>{r.isDefault ? AUTH_DOC.expiryDefault : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function MeTable() {
  const h = AUTH_DOC.meHead
  return (
    <div style={{ marginBottom: 'var(--space-5)' }}>
      <table className="table-base table-card">
        <thead><tr><th>{h.name}</th><th>{h.type}</th><th>{h.desc}</th></tr></thead>
        <tbody>
          {AUTH_ME_FIELDS.map((f) => (
            <tr key={f.name}>
              <td className="card-header"><code style={CODE}>{f.name}</code></td>
              <td data-label={h.type} style={CELL}>{f.type}</td>
              <td data-label={h.desc} style={CELL}>{f.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function KeyScopeSection({ onCopy, copiedId }: Props) {
  return (
    <>
      <P>{AUTH_DOC.issue}</P>
      <P>{AUTH_DOC.inheritBody}</P>

      <H3>{AUTH_DOC.scopeTitle}</H3>
      <P>{AUTH_DOC.scopeIntro}</P>
      <ScopeTable />

      <H3>{AUTH_DOC.effectiveTitle}</H3>
      <P>{AUTH_DOC.effectiveBody}</P>
      <P>{AUTH_DOC.missingBody}</P>
      <CodeBlock id="auth-scope-403" lang="json" code={AUTH_SCOPE_403_SAMPLE} onCopy={onCopy} copiedId={copiedId} />

      <H3>{AUTH_DOC.expiryTitle}</H3>
      <P>{AUTH_DOC.expiryIntro}</P>
      <ExpiryTable />
      <P>{AUTH_DOC.expiredBody}</P>
      <CodeBlock id="auth-expired-403" lang="json" code={AUTH_EXPIRED_SAMPLE} onCopy={onCopy} copiedId={copiedId} />

      <H3>{AUTH_DOC.meTitle}</H3>
      <P>{AUTH_DOC.meIntro}</P>
      <MeTable />
      <CodeBlock id="auth-me" lang="json" code={AUTH_ME_SAMPLE} onCopy={onCopy} copiedId={copiedId} />
    </>
  )
}
