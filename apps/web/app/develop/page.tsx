'use client'

/**
 * 개발자센터, **문서를 코드에서 뽑는다**
 *
 * 예전 판은 940줄짜리 손으로 쓴 JSX 였다. 엔드포인트를 추가해도 문서는 저절로 늘지 않고,
 * 문서를 고쳐도 코드는 변하지 않았다. 그래서 v0.7.117(2026-06-15) 이후 664커밋 동안
 * `app/api` 에 라우트 167개가 생기는 사이 이 화면은 한 문장도 바뀌지 않았고,
 * 「분당 60회」처럼 **없는 기능을 약속**하고 있었다.
 *
 * 이제 엔드포인트 목록·설명·파라미터·예시는 전부 `lib/api-docs/registry.ts` 에서 온다.
 * 라우트를 만들고 등재를 잊으면 `lib/api-docs/registry.test.ts` 가 커밋을 막는다.
 *
 * 이 화면은 v0.7.617부터 **로그인이 필요하다**, 공개 API 가 사내 자동화용으로 확정됐다.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import PageHeader from '@/components/ui/PageHeader'
import NbBadge from '@/components/ui/nb/NbBadge'
import type { StatusKey } from '@/lib/tokens/status-colors'
import { SERVICE_LABEL, API_CLI_DOC, DEVCENTER_START } from '@/lib/terms'
import { DEVCENTER_NAV, DEVCENTER_REF_LABEL, DEVCENTER_ENDPOINT, DEVCENTER_COPY } from '@/lib/terms/devcenter'
import { AUTH_DOC, AUTH_ME_SAMPLE } from '@/lib/api-docs/auth-doc'
import DemoSection from './DemoSection'
import AiLayerSection from './AiLayerSection'
import CliSection from './CliSection'
import KeyScopeSection from './KeyScopeSection'
import GatewaySection from './GatewaySection'
import CliGuideSection from './CliGuideSection'
import { GATEWAY_DOC } from '@/lib/api-docs/gateway-doc'
import { ERRORS_DOC, HTTP_ERROR_ROWS } from '@/lib/api-docs/errors-doc'
import ErrorCodeTable from './ErrorCodeTable'
import { AI_DOC_NAV, AI_LAYER_NAV_LABEL, type AiDocKey } from '@/lib/api-docs/ai-layer'
import { ApiLangPicker, ApiLangProvider, useApiLanguage } from './api-lang'
import CodeTabs from './CodeTabs'
import CodeBlock from './CodeBlock'
import {
  API_GROUPS, endpointsOf, REQUIRES_LABEL, CATALOG_NOTE, requestSpecOf, STABLE_ENDPOINTS, ENDPOINTS,
  type ApiGroupKey, type ApiEndpoint, type ApiParam,
} from '@/lib/api-docs/registry'
import {
  DEFAULT_SECTION, REF_SECTION_ENDPOINT, REF_SECTION_IDS, parseSection, buildHref, resolveSection, hasCode,
  type RefSectionId,
} from './develop-nav'
import styles from './develop.module.css'

/** 엔드포인트 묶음 넷, 참고 묶음은 내 키, 승인, 스펙 세 절로 나뉘어 따로 그린다 (develop-nav.ts) */
const ENDPOINT_GROUPS = ['gpu', 'crm', 'ci', 'legacy'] as const
type EndpointGroup = typeof ENDPOINT_GROUPS[number]

/** 왼쪽 목록의 항목, registry 묶음 넷 + 참고 셋 + 화면 전용(시작, 게이트웨이, CLI, 데모, 오류) + AI 공통층 */
type Section = 'start' | EndpointGroup | RefSectionId | 'demo' | 'errors' | 'cli' | 'gateway' | AiDocKey

function useOrigin(fallback = 'https://your-domain.com') {
  const [origin, setOrigin] = useState(fallback)
  useEffect(() => { setOrigin(window.location.origin) }, [])
  return origin
}

/* ── 공통 조판 ─────────────────────────────────────────────────────────────── */

function SidebarItem({ children, active, onClick }: { children: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'block', width: '100%', textAlign: 'left',
        padding: 'var(--space-2) var(--space-3)', border: 'none', cursor: 'pointer',
        fontSize: 'var(--fs-sm)', fontWeight: active ? 600 : 400,
        background: active ? 'var(--brand-soft)' : 'transparent',
        color: active ? 'var(--brand)' : 'var(--text-muted)',
        borderLeft: active ? 'var(--border-w-2) solid var(--brand)' : 'var(--border-w-2) solid transparent',
        marginBottom: 'var(--space-1)',
      }}
    >
      {children}
    </button>
  )
}

/** HTTP 메서드 → 뱃지 의미색. 색맵을 화면에서 만들지 않는다(NbBadge SSOT) */
const METHOD_STATUS: Record<string, StatusKey> = { GET: 'done', POST: 'planned', PATCH: 'note', PUT: 'note', DELETE: 'blocker' }

function H2({ children }: { children: React.ReactNode }) {
  return <h2 style={{ fontSize: 'var(--fs-xl)', fontWeight: 700, color: 'var(--text)', marginBottom: 'var(--space-3)', marginTop: 'var(--space-8)', letterSpacing: '-0.01em' }}>{children}</h2>
}
function P({ children }: { children: React.ReactNode }) {
  return <p style={{ color: 'var(--text-muted)', lineHeight: 1.7, fontSize: 'var(--fs-md)', marginBottom: 'var(--space-4)' }}>{children}</p>
}
function Code({ children }: { children: React.ReactNode }) {
  return <code style={{ color: 'var(--brand)', background: 'var(--surface-muted)', padding: '1px 6px' }}>{children}</code>
}
/** 문장 안의 `…` 를 코드 글꼴로 그린다, 문장은 lib/terms/devcenter.ts 에 있다 */
function WithCode({ text }: { text: string }) {
  return <>{text.split('`').map((part, i) => (i % 2 ? <Code key={i}>{part}</Code> : part))}</>
}
function Callout({ type = 'info', title, children }: { type?: 'info' | 'warn' | 'tip'; title: string; children: React.ReactNode }) {
  const cfg = {
    info: { border: 'var(--info-border)', bg: 'var(--info-bg)', color: 'var(--info)', icon: '💡' },
    warn: { border: 'var(--danger-border)', bg: 'var(--danger-bg)', color: 'var(--danger)', icon: '⚠️' },
    tip:  { border: 'var(--success-border)', bg: 'var(--success-bg)', color: 'var(--success)', icon: '✅' },
  }[type]
  return (
    <div style={{ padding: 'var(--space-4)', background: cfg.bg, border: `var(--border-w-2) solid ${cfg.border}`, marginBottom: 'var(--space-5)' }}>
      <div style={{ fontWeight: 700, color: cfg.color, marginBottom: 'var(--space-2)', fontSize: 'var(--fs-sm)' }}>{cfg.icon} {title}</div>
      <div style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)', lineHeight: 1.6 }}>{children}</div>
    </div>
  )
}

function ParamTable({ params, title }: { params: ApiParam[]; title: string }) {
  const h = DEVCENTER_ENDPOINT.paramHead
  return (
    <>
      <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 'var(--space-2)', fontSize: 'var(--fs-base)' }}>{title}</div>
      <div style={{ marginBottom: 'var(--space-5)' }}>
        {/* 모바일에서 카드로 변환되는 공용 표 스타일(.table-card), 가로 스크롤 금지 */}
        <table className="table-base table-card">
          <thead><tr><th>{h.field}</th><th>{h.type}</th><th>{h.desc}</th></tr></thead>
          <tbody>
            {params.map((p) => (
              <tr key={p.name}>
                <td className="card-header">
                  <code style={{ color: 'var(--brand)', fontSize: 'var(--fs-xs)' }}>{p.name}</code>
                  {p.required && <span style={{ marginLeft: 'var(--space-2)', fontSize: 'var(--fs-2xs)', color: 'var(--danger)', fontWeight: 700, background: 'var(--danger-bg)', padding: '1px 5px' }}>{DEVCENTER_ENDPOINT.required}</span>}
                </td>
                <td data-label={h.type} style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>{p.type}</td>
                <td data-label={h.desc} style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>{p.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

/* ── 엔드포인트 한 건, registry 가 유일한 입력 ────────────────────────────── */

function EndpointDoc({ e, baseUrl, onCopy, copiedId }: {
  e: ApiEndpoint; baseUrl: string; onCopy: (t: string, id: string) => void; copiedId: string | null
}) {
  return (
    <section id={e.id} style={{ marginBottom: 'var(--space-10)', scrollMarginTop: 72 }}>
      <div className="card" style={{ padding: 'var(--space-4) var(--space-5)', marginBottom: 'var(--space-4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)', flexWrap: 'wrap' }}>
          <NbBadge status={METHOD_STATUS[e.method]}>{e.method}</NbBadge>
          <code style={{ fontSize: 'var(--fs-base)', color: 'var(--text)', background: 'var(--surface-muted)', padding: 'var(--space-1) var(--space-3)', minWidth: 0, overflowWrap: 'anywhere' }}>
            /api/public/v1{e.path}
          </code>
          {e.status === 'deprecated' && <NbBadge status="blocker">{DEVCENTER_ENDPOINT.deprecatedBadge}</NbBadge>}
        </div>
        <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 'var(--space-1)', fontSize: 'var(--fs-base)' }}>{e.title}</div>
        <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)', margin: 0 }}>{e.desc}</p>
        {e.requires && (
          <p style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-xs)', margin: 'var(--space-2) 0 0' }}>
            🔒 {REQUIRES_LABEL[e.requires]}
          </p>
        )}
      </div>

      {e.deprecatedNote && (
        <Callout type="warn" title={DEVCENTER_ENDPOINT.deprecatedTitle}>{e.deprecatedNote}</Callout>
      )}

      {e.query?.length ? <ParamTable params={[...e.query]} title={DEVCENTER_ENDPOINT.queryTitle} /> : null}
      {e.body?.length ? <ParamTable params={[...e.body]} title={DEVCENTER_ENDPOINT.bodyTitle} /> : null}
      {e.response?.file && <Callout title={DEVCENTER_ENDPOINT.fileTitle}>{e.response.file}</Callout>}
      {e.response?.fields?.length ? <ParamTable params={[...e.response.fields]} title={DEVCENTER_ENDPOINT.responseFieldsTitle} /> : null}
      {e.response?.note && (
        <p style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-xs)', margin: 'calc(-1 * var(--space-3)) 0 var(--space-5)' }}>{e.response.note}</p>
      )}

      <CodeTabs
        id={e.id}
        baseUrl={baseUrl}
        spec={requestSpecOf(e)}
        onCopy={onCopy}
        copiedId={copiedId}
      />

      {e.sample && <CodeBlock id={`${e.id}-res`} lang="json" code={e.sample} onCopy={onCopy} copiedId={copiedId} />}
    </section>
  )
}

function GroupSection({ group, baseUrl, onCopy, copiedId, onNavigate }: {
  group: ApiGroupKey; baseUrl: string; onCopy: (t: string, id: string) => void; copiedId: string | null
  onNavigate: (s: string) => void
}) {
  const meta = API_GROUPS.find((g) => g.key === group)!
  const list = endpointsOf(group)
  return (
    <div>
      <PageHeader title={meta.label} description={meta.desc} />
      {CATALOG_NOTE.groups.includes(group) && (
        <Callout title={CATALOG_NOTE.title}>
          <p style={{ margin: '0 0 var(--space-3)' }}>{CATALOG_NOTE.body}</p>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            {[CATALOG_NOTE.cli, CATALOG_NOTE.ref].map((l) => (
              <button key={l.section} type="button" className="btn-ghost" onClick={() => onNavigate(l.section)}>{l.label}</button>
            ))}
          </div>
        </Callout>
      )}
      {list.map((e) => (
        <EndpointDoc key={e.id} e={e} baseUrl={baseUrl} onCopy={onCopy} copiedId={copiedId} />
      ))}
    </div>
  )
}

/** 참고 묶음의 한 절, registry 의 엔드포인트 한 건을 그 이름으로 그린다 */
function RefSection({ section, baseUrl, onCopy, copiedId }: {
  section: RefSectionId; baseUrl: string; onCopy: (t: string, id: string) => void; copiedId: string | null
}) {
  const e = ENDPOINTS.find((x) => x.id === REF_SECTION_ENDPOINT[section])!
  return (
    <div>
      <PageHeader title={DEVCENTER_REF_LABEL[section]} description={e.title} />
      <EndpointDoc e={e} baseUrl={baseUrl} onCopy={onCopy} copiedId={copiedId} />
    </div>
  )
}

/* ── 시작하기 ──────────────────────────────────────────────────────────────── */

/**
 * 빠른 시작의 둘째 단계, 권한과 상관없이 부를 수 있는 GET /me (registry 의 줄 그대로)
 * 예전 첫 요청은 GET /products 라서 GPU 권한이 없는 계정은 첫 줄부터 403 이었다 (P0168)
 */
const QUICK_ME = STABLE_ENDPOINTS.find((e) => e.id === 'ref.me')!

/**
 * 셋째 단계, 계정 권한마다 처음 부를 목록. 손으로 적지 않고 registry 에서 뽑는다
 * 권한(requires)별로 경로 변수 없는 첫 GET 목록, 첫 줄이 코드 예시가 된다
 */
const QUICK_LIST_REQUIRES = ['crm-member', 'ci-member', 'member'] as const
const QUICK_LISTS = QUICK_LIST_REQUIRES.map((requires) =>
  STABLE_ENDPOINTS.find((e) => e.method === 'GET' && e.requires === requires && !e.path.includes('{'))!,
)

function QuickListTable() {
  const h = DEVCENTER_START.step3Head
  const cell = { color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' } as const
  return (
    <div style={{ marginBottom: 'var(--space-5)' }}>
      <table className="table-base table-card">
        <thead><tr><th>{h.path}</th><th>{h.title}</th><th>{h.requires}</th></tr></thead>
        <tbody>
          {QUICK_LISTS.map((e) => (
            <tr key={e.id}>
              <td className="card-header"><code style={{ color: 'var(--brand)', fontSize: 'var(--fs-xs)' }}>GET {e.path}</code></td>
              <td data-label={h.title} style={cell}>{e.title}</td>
              <td data-label={h.requires} style={cell}>{e.requires ? REQUIRES_LABEL[e.requires] : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function StartSection({ onCopy, copiedId, brandName }: { onCopy: (t: string, id: string) => void; copiedId: string | null; brandName: string }) {
  const origin = useOrigin()
  const base = `${origin}/api/public/v1`
  const lang = useApiLanguage()
  const t = DEVCENTER_START
  return (
    <div>
      <div style={{ fontSize: 13, color: 'var(--brand)', fontWeight: 600, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {brandName ? `${brandName} ${t.eyebrow}` : t.eyebrow}
      </div>
      <PageHeader title={t.title} description={t.description} />

      <Callout type="info" title={t.inheritTitle}>{AUTH_DOC.inheritBody}</Callout>

      <H2>{t.baseUrlTitle}</H2>
      <CodeBlock id="baseurl" code={base} onCopy={onCopy} copiedId={copiedId} />

      <H2>{t.quickTitle}</H2>
      <P>{t.quickIntro}</P>

      <h3 style={{ fontSize: 'var(--fs-lg)', fontWeight: 700, color: 'var(--text)', margin: 'var(--space-6) 0 var(--space-3)' }}>{t.step1Title}</h3>
      <P>{t.step1Body}</P>
      <p style={{ marginBottom: 'var(--space-5)' }}><a href="/api-keys" className="btn-ghost">{t.step1Link}</a></p>

      <h3 style={{ fontSize: 'var(--fs-lg)', fontWeight: 700, color: 'var(--text)', margin: 'var(--space-6) 0 var(--space-3)' }}>{t.step2Title}</h3>
      <P>{t.step2Body}</P>
      <CodeTabs id="quickstart-me" baseUrl={base} spec={requestSpecOf(QUICK_ME)} onCopy={onCopy} copiedId={copiedId} />
      <CodeBlock id="quickstart-me-res" lang="json" code={AUTH_ME_SAMPLE} onCopy={onCopy} copiedId={copiedId} />

      <h3 style={{ fontSize: 'var(--fs-lg)', fontWeight: 700, color: 'var(--text)', margin: 'var(--space-6) 0 var(--space-3)' }}>{t.step3Title}</h3>
      <P>{t.step3Body}</P>
      <QuickListTable />
      <CodeTabs id="quickstart-list" baseUrl={base} spec={requestSpecOf(QUICK_LISTS[0])} onCopy={onCopy} copiedId={copiedId} />
      <P>{t.step3Forbidden}</P>

      <H2>{t.authTitle}</H2>
      <P><WithCode text={t.authBody} /></P>
      <P>{t.authDeactivatedBody}</P>
      <KeyScopeSection onCopy={onCopy} copiedId={copiedId} />

      <H2>{t.envelopeTitle}</H2>
      <P>{t.envelopeBody}</P>
      <CodeBlock id="resp-format" lang="json" onCopy={onCopy} copiedId={copiedId} code={t.envelopeSample} />
      <Callout type="info" title={t.topLevelTitle}>{t.topLevelBody}</Callout>

      <H2>{t.paginationTitle}</H2>
      <P><WithCode text={t.paginationBody} /></P>
      {/* 예시도 고른 언어를 따른다, 언어를 물어 놓고 다른 언어를 보여 주면 물어본 뜻이 없다 */}
      <CodeBlock id="pagination" lang={lang.hl} onCopy={onCopy} copiedId={copiedId} code={lang.paginate(base)} />

      <H2>{t.rateTitle}</H2>
      <P>{t.rateBody}</P>
      <CodeBlock id="ratelimit" lang="bash" onCopy={onCopy} copiedId={copiedId} code={t.rateHeaderSample} />
      <Callout type="info" title={t.rateNoHeaderTitle}>{t.rateNoHeaderBody}</Callout>
      <Callout type="warn" title={t.rateOverTitle}><WithCode text={t.rateOverBody} /></Callout>
    </div>
  )
}

/* ── 오류 ──────────────────────────────────────────────────────────────────── */

function ErrorsSection({ onCopy, copiedId }: { onCopy: (t: string, id: string) => void; copiedId: string | null }) {
  const origin = useOrigin()
  const lang = useApiLanguage()
  const eh = ERRORS_DOC.httpHead
  return (
    <div>
      <PageHeader title={ERRORS_DOC.title} description={ERRORS_DOC.description} />
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <table className="table-base table-card">
          <thead><tr><th>{eh.code}</th><th>{eh.name}</th><th>{eh.cause}</th><th>{eh.fix}</th></tr></thead>
          <tbody>
            {HTTP_ERROR_ROWS.map((e) => (
              <tr key={e.code}>
                <td className="card-header"><code style={{ color: 'var(--brand)' }}>{e.code}</code></td>
                <td data-label={eh.name} style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>{e.name}</td>
                <td data-label={eh.cause} style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>{e.cause}</td>
                <td data-label={eh.fix} style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>{e.fix}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* 게이트웨이 응답(202, 403, 409, 400)과 CRM 오류 코드, 줄은 errors-doc.ts 에서 온다 */}
      <ErrorCodeTable onCopy={onCopy} copiedId={copiedId} />
      <H2>{ERRORS_DOC.retryTitle}</H2>
      {/* 이 예시도 고른 언어를 따른다(lib/api-docs/snippets.ts 가 만든다) */}
      <CodeBlock id="retry" lang={lang.hl} onCopy={onCopy} copiedId={copiedId} code={lang.retry(`${origin}/api/public/v1`)} />
    </div>
  )
}

/* ── 화면 ──────────────────────────────────────────────────────────────────── */

/** 왼쪽 목록, 묶음 이름은 registry 에서 온다. 화면이 서비스 이름을 짓지 않는다(§0-2) */
const groupLabel = (k: ApiGroupKey) => API_GROUPS.find((g) => g.key === k)!.label

const NAV: { label: string; items: { id: Section; l: string }[] }[] = [
  { label: DEVCENTER_NAV.startGroup, items: [{ id: 'start', l: DEVCENTER_NAV.startItem }, { id: 'gateway', l: GATEWAY_DOC.nav }] },
  { label: DEVCENTER_NAV.endpointGroup, items: ENDPOINT_GROUPS.map((k) => ({ id: k as Section, l: groupLabel(k) })) },
  // 묶음 이름과 항목은 ai-layer.ts 에서 온다, 화면이 목록을 짓지 않는다
  { label: AI_LAYER_NAV_LABEL, items: AI_DOC_NAV.map((n) => ({ id: n.key as Section, l: n.label })) },
  { label: DEVCENTER_NAV.refGroup, items: [...REF_SECTION_IDS.map((id) => ({ id: id as Section, l: DEVCENTER_REF_LABEL[id] })), { id: 'errors', l: DEVCENTER_NAV.errors }] },
  { label: DEVCENTER_NAV.toolsGroup, items: [{ id: 'cli', l: API_CLI_DOC.nav }, { id: 'demo', l: DEVCENTER_NAV.demo }] },
]

const NAV_IDS: readonly string[] = NAV.flatMap((g) => g.items.map((i) => i.id))
const navLabelOf = (s: Section) => NAV.flatMap((g) => g.items).find((i) => i.id === s)?.l ?? ''

/** 엔드포인트 id(본문의 <section id>) → 그 엔드포인트가 있는 절, #앵커 링크가 절을 연다 */
const REF_SECTION_OF: Record<string, RefSectionId> = Object.fromEntries(
  REF_SECTION_IDS.map((id) => [REF_SECTION_ENDPOINT[id], id]),
)
const ANCHOR_TO_SECTION: Record<string, string> = Object.fromEntries(
  ENDPOINTS.flatMap((e): [string, string][] => {
    if (e.group === 'ref') return REF_SECTION_OF[e.id] ? [[e.id, REF_SECTION_OF[e.id]]] : []
    return (ENDPOINT_GROUPS as readonly string[]).includes(e.group) ? [[e.id, e.group]] : []
  }),
)

/** 복사 결과를 보여 주는 시간, 실패 문장은 읽을 시간을 더 준다 */
const COPIED_MS = 2000
const COPY_FAILED_MS = 6000

const COPY_FAILED_STYLE: React.CSSProperties = {
  position: 'fixed', left: '50%', bottom: 'var(--space-6)', transform: 'translateX(-50%)',
  maxWidth: 'calc(100vw - 32px)', padding: 'var(--space-3) var(--space-4)', zIndex: 'var(--z-toast)',
  background: 'var(--danger-bg)', border: 'var(--border-w-2) solid var(--danger-border)', color: 'var(--danger)',
  fontSize: 'var(--fs-sm)', fontWeight: 600,
}

/**
 * 클립보드에 쓰고 결과를 돌려준다. writeText 는 약속을 돌려주므로 기다려야 거절(권한, 비보안 문맥)을 안다
 * 거절되면 옛 방식(execCommand)으로 한 번 더 해 보고, 그것도 안 되면 false
 */
async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // 아래 옛 방식으로 넘어간다
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.cssText = 'position:fixed;opacity:0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

const AI_DOC_KEYS = new Set<string>(AI_DOC_NAV.map((n) => n.key))
const isAiDoc = (s: Section): s is AiDocKey => AI_DOC_KEYS.has(s)

export default function DevelopPage() {
  // 첫 렌더는 기본 절, 주소(?section=, #앵커)는 마운트 뒤에 읽는다 (서버 렌더와 같아야 한다)
  const [activeSection, setActiveSection] = useState<Section>(DEFAULT_SECTION as Section)
  const [anchor, setAnchor] = useState<string | null>(null)
  const [tocOpen, setTocOpen] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [copyFailed, setCopyFailed] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [brandName, setBrandName] = useState('')
  const origin = useOrigin()
  const base = `${origin}/api/public/v1`

  useEffect(() => {
    const sb = createClient()
    // 어드민에 설정된 서비스명(SSOT: system_settings.brand_name, public_read)
    sb.from('system_settings').select('value').eq('key', 'brand_name').maybeSingle()
      .then(({ data }) => {
        const v = (data as { value?: string | null } | null)?.value
        if (v) setBrandName(v)
      })
  }, [])

  // 주소 > 기본값. 뒤로가기도 같은 해석을 지난다
  useEffect(() => {
    const apply = () => {
      const r = parseSection(window.location.search, window.location.hash, NAV_IDS, ANCHOR_TO_SECTION)
      setActiveSection(r.section as Section)
      setAnchor(r.anchor)
    }
    apply()
    window.addEventListener('popstate', apply)
    return () => window.removeEventListener('popstate', apply)
  }, [])

  // 앵커로 들어오면 그 절을 그린 뒤 그 엔드포인트로 내려간다
  useEffect(() => {
    if (!anchor) return
    document.getElementById(anchor)?.scrollIntoView({ block: 'start' })
  }, [anchor, activeSection])

  /** 절을 고르면 주소에 남긴다, pushState 라 뒤로가기가 앞 절로 돌아간다 */
  const navigate = useCallback((raw: string) => {
    const next = resolveSection(raw, NAV_IDS) as Section | null
    if (!next) return
    setActiveSection(next)
    setAnchor(null)
    setTocOpen(false)
    const href = buildHref(window.location.search, next)
    window.history.pushState(null, '', `${window.location.pathname}${href}`)
  }, [])

  /** 「복사됨」은 클립보드에 실제로 들어갔을 때만 띄운다, 실패는 화면 아래 알림 줄이 말한다 */
  const copy = useCallback(async (text: string, id: string) => {
    const ok = await writeClipboard(text)
    if (copyTimer.current) clearTimeout(copyTimer.current)
    setCopiedId(ok ? id : null)
    setCopyFailed(!ok)
    copyTimer.current = setTimeout(() => { setCopiedId(null); setCopyFailed(false) }, ok ? COPIED_MS : COPY_FAILED_MS)
  }, [])
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current) }, [])

  const isGroup = (s: Section): s is EndpointGroup => (ENDPOINT_GROUPS as readonly string[]).includes(s)
  const isRef = (s: Section): s is RefSectionId => (REF_SECTION_IDS as readonly string[]).includes(s)

  return (
    <ApiLangProvider>
    <div style={{ background: 'var(--surface-muted)', minHeight: '100vh', color: 'var(--text)' }}>
      <header style={{ borderBottom: 'var(--hairline) solid var(--border-light)', padding: 'var(--space-0) var(--space-8)', position: 'sticky', top: 0, background: 'var(--color-surface)', backdropFilter: 'blur(12px)', zIndex: 'var(--z-sticky)' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 56 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <a href="/home" style={{ fontWeight: 700, fontSize: 'var(--fs-md)', color: 'var(--text)', textDecoration: 'none' }}>
              {brandName ? `${brandName} ${SERVICE_LABEL.develop}` : SERVICE_LABEL.develop}
            </a>
            <NbBadge>v1</NbBadge>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {/* 로그인 뒤 화면이므로 나갈 길을 항상 둔다(§2-3-3 N-2) */}
            <a href="/home" className="btn-ghost">← {SERVICE_LABEL.member}</a>
            <a href="/api-keys" className="btn-primary">{DEVCENTER_START.step1Link}</a>
          </div>
        </div>
      </header>

      {/* 좁은 화면에서는 사이드바가 위로 접힌다(고정 2열 금지, 반응형 정책) */}
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: 'var(--space-10) var(--space-8)', display: 'flex', flexWrap: 'wrap', gap: 'var(--space-8)', alignItems: 'flex-start' }}>
        <aside className={styles.aside}>
          {/* 좁은 화면에서만 보이는 목차 단추, 목록을 접어 본문이 첫 화면에 오게 한다 */}
          <button
            type="button"
            className={styles.tocToggle}
            aria-expanded={tocOpen}
            aria-controls="develop-nav"
            onClick={() => setTocOpen((v) => !v)}
          >
            <span>{DEVCENTER_NAV.toc}</span>
            <span className={styles.tocCurrent}>{navLabelOf(activeSection)}</span>
          </button>
          <nav id="develop-nav" className={styles.nav} data-open={tocOpen ? 'true' : 'false'}>
            {NAV.map(({ label, items }) => (
              <div key={label} style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6, padding: '0 12px' }}>{label}</div>
                {items.map(({ id, l }) => (
                  <SidebarItem key={id} active={activeSection === id} onClick={() => navigate(id)}>
                    {/* 개수는 손으로 적지 않는다, registry 에 등재된 수가 그대로 나온다 */}
                    {isGroup(id) ? `${l} (${endpointsOf(id).length})` : l}
                  </SidebarItem>
                ))}
              </div>
            ))}
          </nav>
        </aside>

        <main style={{ flex: '999 1 480px', minWidth: 0 }}>
          {/*
            언어를 여기서 한 번 고르면 이 화면의 모든 코드 예시가 따라온다.

            언어를 따르는 예시가 있는 절에서만 그린다(develop-nav.ts SECTIONS_WITH_CODE).
            AI 공통층, CLI, 직접 실행, 게이트웨이에는 바꿀 언어가 없다.
            아무것도 안 바꾸는 선택기는 고를 수 있게 만든 것이 아니다.
          */}
          {hasCode(activeSection) && <ApiLangPicker />}
          {activeSection === 'start' && <StartSection onCopy={copy} copiedId={copiedId} brandName={brandName} />}
          {activeSection === 'demo' && <DemoSection />}
          {activeSection === 'gateway' && <GatewaySection onCopy={copy} copiedId={copiedId} />}
          {activeSection === 'cli' && <CliGuideSection origin={origin} onCopy={copy} copiedId={copiedId} />}
          {activeSection === 'cli' && <CliSection />}
          {activeSection === 'errors' && <ErrorsSection onCopy={copy} copiedId={copiedId} />}
          {isAiDoc(activeSection) && (
            <AiLayerSection section={activeSection} onCopy={copy} copiedId={copiedId} />
          )}
          {isGroup(activeSection) && (
            <GroupSection group={activeSection} baseUrl={base} onCopy={copy} copiedId={copiedId} onNavigate={navigate} />
          )}
          {isRef(activeSection) && (
            <RefSection section={activeSection} baseUrl={base} onCopy={copy} copiedId={copiedId} />
          )}
        </main>
      </div>
      {/* 복사 실패 알림, 읽기 도구가 바로 읽도록 자리는 늘 두고 글만 바꾼다 */}
      <div role="status" aria-live="polite" style={copyFailed ? COPY_FAILED_STYLE : undefined}>
        {copyFailed ? DEVCENTER_COPY.failed : ''}
      </div>
    </div>
    </ApiLangProvider>
  )
}
