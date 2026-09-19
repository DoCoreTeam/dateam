'use client'

/**
 * 개발자센터 AI 공통층 절
 *
 * **한글 문구를 한 줄도 안 든다.** 제목, 설명, 표 머리, 작은 딱지까지 전부
 * `lib/api-docs/ai-layer.ts` 에서 온다. 화면이 문구를 직접 적으면 그 순간 두 벌이 되고,
 * 코드가 바뀌어도 여기는 안 바뀐다. `/develop` 이 이미 그렇게 664커밋 동안
 * 없는 기능을 약속했다.
 *
 * 제목은 화면 나머지 절과 같은 `PageHeader` 를 쓴다. 이 절만 제목 없이 본문부터
 * 시작해서, 같은 페이지 안에서 다른 화면처럼 보였다.
 *
 * 화면이 하는 일은 조판뿐이다.
 */

import PageHeader from '@/components/ui/PageHeader'
import NbBadge from '@/components/ui/nb/NbBadge'
import CodeBlock from './CodeBlock'
import {
  AI_DOC_NAV, AI_DOC_UI, AI_LAYER_NAV_LABEL,
  AI_INTRO, AI_SETUP, AI_PACKAGES, AI_CONTRACT_FIELDS, AI_CAPABILITY_DOCS, AI_LAYER_CHECKS,
  AI_PROVIDERS, AI_CHAIN_LIMITS, AI_CHAIN_ORDER, AI_FAILURE_RULES, AI_POLICY_NOTES, AI_POLICY_CODE,
  AI_API, AI_ERRORS,
  AI_CONTRACT_TYPE, AI_STATUS_ROWS, AI_STATUS_LABEL, AI_CONTRACT_CODE,
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

/** 제목과 한 줄 설명 — 왼쪽 목록에 있는 항목만큼 정확히 있다(가드가 센다) */
function Head({ section }: { section: AiDocKey }) {
  const nav = AI_DOC_NAV.find((n) => n.key === section)
  if (!nav) return null
  return <PageHeader eyebrow={AI_LAYER_NAV_LABEL} title={nav.title} description={nav.description} />
}

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

      <H2>{AI_DOC_UI.checksTitle}</H2>
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
  const U = AI_DOC_UI
  return (
    <>
      {AI_PACKAGES.map((p) => {
        const api = AI_API.filter((a) => a.pkg === p.name)
        const named = new Set(api.map((a) => a.name))
        const also = p.exports.filter((e) => !named.has(e))
        return (
          <section key={p.name} className="card" style={{ padding: 'var(--space-4) var(--space-5)', marginBottom: 'var(--space-5)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)', flexWrap: 'wrap' }}>
              <code style={{ fontSize: 'var(--fs-base)', color: 'var(--brand)', fontWeight: 700 }}>{p.name}</code>
              {p.dependsOn.length === 0
                ? <NbBadge status="done">{U.dependsOnNone}</NbBadge>
                : p.dependsOn.map((d) => <NbBadge key={d} status="note">{d}</NbBadge>)}
            </div>
            <p style={{ color: 'var(--text)', fontSize: 'var(--fs-sm)', lineHeight: 1.7, margin: '0 0 var(--space-2)' }}>
              {p.owns}
            </p>
            <p style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-xs)', lineHeight: 1.7, margin: '0 0 var(--space-4)' }}>
              {/* 「—」는 화면 문구에서 금지다(용어집 §0-1), 이 화면이 이미 쓰는 가운뎃점으로 나눈다 */}
              <span style={{ fontWeight: 600 }}>{U.refusesLabel}</span> · {p.refuses}
            </p>

            {api.length > 0 && (
              <table className="table-base table-card" style={{ marginBottom: also.length > 0 ? 'var(--space-4)' : 0 }}>
                <thead><tr>
                  <th>{U.apiHead.name}</th>
                  <th>{U.apiHead.signature}</th>
                  <th>{U.apiHead.returns}</th>
                  <th>{U.apiHead.note}</th>
                </tr></thead>
                <tbody>
                  {api.map((a) => (
                    <tr key={a.name}>
                      <td className="card-header"><code style={{ color: 'var(--brand)', fontSize: 'var(--fs-xs)' }}>{a.name}</code></td>
                      <td data-label={U.apiHead.signature}>
                        <code style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{a.signature}</code>
                      </td>
                      <td data-label={U.apiHead.returns}>
                        <code style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{a.returns}</code>
                      </td>
                      <td data-label={U.apiHead.note} style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>{a.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {also.length > 0 && (
              <div>
                <div style={{ fontWeight: 600, color: 'var(--text-faint)', fontSize: 'var(--fs-xs)', marginBottom: 'var(--space-2)' }}>{U.alsoExportsLabel}</div>
                <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                  {also.map((e) => (
                    <code key={e} style={{
                      fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)',
                      background: 'var(--surface-muted)', padding: '2px 6px',
                    }}>{e}</code>
                  ))}
                </div>
              </div>
            )}
          </section>
        )
      })}

      <H2>{U.errorsTitle}</H2>
      <table className="table-base table-card">
        <thead><tr>
          <th>{U.errorHead.name}</th>
          <th>{U.errorHead.when}</th>
          <th>{U.errorHead.fix}</th>
        </tr></thead>
        <tbody>
          {AI_ERRORS.map((e) => (
            <tr key={e.name}>
              <td className="card-header"><code style={{ color: 'var(--brand)', fontSize: 'var(--fs-xs)' }}>{e.name}</code></td>
              <td data-label={U.errorHead.when} style={{ color: 'var(--text)', fontSize: 'var(--fs-xs)' }}>{e.when}</td>
              <td data-label={U.errorHead.fix} style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>{e.fix}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

function PolicyView({ onCopy, copiedId }: Omit<Props, 'section'>) {
  const U = AI_DOC_UI
  return (
    <>
      <table className="table-base table-card" style={{ marginBottom: 'var(--space-8)' }}>
        <thead><tr>
          <th>{U.providerHead.id}</th>
          <th>{U.providerHead.keyPrefix}</th>
          <th>{U.providerHead.vision}</th>
          <th>{U.providerHead.tools}</th>
          <th>{U.providerHead.thinking}</th>
          <th>{U.providerHead.issue}</th>
        </tr></thead>
        <tbody>
          {AI_PROVIDERS.map((v) => (
            <tr key={v.id}>
              <td className="card-header"><code style={{ color: 'var(--brand)', fontSize: 'var(--fs-xs)' }}>{v.id}</code></td>
              <td data-label={U.providerHead.keyPrefix}><code style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{v.keyPrefix}</code></td>
              <td data-label={U.providerHead.vision} style={{ fontSize: 'var(--fs-xs)' }}>{v.vision ? U.yes : U.no}</td>
              <td data-label={U.providerHead.tools} style={{ fontSize: 'var(--fs-xs)' }}>{v.tools ? U.yes : U.no}</td>
              <td data-label={U.providerHead.thinking} style={{ fontSize: 'var(--fs-xs)' }}>{v.thinking ? U.yes : U.no}</td>
              <td data-label={U.providerHead.issue}>
                <a href={v.keyIssueUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--brand)', fontSize: 'var(--fs-xs)' }}>{v.keyIssueUrl.replace('https://', '')}</a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <H2>{U.chainOrderTitle}</H2>
      {AI_CHAIN_ORDER.map((s2) => (
        <section key={s2.no} style={{ marginBottom: 'var(--space-5)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)', flexWrap: 'wrap' }}>
            <NbBadge>{String(s2.no)}</NbBadge>
            <span style={{ fontWeight: 700, color: 'var(--text)', fontSize: 'var(--fs-base)' }}>{s2.title}</span>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)', lineHeight: 1.7, margin: 0 }}>{s2.note}</p>
        </section>
      ))}

      <H2>{U.chainLimitTitle}</H2>
      <Lines lines={[
        `전체 후보 ${AI_CHAIN_LIMITS.maxCandidates}개까지 시도합니다. 늘리면 막혔을 때 사용자가 기다리는 시간이 그만큼 늘어납니다.`,
        `한 공급자에서는 ${AI_CHAIN_LIMITS.maxPerProvider}개까지만 씁니다. 죽어 있는 공급자의 모델로 후보를 다 채우지 않습니다.`,
      ]} />

      <H2>{U.failureTitle}</H2>
      <table className="table-base table-card" style={{ marginBottom: 'var(--space-8)' }}>
        <thead><tr>
          <th>{U.failureHead.scope}</th>
          <th>{U.failureHead.when}</th>
          <th>{U.failureHead.then}</th>
        </tr></thead>
        <tbody>
          {AI_FAILURE_RULES.map((r) => (
            <tr key={r.scope}>
              <td className="card-header"><code style={{ color: 'var(--brand)', fontSize: 'var(--fs-xs)' }}>{r.scope}</code></td>
              <td data-label={U.failureHead.when} style={{ color: 'var(--text)', fontSize: 'var(--fs-xs)' }}>{r.when}</td>
              <td data-label={U.failureHead.then} style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>{r.then}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {AI_POLICY_NOTES.map((b) => (
        <section key={b.title}>
          <H2>{b.title}</H2>
          <Lines lines={b.lines} />
        </section>
      ))}

      <H2>{U.policyCodeTitle}</H2>
      <CodeBlock id="ai-policy-code" lang={AI_POLICY_CODE.lang} code={AI_POLICY_CODE.text} onCopy={onCopy} copiedId={copiedId} />
    </>
  )
}

function ContractView({ onCopy, copiedId }: Omit<Props, 'section'>) {
  const U = AI_DOC_UI
  return (
    <>
      <H2>{U.contractTypeTitle}</H2>
      <CodeBlock id="ai-contract-type" lang={AI_CONTRACT_TYPE.lang} code={AI_CONTRACT_TYPE.text} onCopy={onCopy} copiedId={copiedId} />

      <H2>{U.statusTitle}</H2>
      <table className="table-base table-card" style={{ marginBottom: 'var(--space-8)' }}>
        <thead><tr>
          <th>{U.statusHead.from}</th>
          <th>{U.statusHead.label}</th>
          <th>{U.statusHead.to}</th>
          <th>{U.statusHead.note}</th>
        </tr></thead>
        <tbody>
          {AI_STATUS_ROWS.map((r) => (
            <tr key={r.from}>
              <td className="card-header"><code style={{ color: 'var(--brand)', fontSize: 'var(--fs-xs)' }}>{r.from}</code></td>
              <td data-label={U.statusHead.label} style={{ color: 'var(--text)', fontSize: 'var(--fs-xs)' }}>{r.label}</td>
              <td data-label={U.statusHead.to} style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
                {r.to.map((t) => `${t} (${AI_STATUS_LABEL[t]})`).join(', ')}
              </td>
              <td data-label={U.statusHead.note} style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>{r.note}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <table className="table-base table-card" style={{ marginBottom: 'var(--space-8)' }}>
        <thead><tr>
          <th>{U.contractHead.key}</th>
          <th>{U.contractHead.label}</th>
          <th>{U.contractHead.note}</th>
        </tr></thead>
        <tbody>
          {AI_CONTRACT_FIELDS.map((f) => (
            <tr key={f.key}>
              <td className="card-header"><code style={{ color: 'var(--brand)', fontSize: 'var(--fs-xs)' }}>{f.key}</code></td>
              <td data-label={U.contractHead.label} style={{ color: 'var(--text)', fontSize: 'var(--fs-xs)' }}>{f.label}</td>
              <td data-label={U.contractHead.note} style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>{f.note}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <H2>{U.capabilityTitle}</H2>
      <table className="table-base table-card" style={{ marginBottom: 'var(--space-8)' }}>
        <thead><tr>
          <th>{U.capabilityHead.key}</th>
          <th>{U.capabilityHead.label}</th>
          <th>{U.capabilityHead.mustShow}</th>
        </tr></thead>
        <tbody>
          {AI_CAPABILITY_DOCS.map((c) => (
            <tr key={c.key}>
              <td className="card-header"><code style={{ color: 'var(--brand)', fontSize: 'var(--fs-xs)' }}>{c.key}</code></td>
              <td data-label={U.capabilityHead.label} style={{ color: 'var(--text)', fontSize: 'var(--fs-xs)' }}>{c.label}</td>
              <td data-label={U.capabilityHead.mustShow} style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>{c.mustShow}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <H2>{U.contractCodeTitle}</H2>
      <CodeBlock id="ai-contract-code" lang={AI_CONTRACT_CODE.lang} code={AI_CONTRACT_CODE.text} onCopy={onCopy} copiedId={copiedId} />
    </>
  )
}

/** 항목마다 가지를 이름으로 적는다 — 기본값으로 흘리면 목록에 항목을 더해도 눌렀을 때 소개가 뜬다 */
function Body({ section, onCopy, copiedId }: Props) {
  switch (section) {
    case 'ai-setup': return <SetupView onCopy={onCopy} copiedId={copiedId} />
    case 'ai-policy': return <PolicyView onCopy={onCopy} copiedId={copiedId} />
    case 'ai-packages': return <PackagesView />
    case 'ai-contract': return <ContractView onCopy={onCopy} copiedId={copiedId} />
    case 'ai-intro': return <IntroView />
  }
}

export default function AiLayerSection({ section, onCopy, copiedId }: Props) {
  return (
    <div>
      <Head section={section} />
      <Body section={section} onCopy={onCopy} copiedId={copiedId} />
    </div>
  )
}
