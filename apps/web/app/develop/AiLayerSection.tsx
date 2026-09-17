'use client'

/**
 * 개발자센터 — AI 공통층
 *
 * **문구를 한 줄도 안 든다.** 목록과 예제는 전부 `lib/api-docs/ai-layer.ts` 에서 온다.
 * 이 화면에 설명을 직접 적으면 그 순간 두 벌이 되고, 코드가 바뀌어도 여기는 안 바뀐다 —
 * `/develop` 이 이미 그렇게 664커밋 동안 없는 기능을 약속했다.
 *
 * 화면이 하는 일은 조판뿐이다.
 */

import NbBadge from '@/components/ui/nb/NbBadge'
import CodeBlock from './CodeBlock'
import {
  AI_INTRO, AI_SETUP, AI_PACKAGES, AI_CONTRACT_FIELDS, AI_CAPABILITY_DOCS, AI_LAYER_CHECKS,
  type AiDocKey,
} from '@/lib/api-docs/ai-layer'

interface Props {
  section: AiDocKey
  onCopy: (text: string, id: string) => void
  copiedId: string | null
}

function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{
      fontSize: 'var(--fs-xl)', fontWeight: 700, color: 'var(--text)',
      marginBottom: 'var(--space-3)', marginTop: 'var(--space-8)', letterSpacing: '-0.01em',
    }}>{children}</h2>
  )
}

/** 개조식 여러 줄 — 마침표 없이 끝난다(문서 문체 규정) */
function Lines({ lines }: { lines: readonly string[] }) {
  return (
    <ul style={{ margin: '0 0 var(--space-5)', paddingLeft: '1.1rem', color: 'var(--text-muted)', fontSize: 'var(--fs-sm)', lineHeight: 1.8 }}>
      {lines.map((l) => <li key={l}>{l}</li>)}
    </ul>
  )
}

function IntroView() {
  return (
    <>
      {AI_INTRO.map((b) => (
        <section key={b.title}>
          <H2>{b.title}</H2>
          <Lines lines={b.lines} />
        </section>
      ))}
    </>
  )
}

function SetupView({ onCopy, copiedId }: Omit<Props, 'section'>) {
  return (
    <>
      <H2>붙이는 순서</H2>
      {AI_SETUP.map((s) => (
        <section key={s.no} style={{ marginBottom: 'var(--space-8)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)', flexWrap: 'wrap' }}>
            <NbBadge>{String(s.no)}</NbBadge>
            <span style={{ fontWeight: 700, color: 'var(--text)', fontSize: 'var(--fs-base)' }}>{s.title}</span>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)', lineHeight: 1.7, margin: '0 0 var(--space-3)' }}>
            {s.why}
          </p>
          {s.code && (
            <CodeBlock id={`ai-setup-${s.no}`} lang={s.code.lang} code={s.code.text} onCopy={onCopy} copiedId={copiedId} />
          )}
        </section>
      ))}

      <H2>확인하는 법</H2>
      {AI_LAYER_CHECKS.map((c) => (
        <div key={c.cmd} style={{ marginBottom: 'var(--space-3)' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)', margin: '0 0 var(--space-1)' }}>{c.what}</p>
          <CodeBlock id={`ai-check-${c.cmd}`} code={c.cmd} onCopy={onCopy} copiedId={copiedId} />
        </div>
      ))}
    </>
  )
}

function PackagesView() {
  return (
    <>
      <H2>패키지 넷</H2>
      {AI_PACKAGES.map((p) => (
        <section key={p.name} className="card" style={{ padding: 'var(--space-4) var(--space-5)', marginBottom: 'var(--space-5)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)', flexWrap: 'wrap' }}>
            <code style={{ fontSize: 'var(--fs-base)', color: 'var(--brand)', fontWeight: 700 }}>{p.name}</code>
            {p.dependsOn.length === 0
              ? <NbBadge status="done">기대는 것 없음</NbBadge>
              : p.dependsOn.map((d) => <NbBadge key={d} status="note">{d}</NbBadge>)}
          </div>
          <p style={{ color: 'var(--text)', fontSize: 'var(--fs-sm)', lineHeight: 1.7, margin: '0 0 var(--space-2)' }}>
            {p.owns}
          </p>
          <p style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-xs)', lineHeight: 1.7, margin: '0 0 var(--space-3)' }}>
            {/* 「—」는 화면 문구에서 금지다(용어집 §0-1), 이 화면이 이미 쓰는 가운뎃점으로 나눈다 */}
            <span style={{ fontWeight: 600 }}>안 갖는 것</span> · {p.refuses}
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            {p.exports.map((e) => (
              <code key={e} style={{
                fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)',
                background: 'var(--surface-muted)', padding: '2px 6px',
              }}>{e}</code>
            ))}
          </div>
        </section>
      ))}
    </>
  )
}

function ContractView() {
  return (
    <>
      <H2>결과 계약</H2>
      <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)', lineHeight: 1.7, margin: '0 0 var(--space-4)' }}>
        AI 가 낸 값 하나는 값만으로 끝나지 않는다, 아래 일곱을 함께 들어야 사람이 검토할 수 있다
      </p>
      <table className="table-base table-card" style={{ marginBottom: 'var(--space-8)' }}>
        <thead><tr><th>자리</th><th>이름</th><th>왜</th></tr></thead>
        <tbody>
          {AI_CONTRACT_FIELDS.map((f) => (
            <tr key={f.key}>
              <td className="card-header"><code style={{ color: 'var(--brand)', fontSize: 'var(--fs-xs)' }}>{f.key}</code></td>
              <td data-label="이름" style={{ color: 'var(--text)', fontSize: 'var(--fs-xs)' }}>{f.label}</td>
              <td data-label="왜" style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>{f.note}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <H2>능력 여덟과 함께 보일 것</H2>
      <table className="table-base table-card">
        <thead><tr><th>능력</th><th>이름</th><th>답과 함께 보일 것</th></tr></thead>
        <tbody>
          {AI_CAPABILITY_DOCS.map((c) => (
            <tr key={c.key}>
              <td className="card-header"><code style={{ color: 'var(--brand)', fontSize: 'var(--fs-xs)' }}>{c.key}</code></td>
              <td data-label="이름" style={{ color: 'var(--text)', fontSize: 'var(--fs-xs)' }}>{c.label}</td>
              <td data-label="답과 함께 보일 것" style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>{c.mustShow}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

export default function AiLayerSection({ section, onCopy, copiedId }: Props) {
  // 항목마다 가지를 이름으로 적는다 — 기본값으로 흘리면 목록에 항목을 더해도
  // 눌렀을 때 소개가 뜨고, 그것은 빈 화면보다 나쁘다(「왜 안 바뀌지」가 된다)
  switch (section) {
    case 'ai-setup': return <SetupView onCopy={onCopy} copiedId={copiedId} />
    case 'ai-packages': return <PackagesView />
    case 'ai-contract': return <ContractView />
    case 'ai-intro': return <IntroView />
  }
}
