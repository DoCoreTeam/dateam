'use client'

/**
 * 참고의 에이전트용 안내 절 (P0168)
 *
 * 문구와 값은 전부 lib/api-docs/agent-doc.ts 에서 온다, 이 파일은 조판만 한다
 */

import CodeBlock from './CodeBlock'
import { AGENT_DOC, AGENT_CLI_HELP, agentSpecCurl } from '@/lib/api-docs/agent-doc'

interface Props {
  origin: string
  onCopy: (text: string, id: string) => void
  copiedId: string | null
}

const TEXT = { color: 'var(--text-muted)', lineHeight: 1.7, fontSize: 'var(--fs-md)', marginBottom: 'var(--space-4)' } as const

function H3({ children }: { children: React.ReactNode }) {
  return (
    <h3 style={{ fontSize: 'var(--fs-lg)', fontWeight: 700, color: 'var(--text)', margin: 'var(--space-6) 0 var(--space-3)' }}>
      {children}
    </h3>
  )
}

export default function AgentGuideSection({ origin, onCopy, copiedId }: Props) {
  return (
    <div>
      <h2 style={{ fontSize: 'var(--fs-xl)', fontWeight: 700, color: 'var(--text)', margin: '0 0 var(--space-3)', letterSpacing: '-0.01em' }}>
        {AGENT_DOC.title}
      </h2>
      <p style={TEXT}>{AGENT_DOC.intro}</p>

      <H3>{AGENT_DOC.specTitle}</H3>
      <p style={TEXT}>{AGENT_DOC.specBody}</p>
      <CodeBlock code={agentSpecCurl(origin)} id="agent-spec" onCopy={onCopy} copiedId={copiedId} />

      <H3>{AGENT_DOC.approvalTitle}</H3>
      <p style={TEXT}>{AGENT_DOC.approvalBody}</p>
      <ol style={{ ...TEXT, paddingLeft: 'var(--space-5)', display: 'grid', gap: 'var(--space-2)' }}>
        {AGENT_DOC.approvalSteps.map((step) => <li key={step}>{step}</li>)}
      </ol>

      <H3>{AGENT_DOC.cliTitle}</H3>
      <p style={TEXT}>{AGENT_DOC.cliBody}</p>
      <CodeBlock code={AGENT_CLI_HELP} id="agent-cli-help" onCopy={onCopy} copiedId={copiedId} />

      <H3>{AGENT_DOC.pollTitle}</H3>
      <p style={TEXT}>{AGENT_DOC.webhookBody}</p>
      <p style={TEXT}>{AGENT_DOC.pollBody}</p>
    </div>
  )
}
