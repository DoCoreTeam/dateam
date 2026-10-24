'use client'

/**
 * 참고의 게이트웨이와 승인 요청 절 (P0164 I02)
 *
 * 문구와 표는 전부 lib/api-docs/gateway-doc.ts 에서 온다, 이 파일은 조판만 한다
 * 표는 모바일에서 카드로 바뀌는 공용 스타일(.table-card)을 쓴다, 가로 스크롤 금지
 */

import CodeBlock from './CodeBlock'
import {
  GATEWAY_DOC, GATEWAY_PREFIX, GATEWAY_EXAMPLES, GATEWAY_KIND_LABEL, GATEWAY_ACTION_BODY_SAMPLE, GATEWAY_STEPS,
  APPROVAL_202_SAMPLE, HUMAN_ONLY_SAMPLE, APPROVAL_STATUS_ROWS, DRY_RUN_SAMPLE, GATEWAY_HEADERS, GATEWAY_DIRECTION,
} from '@/lib/api-docs/gateway-doc'

interface Props {
  onCopy: (text: string, id: string) => void
  copiedId: string | null
}

const CELL = { color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' } as const
const CODE = { color: 'var(--brand)', fontSize: 'var(--fs-xs)', overflowWrap: 'anywhere' } as const

function H2({ children }: { children: React.ReactNode }) {
  return <h2 style={{ fontSize: 'var(--fs-xl)', fontWeight: 700, color: 'var(--text)', margin: '0 0 var(--space-3)', letterSpacing: '-0.01em' }}>{children}</h2>
}

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

function ExampleTable() {
  const h = GATEWAY_DOC.exampleHead
  return (
    <div style={{ marginBottom: 'var(--space-5)' }}>
      <table className="table-base table-card">
        <thead><tr><th>{h.kind}</th><th>{h.method}</th><th>{h.path}</th><th>{h.scope}</th><th>{h.cli}</th></tr></thead>
        <tbody>
          {GATEWAY_EXAMPLES.map((e) => (
            <tr key={e.name}>
              <td className="card-header">{GATEWAY_KIND_LABEL[e.kind]}</td>
              <td data-label={h.method} style={CELL}>{e.method}</td>
              <td data-label={h.path} style={CELL}>
                <code style={CODE}>{GATEWAY_PREFIX}{e.mount}</code>
                <div>{e.note}</div>
              </td>
              <td data-label={h.scope} style={CELL}><code style={CODE}>{e.scope}</code></td>
              <td data-label={h.cli} style={CELL}><code style={CODE}>teamda {e.cli}</code></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function StatusTable() {
  const h = GATEWAY_DOC.statusHead
  return (
    <div style={{ marginBottom: 'var(--space-5)' }}>
      <table className="table-base table-card">
        <thead><tr><th>{h.status}</th><th>{h.label}</th><th>{h.desc}</th></tr></thead>
        <tbody>
          {APPROVAL_STATUS_ROWS.map((r) => (
            <tr key={r.status}>
              <td className="card-header"><code style={CODE}>{r.status}</code></td>
              <td data-label={h.label} style={CELL}>{r.label}</td>
              <td data-label={h.desc} style={CELL}>{r.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function HeaderTable() {
  const h = GATEWAY_DOC.headerHead
  return (
    <div style={{ marginBottom: 'var(--space-5)' }}>
      <table className="table-base table-card">
        <thead><tr><th>{h.name}</th><th>{h.direction}</th><th>{h.desc}</th></tr></thead>
        <tbody>
          {GATEWAY_HEADERS.map((r) => (
            <tr key={r.name}>
              <td className="card-header"><code style={CODE}>{r.name}</code></td>
              <td data-label={h.direction} style={CELL}>{GATEWAY_DIRECTION[r.direction]}</td>
              <td data-label={h.desc} style={CELL}>{r.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function GatewaySection({ onCopy, copiedId }: Props) {
  return (
    <section aria-labelledby="gateway-title">
      <div id="gateway-title"><H2>{GATEWAY_DOC.title}</H2></div>
      <P>{GATEWAY_DOC.intro}</P>

      <H3>{GATEWAY_DOC.pathTitle}</H3>
      <P>{GATEWAY_DOC.pathBody}</P>
      <ExampleTable />
      <P>{GATEWAY_DOC.actionBody}</P>
      <CodeBlock id="gateway-action" lang="http" code={GATEWAY_ACTION_BODY_SAMPLE} onCopy={onCopy} copiedId={copiedId} />
      <P>{GATEWAY_DOC.catalogue}</P>

      <H3>{GATEWAY_DOC.stepsTitle}</H3>
      <ol style={{ color: 'var(--text-muted)', lineHeight: 1.7, fontSize: 'var(--fs-md)', paddingLeft: 'var(--space-5)', marginBottom: 'var(--space-4)' }}>
        {GATEWAY_STEPS.map((s) => <li key={s}>{s}</li>)}
      </ol>

      <H3>{GATEWAY_DOC.approvalTitle}</H3>
      <P>{GATEWAY_DOC.approvalBody}</P>
      <CodeBlock id="gateway-approval-202" lang="json" code={APPROVAL_202_SAMPLE} onCopy={onCopy} copiedId={copiedId} />
      <P>{GATEWAY_DOC.approvalDecide}</P>
      <StatusTable />
      <P>{GATEWAY_DOC.approvalExpiry}</P>
      <P>{GATEWAY_DOC.approvalHumanOnly}</P>
      <CodeBlock id="gateway-human-only" lang="json" code={HUMAN_ONLY_SAMPLE} onCopy={onCopy} copiedId={copiedId} />

      <H3>{GATEWAY_DOC.idemTitle}</H3>
      <P>{GATEWAY_DOC.idemBody}</P>
      <P>{GATEWAY_DOC.idemScope}</P>

      <H3>{GATEWAY_DOC.dryTitle}</H3>
      <P>{GATEWAY_DOC.dryBody}</P>
      <CodeBlock id="gateway-dry-run" lang="json" code={DRY_RUN_SAMPLE} onCopy={onCopy} copiedId={copiedId} />

      <H3>{GATEWAY_DOC.limitTitle}</H3>
      <P>{GATEWAY_DOC.limitBody}</P>

      <H3>{GATEWAY_DOC.headerTitle}</H3>
      <HeaderTable />

      <H3>{GATEWAY_DOC.auditTitle}</H3>
      <P>{GATEWAY_DOC.auditBody}</P>
      <P>{GATEWAY_DOC.auditWhere}</P>
    </section>
  )
}
