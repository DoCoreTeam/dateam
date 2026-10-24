'use client'

/**
 * 참고의 CLI 절 위쪽, 설치와 설정과 출력 약속과 종료 코드 (P0164 I03)
 *
 * 문구와 표는 전부 lib/api-docs/cli-doc.ts 에서 온다, 이 파일은 조판만 한다
 * 명령 검색 목록은 그대로 CliSection 이 그린다
 * 표는 모바일에서 카드로 바뀌는 공용 스타일(.table-card)을 쓴다, 가로 스크롤 금지
 */

import CodeBlock from './CodeBlock'
import {
  CLI_DOC, CLI_EXIT_ROWS, CLI_COMMAND_ROWS, CLI_BUILD_SAMPLE, CLI_LOGIN_SAMPLE, CLI_SECRET_REFUSED_SAMPLE,
  CLI_USE_SAMPLE, CLI_ERROR_SAMPLE, cliConfigSample,
} from '@/lib/api-docs/cli-doc'

interface Props {
  origin: string
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

function CommandTable() {
  const h = CLI_DOC.commandHead
  return (
    <div style={{ marginBottom: 'var(--space-5)' }}>
      <table className="table-base table-card">
        <thead><tr><th>{h.cmd}</th><th>{h.desc}</th></tr></thead>
        <tbody>
          {CLI_COMMAND_ROWS.map((r) => (
            <tr key={r.cmd}>
              <td className="card-header"><code style={CODE}>{r.cmd}</code></td>
              <td data-label={h.desc} style={CELL}>{r.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ExitTable() {
  const h = CLI_DOC.exitHead
  return (
    <div style={{ marginBottom: 'var(--space-5)' }}>
      <table className="table-base table-card">
        <thead><tr><th>{h.code}</th><th>{h.name}</th><th>{h.desc}</th></tr></thead>
        <tbody>
          {CLI_EXIT_ROWS.map((r) => (
            <tr key={r.name}>
              <td className="card-header"><code style={CODE}>{r.code}</code></td>
              <td data-label={h.name} style={CELL}><code style={CODE}>{r.name}</code></td>
              <td data-label={h.desc} style={CELL}>{r.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function CliGuideSection({ origin, onCopy, copiedId }: Props) {
  return (
    <section aria-labelledby="cli-guide-title" style={{ marginBottom: 'var(--space-8)' }}>
      <div id="cli-guide-title"><H2>{CLI_DOC.title}</H2></div>
      <P>{CLI_DOC.intro}</P>

      <H3>{CLI_DOC.buildTitle}</H3>
      <P>{CLI_DOC.buildBody}</P>
      <CodeBlock id="cli-build" code={CLI_BUILD_SAMPLE} onCopy={onCopy} copiedId={copiedId} />
      <P>{CLI_DOC.buildTargets}</P>

      <H3>{CLI_DOC.configTitle}</H3>
      <P>{CLI_DOC.configBody}</P>
      <CodeBlock id="cli-config" code={cliConfigSample(origin)} onCopy={onCopy} copiedId={copiedId} />

      <H3>{CLI_DOC.loginTitle}</H3>
      <P>{CLI_DOC.loginBody}</P>
      <CodeBlock id="cli-login" code={CLI_LOGIN_SAMPLE} onCopy={onCopy} copiedId={copiedId} />
      <P>{CLI_DOC.loginRefused}</P>
      <CodeBlock id="cli-secret-refused" lang="json" code={CLI_SECRET_REFUSED_SAMPLE} onCopy={onCopy} copiedId={copiedId} />

      <H3>{CLI_DOC.commandsTitle}</H3>
      <CommandTable />
      <P>{CLI_DOC.useBody}</P>
      <CodeBlock id="cli-use" code={CLI_USE_SAMPLE} onCopy={onCopy} copiedId={copiedId} />

      <H3>{CLI_DOC.outputTitle}</H3>
      <P>{CLI_DOC.outputBody}</P>
      <CodeBlock id="cli-error" lang="json" code={CLI_ERROR_SAMPLE} onCopy={onCopy} copiedId={copiedId} />
      <P>{CLI_DOC.outputFile}</P>
      <P>{CLI_DOC.outputRetry}</P>

      <H3>{CLI_DOC.exitTitle}</H3>
      <P>{CLI_DOC.exitBody}</P>
      <ExitTable />
    </section>
  )
}
