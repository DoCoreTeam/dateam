'use client'

/**
 * 오류 코드 절의 게이트웨이 응답과 CRM 오류 코드 (P0164 I05)
 *
 * 문구와 줄은 전부 lib/api-docs/errors-doc.ts 에서 온다, 이 파일은 조판만 한다
 * CRM 줄은 lib/crm/domain/errors.ts 의 코드 목록에서 만들어지므로 코드가 늘면 여기 저절로 생긴다
 * 표는 모바일에서 카드로 바뀌는 공용 스타일(.table-card)을 쓴다, 가로 스크롤 금지
 */

import CodeBlock from './CodeBlock'
import styles from './develop.module.css'
import { ERRORS_DOC, GATEWAY_ERROR_ROWS, CRM_ERROR_ROWS, CRM_ERROR_SAMPLE } from '@/lib/api-docs/errors-doc'

interface Props {
  onCopy: (text: string, id: string) => void
  copiedId: string | null
}

const CELL = { color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' } as const
const CODE = { color: 'var(--brand)', fontSize: 'var(--fs-xs)', overflowWrap: 'anywhere' } as const

function H2({ children }: { children: React.ReactNode }) {
  return <h2 style={{ fontSize: 'var(--fs-xl)', fontWeight: 700, color: 'var(--text)', margin: 'var(--space-6) 0 var(--space-3)', letterSpacing: '-0.01em' }}>{children}</h2>
}

function H3({ children }: { children: React.ReactNode }) {
  return <h3 style={{ fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--text)', margin: 'var(--space-4) 0 var(--space-2)' }}>{children}</h3>
}

function P({ children }: { children: React.ReactNode }) {
  return <p style={{ color: 'var(--text-muted)', lineHeight: 1.7, fontSize: 'var(--fs-md)', marginBottom: 'var(--space-4)' }}>{children}</p>
}

function GatewayErrors({ onCopy, copiedId }: Props) {
  const h = ERRORS_DOC.gatewayHead
  return (
    <section>
      <H2>{ERRORS_DOC.gatewayTitle}</H2>
      <P>{ERRORS_DOC.gatewayBody}</P>
      <div style={{ marginBottom: 'var(--space-5)' }}>
        <table className="table-base table-card">
          <thead><tr><th>{h.status}</th><th>{h.mark}</th><th>{h.when}</th><th>{h.fix}</th></tr></thead>
          <tbody>
            {GATEWAY_ERROR_ROWS.map((r) => (
              <tr key={r.id}>
                <td className="card-header"><code style={{ color: 'var(--brand)' }}>{r.status}</code></td>
                <td data-label={h.mark} style={CELL}><code className={styles.nowrap} style={CODE}>{r.mark}</code></td>
                <td data-label={h.when} style={CELL}>{r.when}</td>
                <td data-label={h.fix} style={CELL}>{r.fix}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {GATEWAY_ERROR_ROWS.map((r) => (
        <div key={r.id}>
          <H3>{r.status} {r.mark}</H3>
          <CodeBlock id={`errors-${r.id}`} lang="json" code={r.sample} onCopy={onCopy} copiedId={copiedId} />
        </div>
      ))}
    </section>
  )
}

function CrmErrors({ onCopy, copiedId }: Props) {
  const h = ERRORS_DOC.crmHead
  return (
    <section>
      <H2>{ERRORS_DOC.crmTitle}</H2>
      <P>{ERRORS_DOC.crmBody}</P>
      <CodeBlock id="errors-crm" lang="json" code={CRM_ERROR_SAMPLE} onCopy={onCopy} copiedId={copiedId} />
      <div style={{ margin: 'var(--space-4) 0 var(--space-5)' }}>
        <table className="table-base table-card">
          <thead><tr><th>{h.code}</th><th>{h.status}</th><th>{h.meaning}</th></tr></thead>
          <tbody>
            {CRM_ERROR_ROWS.map((r) => (
              <tr key={r.code}>
                <td className="card-header"><code className={styles.nowrap} style={CODE}>{r.code}</code></td>
                <td data-label={h.status} style={CELL}>{r.status}</td>
                <td data-label={h.meaning} style={CELL}>{r.meaning}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default function ErrorCodeTable({ onCopy, copiedId }: Props) {
  return (
    <>
      <GatewayErrors onCopy={onCopy} copiedId={copiedId} />
      <CrmErrors onCopy={onCopy} copiedId={copiedId} />
    </>
  )
}
