'use client'

/**
 * 개발자센터 — **문서를 코드에서 뽑는다**
 *
 * 예전 판은 940줄짜리 손으로 쓴 JSX 였다. 엔드포인트를 추가해도 문서는 저절로 늘지 않고,
 * 문서를 고쳐도 코드는 변하지 않았다. 그래서 v0.7.117(2026-06-15) 이후 664커밋 동안
 * `app/api` 에 라우트 167개가 생기는 사이 이 화면은 한 문장도 바뀌지 않았고,
 * 「분당 60회」처럼 **없는 기능을 약속**하고 있었다.
 *
 * 이제 엔드포인트 목록·설명·파라미터·예시는 전부 `lib/api-docs/registry.ts` 에서 온다.
 * 라우트를 만들고 등재를 잊으면 `lib/api-docs/registry.test.ts` 가 커밋을 막는다.
 *
 * 이 화면은 v0.7.617부터 **로그인이 필요하다** — 공개 API 가 사내 자동화용으로 확정됐다.
 */

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import PageHeader from '@/components/ui/PageHeader'
import NbBadge from '@/components/ui/nb/NbBadge'
import type { StatusKey } from '@/lib/tokens/status-colors'
import { SERVICE_LABEL } from '@/lib/terms'
import DemoSection from './DemoSection'
import CodeTabs from './CodeTabs'
import {
  API_GROUPS, endpointsOf, REQUIRES_LABEL,
  type ApiGroupKey, type ApiEndpoint, type ApiParam,
} from '@/lib/api-docs/registry'

/** 왼쪽 목록의 항목 — registry 묶음 + 화면 전용 두 개(데모·오류) */
type Section = ApiGroupKey | 'demo' | 'errors'

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

function CodeBlock({ code, id, onCopy, copiedId, lang = 'bash' }: { code: string; id: string; onCopy: (t: string, id: string) => void; copiedId: string | null; lang?: string }) {
  return (
    <div className="card" style={{ overflow: 'hidden', marginBottom: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--space-2) var(--space-3)', borderBottom: 'var(--hairline) solid var(--border-light)' }}>
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{lang}</span>
        <button type="button" className="btn-ghost" onClick={() => onCopy(code, id)} style={{ color: copiedId === id ? 'var(--success)' : undefined }}>
          {copiedId === id ? '✓ 복사됨' : '복사'}
        </button>
      </div>
      <pre style={{ margin: 0, padding: 'var(--space-5) var(--space-6)', fontSize: 'var(--fs-sm)', lineHeight: 1.7, color: 'var(--text)', background: 'var(--surface-muted)', overflowX: 'auto', whiteSpace: 'pre' }}>{code}</pre>
    </div>
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
  return (
    <>
      <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 'var(--space-2)', fontSize: 'var(--fs-base)' }}>{title}</div>
      <div style={{ marginBottom: 'var(--space-5)' }}>
        {/* 모바일에서 카드로 변환되는 공용 표 스타일(.table-card) — 가로 스크롤 금지 */}
        <table className="table-base table-card">
          <thead><tr><th>필드</th><th>타입</th><th>설명</th></tr></thead>
          <tbody>
            {params.map((p) => (
              <tr key={p.name}>
                <td className="card-header">
                  <code style={{ color: 'var(--brand)', fontSize: 'var(--fs-xs)' }}>{p.name}</code>
                  {p.required && <span style={{ marginLeft: 'var(--space-2)', fontSize: 'var(--fs-2xs)', color: 'var(--danger)', fontWeight: 700, background: 'var(--danger-bg)', padding: '1px 5px' }}>필수</span>}
                </td>
                <td data-label="타입" style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>{p.type}</td>
                <td data-label="설명" style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>{p.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

/* ── 엔드포인트 한 건 — registry 가 유일한 입력 ────────────────────────────── */

function EndpointDoc({ e, baseUrl, onCopy, copiedId }: {
  e: ApiEndpoint; baseUrl: string; onCopy: (t: string, id: string) => void; copiedId: string | null
}) {
  return (
    <section id={e.id} style={{ marginBottom: 'var(--space-10)' }}>
      <div className="card" style={{ padding: 'var(--space-4) var(--space-5)', marginBottom: 'var(--space-4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)', flexWrap: 'wrap' }}>
          <NbBadge status={METHOD_STATUS[e.method]}>{e.method}</NbBadge>
          <code style={{ fontSize: 'var(--fs-base)', color: 'var(--text)', background: 'var(--surface-muted)', padding: 'var(--space-1) var(--space-3)' }}>
            /api/public/v1{e.path}
          </code>
          {e.status === 'deprecated' && <NbBadge status="blocker">이관 중</NbBadge>}
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
        <Callout type="warn" title="이 엔드포인트는 이관 중입니다">{e.deprecatedNote}</Callout>
      )}

      {e.query?.length ? <ParamTable params={[...e.query]} title="쿼리 파라미터" /> : null}
      {e.body?.length ? <ParamTable params={[...e.body]} title="요청 본문" /> : null}

      <CodeTabs
        id={e.id}
        baseUrl={baseUrl}
        spec={{ method: e.method, path: e.path.replace(/\{(\w+)\}/g, ':$1') }}
        onCopy={onCopy}
        copiedId={copiedId}
      />

      {e.sample && <CodeBlock id={`${e.id}-res`} lang="json" code={e.sample} onCopy={onCopy} copiedId={copiedId} />}
    </section>
  )
}

function GroupSection({ group, baseUrl, onCopy, copiedId }: {
  group: ApiGroupKey; baseUrl: string; onCopy: (t: string, id: string) => void; copiedId: string | null
}) {
  const meta = API_GROUPS.find((g) => g.key === group)!
  const list = endpointsOf(group)
  return (
    <div>
      <PageHeader title={meta.label} description={meta.desc} />
      {list.map((e) => (
        <EndpointDoc key={e.id} e={e} baseUrl={baseUrl} onCopy={onCopy} copiedId={copiedId} />
      ))}
    </div>
  )
}

/* ── 시작하기 ──────────────────────────────────────────────────────────────── */

function StartSection({ onCopy, copiedId, brandName }: { onCopy: (t: string, id: string) => void; copiedId: string | null; brandName: string }) {
  const origin = useOrigin()
  const base = `${origin}/api/public/v1`
  return (
    <div>
      <div style={{ fontSize: 13, color: 'var(--brand)', fontWeight: 600, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {brandName ? `${brandName} 사내 자동화 API` : '사내 자동화 API'}
      </div>
      <PageHeader
        title="개발자 문서"
        description="사내 시스템을 스크립트로 다루기 위한 API입니다. 사내 계정으로 발급한 키를 씁니다."
      />

      <Callout type="info" title="이 API는 사내용입니다">
        키는 <strong style={{ color: 'var(--text)' }}>그 키를 만든 계정의 권한을 그대로 상속</strong>합니다.
        화면에서 볼 수 있는 것을 API로도 볼 수 있고, 화면에서 못 하는 것은 API로도 못 합니다.
        별도의 권한 체계가 없으므로 계정 권한만 관리하면 됩니다.
      </Callout>

      <H2>Base URL</H2>
      <CodeBlock id="baseurl" code={base} onCopy={onCopy} copiedId={copiedId} />

      <H2>빠른 시작 (30초)</H2>
      <P>
        발급받은 키를 <Code>AX_API_KEY</Code> 환경변수에 넣고, 쓰는 언어 탭을 골라 그대로 복사하면 첫 요청이 완성됩니다.
        키는 <strong style={{ color: 'var(--text)' }}>서버에서만</strong> 씁니다 — 브라우저에 두면 사용자에게 노출됩니다.
      </P>
      <CodeTabs id="quickstart" baseUrl={base} spec={{ method: 'GET', path: '/products' }} onCopy={onCopy} copiedId={copiedId} />

      <H2>인증</H2>
      <P>
        모든 요청에 <Code>X-API-Key</Code> 헤더가 필요합니다. <Code>Authorization: Bearer &lt;키&gt;</Code> 도 같게 동작합니다.
        키는 HMAC-SHA256으로 해시해 저장하며, <strong style={{ color: 'var(--text)' }}>내 키 관리</strong>에서 발급·폐기합니다.
      </P>
      <P>
        키를 발급한 계정이 비활성화되면 그 키도 즉시 막힙니다 — 퇴사자의 키가 계속 살아 있는 것을 막습니다.
      </P>

      <H2>응답 형식</H2>
      <P>성공·실패 모두 같은 봉투를 씁니다. 목록은 <Code>meta</Code>에 커서와 총 건수가 들어갑니다.</P>
      <CodeBlock id="resp-format" lang="json" onCopy={onCopy} copiedId={copiedId} code={`// 성공
{
  "success": true,
  "data": [ … ],
  "meta": { "total": 373, "nextCursor": "…", "hasMore": true }
}

// 실패 — 사람이 읽을 수 있는 말로 옵니다
{
  "success": false,
  "error": "분당 요청 한도(60회)를 넘었습니다. 12초 후 다시 시도해 주세요."
}`} />
      <Callout type="info" title="예전 최상위 필드는 당분간 함께 나갑니다">
        구 CRM 목록(<Code>/accounts</Code>·<Code>/contacts</Code>·<Code>/deals</Code>)은 예전에
        <Code>nextCursor</Code>·<Code>hasMore</Code>를 최상위에 뒀습니다. 쓰던 스크립트가 깨지지 않게
        지금은 <Code>meta</Code>와 <strong style={{ color: 'var(--text)' }}>둘 다</strong> 내보냅니다.
        새 코드는 <Code>meta</Code>를 읽으세요.
      </Callout>

      <H2>페이지네이션</H2>
      <P>목록은 커서 방식입니다. 응답의 <Code>meta.nextCursor</Code>를 다음 요청의 <Code>cursor</Code>에 그대로 넣습니다.</P>
      <CodeBlock id="pagination" lang="bash" onCopy={onCopy} copiedId={copiedId} code={`# 첫 페이지 (기본 20건, 최대 100)
curl "${base}/crm/companies?limit=50" -H "X-API-Key: $AX_API_KEY"

# 다음 페이지
curl "${base}/crm/companies?limit=50&cursor=<meta.nextCursor>" -H "X-API-Key: $AX_API_KEY"`} />

      <H2>요청 한도</H2>
      <P>
        키마다 분당 한도가 있습니다(기본 60회, 키별로 조정 가능). 모든 응답에 남은 횟수가 실립니다.
      </P>
      <CodeBlock id="ratelimit" lang="bash" onCopy={onCopy} copiedId={copiedId} code={`X-RateLimit-Limit: 60
X-RateLimit-Remaining: 41
X-RateLimit-Reset: 1756281600   # 이 분 창이 끝나는 시각(Unix)`} />
      <Callout type="warn" title="한도를 넘으면">
        HTTP 429와 <Code>Retry-After</Code>(초)를 돌려줍니다. 그 시간만큼 기다린 뒤 다시 부르세요.
        많은 데이터를 받을 때는 <Code>limit</Code>을 키우고 커서로 이어 받는 편이 재시도보다 빠릅니다.
      </Callout>
    </div>
  )
}

/* ── 오류 ──────────────────────────────────────────────────────────────────── */

const ERRORS: { code: number; name: string; cause: string; fix: string }[] = [
  { code: 400, name: 'Bad Request', cause: '필수 파라미터 누락·형식 오류', fix: '응답의 error 문장이 무엇이 잘못됐는지 알려 줍니다.' },
  { code: 401, name: 'Unauthorized', cause: 'X-API-Key 없음 또는 형식 오류', fix: '헤더 이름과 키 앞자리(ax_live_)를 확인하세요.' },
  { code: 403, name: 'Forbidden', cause: '폐기된 키 · 비활성 계정 · 권한 부족', fix: '키를 발급한 계정의 권한을 확인하세요. 남의 레코드는 관리자만 고칠 수 있습니다.' },
  { code: 404, name: 'Not Found', cause: '없는 id', fix: '목록 API로 id를 다시 확인하세요.' },
  { code: 429, name: 'Too Many Requests', cause: '분당 한도 초과', fix: 'Retry-After 초만큼 기다린 뒤 재시도하세요.' },
  { code: 500, name: 'Server Error', cause: '서버 처리 실패', fix: '잠시 후 다시 시도하고, 계속되면 관리자에게 알려 주세요.' },
]

function ErrorsSection({ onCopy, copiedId }: { onCopy: (t: string, id: string) => void; copiedId: string | null }) {
  return (
    <div>
      <PageHeader title="오류 코드" description="실패도 성공과 같은 봉투로 옵니다. error 문장은 사람이 읽을 수 있는 말입니다." />
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <table className="table-base table-card">
          <thead><tr><th>코드</th><th>이름</th><th>원인</th><th>대응</th></tr></thead>
          <tbody>
            {ERRORS.map((e) => (
              <tr key={e.code}>
                <td className="card-header"><code style={{ color: 'var(--brand)' }}>{e.code}</code></td>
                <td data-label="이름" style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>{e.name}</td>
                <td data-label="원인" style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>{e.cause}</td>
                <td data-label="대응" style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>{e.fix}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <H2>재시도 예시</H2>
      <CodeBlock id="retry" lang="javascript" onCopy={onCopy} copiedId={copiedId} code={`const res = await fetch(url, { headers: { 'X-API-Key': process.env.AX_API_KEY } })

if (res.status === 429) {
  const wait = Number(res.headers.get('Retry-After') ?? 60)
  await new Promise((r) => setTimeout(r, wait * 1000))
  return retry()
}`} />
    </div>
  )
}

/* ── 화면 ──────────────────────────────────────────────────────────────────── */

/** 왼쪽 목록 — 묶음 이름은 registry 에서 온다. 화면이 서비스 이름을 짓지 않는다(§0-2) */
const groupLabel = (k: ApiGroupKey) => API_GROUPS.find((g) => g.key === k)!.label

const NAV: { label: string; items: { id: Section; l: string }[] }[] = [
  { label: '시작하기', items: [{ id: 'start', l: '개요 · 인증 · 한도' }] },
  { label: '엔드포인트', items: (['gpu', 'crm', 'ci', 'legacy'] as const).map((k) => ({ id: k as Section, l: groupLabel(k) })) },
  { label: '참고', items: [{ id: 'ref', l: 'OpenAPI' }, { id: 'demo', l: '직접 실행' }, { id: 'errors', l: '오류 코드' }] },
]

export default function DevelopPage() {
  const [activeSection, setActiveSection] = useState<Section>('start')
  const [copiedId, setCopiedId] = useState<string | null>(null)
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

  function copy(text: string, id: string) {
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
    try { navigator.clipboard.writeText(text) } catch {
      const ta = document.createElement('textarea')
      ta.value = text; ta.style.cssText = 'position:fixed;opacity:0'
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta)
    }
  }

  const isGroup = (s: Section): s is ApiGroupKey => s !== 'demo' && s !== 'errors' && s !== 'start'

  return (
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
            <a href="/api-keys" className="btn-primary">내 키 관리</a>
          </div>
        </div>
      </header>

      {/* 좁은 화면에서는 사이드바가 위로 접힌다(고정 2열 금지 — 반응형 정책) */}
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: 'var(--space-10) var(--space-8)', display: 'flex', flexWrap: 'wrap', gap: 'var(--space-8)', alignItems: 'flex-start' }}>
        <aside style={{ flex: '1 1 200px', maxWidth: 240 }}>
          <nav style={{ position: 'sticky', top: 76 }}>
            {NAV.map(({ label, items }) => (
              <div key={label} style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6, padding: '0 12px' }}>{label}</div>
                {items.map(({ id, l }) => (
                  <SidebarItem key={id} active={activeSection === id} onClick={() => setActiveSection(id)}>
                    {/* 개수는 손으로 적지 않는다 — registry 에 등재된 수가 그대로 나온다 */}
                    {isGroup(id) ? `${l} (${endpointsOf(id).length})` : l}
                  </SidebarItem>
                ))}
              </div>
            ))}
          </nav>
        </aside>

        <main style={{ flex: '999 1 480px', minWidth: 0 }}>
          {activeSection === 'start' && <StartSection onCopy={copy} copiedId={copiedId} brandName={brandName} />}
          {activeSection === 'demo' && <DemoSection />}
          {activeSection === 'errors' && <ErrorsSection onCopy={copy} copiedId={copiedId} />}
          {isGroup(activeSection) && (
            <GroupSection group={activeSection} baseUrl={base} onCopy={copy} copiedId={copiedId} />
          )}
        </main>
      </div>
    </div>
  )
}
