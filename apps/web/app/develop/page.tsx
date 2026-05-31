'use client'

import { useState, useCallback, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

type Section = 'overview' | 'auth' | 'products' | 'quote' | 'inventory' | 'fx' | 'suppliers' | 'market' | 'settings' | 'pool-stock' | 'accounts' | 'contacts' | 'deals' | 'demo' | 'errors'

function useOrigin(fallback = 'https://your-domain.com') {
  const [origin, setOrigin] = useState(fallback)
  useEffect(() => { setOrigin(window.location.origin) }, [])
  return origin
}

const EXAMPLE_KEY = 'ax_live_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4'

export default function DevelopPage() {
  const [activeSection, setActiveSection] = useState<Section>('overview')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [showDashboardLink, setShowDashboardLink] = useState(false)
  const [showApplyLink, setShowApplyLink] = useState(false)

  useEffect(() => {
    const sb = createClient()
    sb.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) {
        setShowApplyLink(true)
        return
      }
      const { data } = await sb.from('profiles').select('role').eq('id', user.id).single()
      const role = (data as { role?: string } | null)?.role
      if (role === 'admin' || role === 'member') {
        setShowDashboardLink(true)
      } else {
        // api_user: 이미 계정 있음 — 신청 불필요, 키 관리 페이지 링크
        setShowApplyLink(false)
      }
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

  const navSections: { id: Section; label: string }[] = [
    { id: 'overview', label: '개요' }, { id: 'auth', label: '인증' },
    { id: 'products', label: '제품' }, { id: 'quote', label: '견적' },
    { id: 'inventory', label: '재고' }, { id: 'fx', label: '환율' },
    { id: 'suppliers', label: '공급사' }, { id: 'market', label: '시장비교' },
    { id: 'settings', label: '가격설정' }, { id: 'pool-stock', label: '풀재고' },
    { id: 'accounts', label: '거래처' }, { id: 'contacts', label: '담당자' },
    { id: 'deals', label: '영업기회' }, { id: 'demo', label: '🧪 데모' },
    { id: 'errors', label: '오류 코드' },
  ]

  return (
    <div style={{ fontFamily: "'Inter', -apple-system, sans-serif", background: '#0a0a0f', minHeight: '100vh', color: '#e2e8f0' }}>
      <header style={{ borderBottom: '1px solid #1e293b', padding: '0 2rem', position: 'sticky', top: 0, background: 'rgba(10,10,15,0.95)', backdropFilter: 'blur(12px)', zIndex: 100 }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 60 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <a href="/home" style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: '#fff', textDecoration: 'none' }}>A</a>
            <span style={{ fontWeight: 700, fontSize: 16, color: '#f1f5f9' }}>AX API</span>
            <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 100, background: '#1e293b', color: '#6366f1', fontWeight: 600, letterSpacing: '0.05em' }}>v1</span>
          </div>
          <nav style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {navSections.map(({ id, label }) => (
              <button key={id} onClick={() => setActiveSection(id)}
                style={{ padding: '6px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500, background: activeSection === id ? '#1e293b' : 'transparent', color: activeSection === id ? '#e2e8f0' : '#64748b', transition: 'all .15s' }}>
                {label}
              </button>
            ))}
          </nav>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {showDashboardLink && (
              <a href="/home" style={{ padding: '6px 14px', borderRadius: 8, background: 'rgba(99,102,241,0.1)', color: '#a5b4fc', fontSize: 13, fontWeight: 500, textDecoration: 'none', border: '1px solid rgba(99,102,241,0.2)' }}>
                ← 대시보드
              </a>
            )}
            {showApplyLink && (
              <a href="/api-access" style={{ padding: '6px 14px', borderRadius: 8, background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: '#fff', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
                API 키 신청 →
              </a>
            )}
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '3rem 2rem', display: 'grid', gridTemplateColumns: '220px 1fr', gap: '3rem' }}>
        <aside>
          <nav style={{ position: 'sticky', top: 80 }}>
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>시작하기</div>
              {[{id:'overview' as Section,label:'개요'},{id:'auth' as Section,label:'인증'}].map(({id,label}) => (
                <SidebarItem key={id} active={activeSection===id} onClick={() => setActiveSection(id)}>{label}</SidebarItem>
              ))}
            </div>
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>GPU 가격</div>
              {([{id:'products',label:'제품 목록'},{id:'quote',label:'견적 계산'},{id:'inventory',label:'재고 조회'},{id:'fx',label:'환율'},{id:'suppliers',label:'공급사'},{id:'market',label:'시장 비교'},{id:'settings',label:'가격 설정'},{id:'pool-stock',label:'풀 재고'}] as {id:Section;label:string}[]).map(({id,label}) => (
                <SidebarItem key={id} active={activeSection===id} onClick={() => setActiveSection(id)}>{label}</SidebarItem>
              ))}
            </div>
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>CRM</div>
              {([{id:'accounts',label:'거래처'},{id:'contacts',label:'담당자'},{id:'deals',label:'영업기회'}] as {id:Section;label:string}[]).map(({id,label}) => (
                <SidebarItem key={id} active={activeSection===id} onClick={() => setActiveSection(id)}>{label}</SidebarItem>
              ))}
            </div>
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>체험</div>
              <SidebarItem active={activeSection==='demo'} onClick={() => setActiveSection('demo')}>🧪 라이브 데모</SidebarItem>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>참조</div>
              <SidebarItem active={activeSection==='errors'} onClick={() => setActiveSection('errors')}>오류 코드</SidebarItem>
            </div>
          </nav>
        </aside>

        <main style={{ minWidth: 0 }}>
          {activeSection === 'overview' && <OverviewSection onCopy={copy} copiedId={copiedId} />}
          {activeSection === 'auth' && <AuthSection exampleKey={EXAMPLE_KEY} onCopy={copy} copiedId={copiedId} />}
          {activeSection === 'products' && <ProductsSection exampleKey={EXAMPLE_KEY} onCopy={copy} copiedId={copiedId} />}
          {activeSection === 'quote' && <QuoteSection exampleKey={EXAMPLE_KEY} onCopy={copy} copiedId={copiedId} />}
          {activeSection === 'inventory' && <InventorySection exampleKey={EXAMPLE_KEY} onCopy={copy} copiedId={copiedId} />}
          {activeSection === 'fx' && <FxSection exampleKey={EXAMPLE_KEY} onCopy={copy} copiedId={copiedId} />}
          {activeSection === 'suppliers' && <SuppliersSection exampleKey={EXAMPLE_KEY} onCopy={copy} copiedId={copiedId} />}
          {activeSection === 'market' && <MarketSection exampleKey={EXAMPLE_KEY} onCopy={copy} copiedId={copiedId} />}
          {activeSection === 'settings' && <SettingsSection exampleKey={EXAMPLE_KEY} onCopy={copy} copiedId={copiedId} />}
          {activeSection === 'pool-stock' && <PoolStockSection exampleKey={EXAMPLE_KEY} onCopy={copy} copiedId={copiedId} />}
          {activeSection === 'accounts' && <AccountsSection exampleKey={EXAMPLE_KEY} onCopy={copy} copiedId={copiedId} />}
          {activeSection === 'contacts' && <ContactsSection exampleKey={EXAMPLE_KEY} onCopy={copy} copiedId={copiedId} />}
          {activeSection === 'deals' && <DealsSection exampleKey={EXAMPLE_KEY} onCopy={copy} copiedId={copiedId} />}
          {activeSection === 'demo' && <DemoSection />}
          {activeSection === 'errors' && <ErrorsSection />}
        </main>
      </div>
    </div>
  )
}

// ─── 공통 컴포넌트 ───────────────────────────────────────────────────────────

function SidebarItem({ children, active, onClick }: { children: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: active ? 600 : 400, background: active ? 'rgba(99,102,241,0.1)' : 'transparent', color: active ? '#a5b4fc' : '#64748b', borderLeft: active ? '2px solid #6366f1' : '2px solid transparent', marginBottom: 2, transition: 'all .15s' }}>
      {children}
    </button>
  )
}

function CodeBlock({ code, id, onCopy, copiedId }: { code: string; id: string; onCopy: (t: string, id: string) => void; copiedId: string | null }) {
  return (
    <div style={{ position: 'relative', background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <button onClick={() => onCopy(code, id)} style={{ position: 'absolute', top: 10, right: 10, padding: '4px 10px', borderRadius: 6, border: '1px solid #334155', background: '#1e293b', color: copiedId === id ? '#34d399' : '#94a3b8', fontSize: 12, cursor: 'pointer' }}>
        {copiedId === id ? '✓ 복사됨' : '복사'}
      </button>
      <pre style={{ margin: 0, padding: '1.25rem 1.5rem', fontSize: 13, lineHeight: 1.7, color: '#e2e8f0', overflowX: 'auto', whiteSpace: 'pre' }}>{code}</pre>
    </div>
  )
}

function Badge({ method }: { method: 'GET' | 'POST' | 'PATCH' | 'DELETE' }) {
  const colors: Record<string, string> = { GET: '#10b981', POST: '#6366f1', PATCH: '#f59e0b', DELETE: '#ef4444' }
  return <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, background: colors[method] + '22', color: colors[method], fontWeight: 700, fontSize: 12, fontFamily: 'monospace' }}>{method}</span>
}

function H1({ children }: { children: React.ReactNode }) {
  return <h1 style={{ fontSize: 32, fontWeight: 800, color: '#f1f5f9', marginBottom: 12, letterSpacing: '-0.02em' }}>{children}</h1>
}
function H2({ children }: { children: React.ReactNode }) {
  return <h2 style={{ fontSize: 20, fontWeight: 700, color: '#e2e8f0', marginBottom: 12, marginTop: 32, letterSpacing: '-0.01em' }}>{children}</h2>
}
function P({ children }: { children: React.ReactNode }) {
  return <p style={{ color: '#94a3b8', lineHeight: 1.7, fontSize: 15, marginBottom: 16 }}>{children}</p>
}
function ParamRow({ name, type, required, desc }: { name: string; type: string; required?: boolean; desc: string }) {
  return (
    <tr>
      <td style={{ padding: '10px 12px', borderBottom: '1px solid #1e293b' }}>
        <code style={{ color: '#a5b4fc', fontSize: 13 }}>{name}</code>
        {required && <span style={{ marginLeft: 6, fontSize: 11, color: '#ef4444', fontWeight: 600 }}>필수</span>}
      </td>
      <td style={{ padding: '10px 12px', borderBottom: '1px solid #1e293b', color: '#64748b', fontSize: 13 }}>{type}</td>
      <td style={{ padding: '10px 12px', borderBottom: '1px solid #1e293b', color: '#94a3b8', fontSize: 13 }}>{desc}</td>
    </tr>
  )
}

// ─── 섹션: 개요 ──────────────────────────────────────────────────────────────

function OverviewSection({ onCopy, copiedId }: { onCopy: (t: string, id: string) => void; copiedId: string | null }) {
  const origin = useOrigin()
  return (
    <div>
      {/* API 키 신청 CTA 배너 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'linear-gradient(135deg, rgba(99,102,241,0.12), rgba(139,92,246,0.08))', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 12, padding: '16px 24px', marginBottom: 32, gap: 16 }}>
        <div>
          <div style={{ fontWeight: 700, color: '#e2e8f0', fontSize: 14, marginBottom: 4 }}>AX API 사용을 시작하려면</div>
          <div style={{ color: '#94a3b8', fontSize: 13 }}>계정을 신청하면 담당자 승인 후 API 키를 발급받을 수 있습니다.</div>
        </div>
        <a href="/api-access" style={{ flexShrink: 0, padding: '8px 20px', borderRadius: 8, background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: '#fff', fontSize: 13, fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}>
          API 키 신청 →
        </a>
      </div>

      <div style={{ marginBottom: 32 }}>
        <div style={{ fontSize: 13, color: '#6366f1', fontWeight: 600, marginBottom: 8 }}>AX GPU 가격 API</div>
        <H1>개발자 문서</H1>
        <P>AX API는 GPU 실시간 가격 조회, 동적 견적 계산, 재고 가용성 데이터에 프로그래밍 방식으로 접근할 수 있게 해줍니다. 외부 시스템 연동, 견적 자동화, 워크플로에 GPU 가격 데이터를 직접 임베드하세요.</P>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 40 }}>
        {[
          { icon: '⚡', title: '실시간 가격', desc: '지속 업데이트되는 GPU 시장 가격' },
          { icon: '🔐', title: 'API Key 인증', desc: '안전한 키 기반 인증. 언제든 갱신 가능.' },
          { icon: '📊', title: '동적 견적', desc: '커스텀 마진으로 정확한 견적 계산' },
        ].map(({ icon, title, desc }) => (
          <div key={title} style={{ padding: '20px', background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10 }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>{icon}</div>
            <div style={{ fontWeight: 600, color: '#e2e8f0', marginBottom: 4, fontSize: 14 }}>{title}</div>
            <div style={{ color: '#64748b', fontSize: 13 }}>{desc}</div>
          </div>
        ))}
      </div>

      <H2>Base URL</H2>
      <CodeBlock id="baseurl" code={`${origin}/api/public/v1`} onCopy={onCopy} copiedId={copiedId} />

      <H2>빠른 시작</H2>
      <P>설정 페이지에서 API 키를 발급한 후 첫 번째 요청을 보내보세요:</P>
      <CodeBlock id="quickstart" onCopy={onCopy} copiedId={copiedId} code={`curl ${origin}/api/public/v1/products \\
  -H "X-API-Key: ax_live_여기에_키_입력"`} />

      <H2>요청 제한 (Rate Limits)</H2>
      <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: '#1e293b' }}>
              <th style={{ padding: '10px 16px', textAlign: 'left', color: '#94a3b8', fontWeight: 600, fontSize: 12 }}>플랜</th>
              <th style={{ padding: '10px 16px', textAlign: 'left', color: '#94a3b8', fontWeight: 600, fontSize: 12 }}>요청 제한</th>
              <th style={{ padding: '10px 16px', textAlign: 'left', color: '#94a3b8', fontWeight: 600, fontSize: 12 }}>최대 키 수</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ padding: '10px 16px', borderBottom: '1px solid #1e293b', color: '#e2e8f0' }}>기본</td>
              <td style={{ padding: '10px 16px', borderBottom: '1px solid #1e293b', color: '#64748b' }}>분당 60회</td>
              <td style={{ padding: '10px 16px', borderBottom: '1px solid #1e293b', color: '#64748b' }}>10개</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── 섹션: 인증 ──────────────────────────────────────────────────────────────

function AuthSection({ exampleKey, onCopy, copiedId }: { exampleKey: string; onCopy: (t: string, id: string) => void; copiedId: string | null }) {
  const origin = useOrigin()
  return (
    <div>
      <H1>인증</H1>
      <P>모든 API 요청에는 유효한 API 키가 필요합니다. AX 대시보드의 <strong style={{ color: '#e2e8f0' }}>설정 → API Keys</strong> 섹션에서 키를 발급받으세요.</P>

      <H2>X-API-Key 헤더</H2>
      <P><code style={{ color: '#a5b4fc', background: '#1e293b', padding: '1px 6px', borderRadius: 4 }}>X-API-Key</code> 헤더로 키를 전달하세요:</P>
      <CodeBlock id="auth-curl" onCopy={onCopy} copiedId={copiedId} code={`curl ${origin}/api/public/v1/products \\
  -H "X-API-Key: ${exampleKey}"`} />

      <P>Bearer 토큰 방식도 지원됩니다:</P>
      <CodeBlock id="auth-bearer" onCopy={onCopy} copiedId={copiedId} code={`curl ${origin}/api/public/v1/products \\
  -H "Authorization: Bearer ${exampleKey}"`} />

      <H2>JavaScript / TypeScript</H2>
      <CodeBlock id="auth-js" onCopy={onCopy} copiedId={copiedId} code={`const API_KEY = process.env.AX_API_KEY

const res = await fetch('${origin}/api/public/v1/products', {
  headers: {
    'X-API-Key': API_KEY,
    'Content-Type': 'application/json',
  },
})
const data = await res.json()`} />

      <H2>Python</H2>
      <CodeBlock id="auth-py" onCopy={onCopy} copiedId={copiedId} code={`import requests

headers = {'X-API-Key': 'ax_live_여기에_키_입력'}
res = requests.get('${origin}/api/public/v1/products', headers=headers)
data = res.json()`} />

      <div style={{ padding: '16px 20px', background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, marginTop: 24 }}>
        <div style={{ fontWeight: 600, color: '#ef4444', marginBottom: 6, fontSize: 14 }}>⚠️ 보안 주의</div>
        <p style={{ color: '#94a3b8', fontSize: 13, margin: 0, lineHeight: 1.6 }}>
          API 키를 클라이언트 코드나 공개 저장소에 절대 노출하지 마세요. 환경 변수를 사용하세요.
          키가 유출된 경우 설정에서 즉시 폐기하고 새 키를 발급하세요.
        </p>
      </div>
    </div>
  )
}

// ─── 섹션: 제품 ──────────────────────────────────────────────────────────────

function ProductsSection({ exampleKey, onCopy, copiedId }: { exampleKey: string; onCopy: (t: string, id: string) => void; copiedId: string | null }) {
  const origin = useOrigin()
  return (
    <div>
      <H1>제품 목록</H1>
      <P>실시간 가격 데이터가 포함된 GPU 제품 카탈로그를 조회합니다.</P>

      <div style={{ border: '1px solid #1e293b', borderRadius: 10, padding: '20px 24px', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <Badge method="GET" />
          <code style={{ fontSize: 14, color: '#e2e8f0', background: '#0f172a', padding: '4px 12px', borderRadius: 6, border: '1px solid #1e293b' }}>/api/public/v1/products</code>
        </div>
        <P>모든 GPU 제품의 현재 가격, 공급사 정보, 가용 여부를 반환합니다.</P>
        <CodeBlock id="products-curl" onCopy={onCopy} copiedId={copiedId} code={`curl ${origin}/api/public/v1/products \\
  -H "X-API-Key: ${exampleKey}"`} />
        <div style={{ fontWeight: 600, color: '#e2e8f0', marginBottom: 8, fontSize: 14 }}>응답 예시</div>
        <CodeBlock id="products-resp" onCopy={onCopy} copiedId={copiedId} code={`{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "model_name": "H100 SXM5",
      "tier": 1,
      "memory": "80GB",
      "gpu_count": 1,
      "pricing_mode": "dynamic",
      "price_per_unit_usd": 34500.00,
      "price_per_unit_krw": 48300000,
      "supplier": "NVIDIA 파트너",
      "valid_until": "2026-06-30T00:00:00Z",
      "available": true
    }
  ],
  "meta": { "total": 156, "currency": "USD", "fx_usd_krw": 1400 }
}`} />
      </div>

      <div style={{ border: '1px solid #1e293b', borderRadius: 10, padding: '20px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <Badge method="GET" />
          <code style={{ fontSize: 14, color: '#e2e8f0', background: '#0f172a', padding: '4px 12px', borderRadius: 6, border: '1px solid #1e293b' }}>/api/public/v1/products/{'{id}'}</code>
        </div>
        <P>단일 GPU 제품의 상세 가격 및 공급사 정보를 반환합니다.</P>
        <CodeBlock id="product-single" onCopy={onCopy} copiedId={copiedId} code={`curl ${origin}/api/public/v1/products/product-uuid-here \\
  -H "X-API-Key: ${exampleKey}"`} />
      </div>
    </div>
  )
}

// ─── 섹션: 견적 ──────────────────────────────────────────────────────────────

function QuoteSection({ exampleKey, onCopy, copiedId }: { exampleKey: string; onCopy: (t: string, id: string) => void; copiedId: string | null }) {
  const origin = useOrigin()
  return (
    <div>
      <H1>견적 계산</H1>
      <P>여러 GPU 제품에 대한 상세 견적을 계산합니다. 제품별 커스텀 마진 설정과 USD/KRW 통화 선택이 지원됩니다.</P>

      <div style={{ border: '1px solid #1e293b', borderRadius: 10, padding: '20px 24px', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <Badge method="POST" />
          <code style={{ fontSize: 14, color: '#e2e8f0', background: '#0f172a', padding: '4px 12px', borderRadius: 6, border: '1px solid #1e293b' }}>/api/public/v1/quote</code>
        </div>
        <P>하나 이상의 GPU 제품에 대한 견적을 계산합니다. 제품별 마진 오버라이드가 지원됩니다.</P>

        <div style={{ fontWeight: 600, color: '#e2e8f0', marginBottom: 8, fontSize: 14 }}>요청 바디</div>
        <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, overflow: 'hidden', marginBottom: 16 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#1e293b' }}>
              <th style={{ padding: '8px 12px', textAlign: 'left', color: '#64748b', fontSize: 12 }}>필드</th>
              <th style={{ padding: '8px 12px', textAlign: 'left', color: '#64748b', fontSize: 12 }}>타입</th>
              <th style={{ padding: '8px 12px', textAlign: 'left', color: '#64748b', fontSize: 12 }}>설명</th>
            </tr></thead>
            <tbody>
              <ParamRow name="items" type="배열" required desc="견적 항목 목록 (1~50개)" />
              <ParamRow name="items[].product_id" type="string (UUID)" required desc="GPU 제품 UUID" />
              <ParamRow name="items[].quantity" type="정수" required desc="수량 (1~10,000)" />
              <ParamRow name="items[].custom_margin_pct" type="숫자" desc="마진율 오버라이드 (0~200%). 미지정 시 시스템 기본값 적용" />
              <ParamRow name="currency" type="'USD' | 'KRW'" desc="출력 통화. 기본값: USD" />
            </tbody>
          </table>
        </div>

        <CodeBlock id="quote-curl" onCopy={onCopy} copiedId={copiedId} code={`curl -X POST ${origin}/api/public/v1/quote \\
  -H "X-API-Key: ${exampleKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "items": [
      { "product_id": "uuid-here", "quantity": 4 },
      { "product_id": "uuid-here-2", "quantity": 8, "custom_margin_pct": 20 }
    ],
    "currency": "KRW"
  }'`} />

        <div style={{ fontWeight: 600, color: '#e2e8f0', marginBottom: 8, fontSize: 14 }}>응답 예시</div>
        <CodeBlock id="quote-resp" onCopy={onCopy} copiedId={copiedId} code={`{
  "success": true,
  "data": {
    "items": [
      {
        "model_name": "A100 40GB",
        "quantity": 4,
        "unit_price_usd": 2.30,
        "unit_price_krw": 3463,
        "total_usd": 9.20,
        "total_krw": 13853,
        "margin_pct": 18,
        "available": true
      }
    ],
    "summary": {
      "subtotal_usd": 9.20,
      "subtotal_krw": 13853,
      "currency": "KRW",
      "total": 13853,
      "fx_usd_krw": 1505.8,
      "quoted_at": "2026-05-31T10:00:00.000Z"
    }
  }
}`} />
      </div>
    </div>
  )
}

// ─── 섹션: 재고 ──────────────────────────────────────────────────────────────

function InventorySection({ exampleKey, onCopy, copiedId }: { exampleKey: string; onCopy: (t: string, id: string) => void; copiedId: string | null }) {
  const origin = useOrigin()
  return (
    <div>
      <H1>재고 조회</H1>
      <P>GPU 제품의 실시간 재고 수량과 가용 여부를 확인합니다.</P>

      <div style={{ border: '1px solid #1e293b', borderRadius: 10, padding: '20px 24px', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <Badge method="GET" />
          <code style={{ fontSize: 14, color: '#e2e8f0', background: '#0f172a', padding: '4px 12px', borderRadius: 6, border: '1px solid #1e293b' }}>/api/public/v1/inventory</code>
        </div>
        <P>모든 GPU 제품의 현재 재고 수량과 가용 여부를 반환합니다.</P>
        <CodeBlock id="inv-curl" onCopy={onCopy} copiedId={copiedId} code={`curl ${origin}/api/public/v1/inventory \\
  -H "X-API-Key: ${exampleKey}"`} />
        <div style={{ fontWeight: 600, color: '#e2e8f0', marginBottom: 8, fontSize: 14 }}>응답 예시</div>
        <CodeBlock id="inv-resp" onCopy={onCopy} copiedId={copiedId} code={`{
  "success": true,
  "data": [
    {
      "product_id": "uuid",
      "model_name": "RTX 5090",
      "tier": 3,
      "memory": "32GB",
      "available_qty": 55,
      "in_stock": true,
      "updated_at": "2026-05-31T08:00:00Z"
    }
  ],
  "meta": { "total": 1, "as_of": "2026-05-31T10:00:00.000Z" }
}`} />
      </div>
    </div>
  )
}

// ─── 섹션: 라이브 데모 ───────────────────────────────────────────────────────

function DemoSection() {
  const [apiKey, setApiKey] = useState('')
  const [result, setResult] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [activeDemo, setActiveDemo] = useState<string | null>(null)

  const origin = useOrigin('')

  const run = useCallback(async (label: string, fn: () => Promise<Response>) => {
    if (!apiKey.trim()) { setResult('❌ API 키를 입력해주세요'); return }
    setLoading(true); setActiveDemo(label); setResult(null)
    try {
      const res = await fn()
      const json = await res.json()
      setResult(JSON.stringify(json, null, 2))
    } catch (e) {
      setResult(`❌ 오류: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setLoading(false)
    }
  }, [apiKey, origin])

  const demos = [
    {
      label: '제품 목록 조회',
      emoji: '📦',
      desc: '전체 GPU 제품과 실시간 가격 반환',
      fn: () => fetch(`${origin}/api/public/v1/products`, { headers: { 'X-API-Key': apiKey } }),
    },
    {
      label: '재고 현황',
      emoji: '🏭',
      desc: '가용 재고 수량 실시간 조회',
      fn: () => fetch(`${origin}/api/public/v1/inventory`, { headers: { 'X-API-Key': apiKey } }),
    },
    {
      label: '견적 계산 (A100 × 4)',
      emoji: '🧮',
      desc: 'A100 40GB 4장 기본 마진 견적',
      fn: async () => {
        // 먼저 제품 목록에서 A100 ID를 가져온다
        const pr = await fetch(`${origin}/api/public/v1/products`, { headers: { 'X-API-Key': apiKey } })
        const pd = await pr.json()
        const a100 = (pd.data ?? []).find((p: { model_name: string }) => p.model_name.includes('A100') && p.model_name.includes('40'))
        if (!a100) return new Response(JSON.stringify({ success: false, error: 'A100 40GB 제품을 찾을 수 없습니다' }))
        return fetch(`${origin}/api/public/v1/quote`, {
          method: 'POST',
          headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: [{ product_id: a100.id, quantity: 4 }], currency: 'KRW' }),
        })
      },
    },
    {
      label: '마진 20% 견적',
      emoji: '💰',
      desc: '커스텀 마진 20% 적용 견적',
      fn: async () => {
        const pr = await fetch(`${origin}/api/public/v1/products`, { headers: { 'X-API-Key': apiKey } })
        const pd = await pr.json()
        const available = (pd.data ?? []).filter((p: { available: boolean }) => p.available).slice(0, 2)
        if (!available.length) return new Response(JSON.stringify({ success: false, error: '가용 제품 없음' }))
        return fetch(`${origin}/api/public/v1/quote`, {
          method: 'POST',
          headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: available.map((p: { id: string }) => ({ product_id: p.id, quantity: 2, custom_margin_pct: 20 })), currency: 'USD' }),
        })
      },
    },
  ]

  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <div style={{ fontSize: 13, color: '#6366f1', fontWeight: 600, marginBottom: 8 }}>🧪 인터랙티브 데모</div>
        <H1>라이브 API 테스트</H1>
        <P>실제 API 키를 입력하고 버튼을 눌러 즉시 테스트해보세요. 모든 요청은 실제 데이터를 반환합니다.</P>
      </div>

      {/* API Key 입력 */}
      <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: '20px 24px', marginBottom: 28 }}>
        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#94a3b8', marginBottom: 8 }}>API Key</label>
        <div style={{ display: 'flex', gap: 10 }}>
          <input
            type="text"
            placeholder="ax_live_..."
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            style={{ flex: 1, padding: '10px 14px', borderRadius: 8, border: '1px solid #334155', background: '#1e293b', color: '#e2e8f0', fontSize: 14, outline: 'none', fontFamily: 'monospace' }}
          />
          <a href="/api-keys" style={{ padding: '10px 16px', borderRadius: 8, background: 'rgba(99,102,241,0.1)', color: '#a5b4fc', fontSize: 13, fontWeight: 500, textDecoration: 'none', border: '1px solid rgba(99,102,241,0.2)', display: 'flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
            키 발급 →
          </a>
        </div>
        {!apiKey && (
          <p style={{ fontSize: 12, color: '#475569', margin: '8px 0 0' }}>API Keys 페이지에서 키를 발급한 후 붙여넣으세요.</p>
        )}
      </div>

      {/* 데모 버튼 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 28 }}>
        {demos.map(({ label, emoji, desc, fn }) => (
          <button
            key={label}
            onClick={() => run(label, fn)}
            disabled={loading && activeDemo === label}
            style={{
              padding: '16px 20px', borderRadius: 10, border: '1px solid #1e293b',
              background: activeDemo === label && loading ? '#1e293b' : '#0f172a',
              color: '#e2e8f0', cursor: loading && activeDemo === label ? 'wait' : 'pointer',
              textAlign: 'left', transition: 'all .15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#6366f1'; e.currentTarget.style.background = 'rgba(99,102,241,0.05)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = '#1e293b'; e.currentTarget.style.background = activeDemo === label && loading ? '#1e293b' : '#0f172a' }}
          >
            <div style={{ fontSize: 22, marginBottom: 6 }}>{loading && activeDemo === label ? '⏳' : emoji}</div>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 12, color: '#64748b' }}>{desc}</div>
          </button>
        ))}
      </div>

      {/* 결과 */}
      {result !== null && (
        <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '12px 20px', background: '#1e293b', borderBottom: '1px solid #0f172a', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#94a3b8' }}>응답 — {activeDemo}</span>
            <button
              onClick={() => { try { navigator.clipboard.writeText(result) } catch {} }}
              style={{ padding: '3px 10px', borderRadius: 6, border: '1px solid #334155', background: '#0f172a', color: '#64748b', fontSize: 12, cursor: 'pointer' }}
            >
              복사
            </button>
          </div>
          <pre style={{ margin: 0, padding: '1.25rem 1.5rem', fontSize: 13, lineHeight: 1.7, color: result.startsWith('❌') ? '#ef4444' : '#e2e8f0', overflowX: 'auto', maxHeight: 500, overflowY: 'auto' }}>
            {result}
          </pre>
        </div>
      )}
    </div>
  )
}

// ─── 섹션: 환율 ──────────────────────────────────────────────────────────────

function FxSection({ exampleKey, onCopy, copiedId }: { exampleKey: string; onCopy: (t: string, id: string) => void; copiedId: string | null }) {
  const origin = useOrigin()
  return (
    <div>
      <H1>환율 (FX Rates)</H1>
      <P>최근 환율 이력을 조회합니다. 가격 계산에 사용되는 USD/KRW 환율 데이터입니다.</P>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Badge method="GET" />
        <code style={{ color: '#a5b4fc', fontSize: 14 }}>/fx</code>
      </div>
      <CodeBlock id="fx-get" onCopy={onCopy} copiedId={copiedId} code={`curl ${origin}/api/public/v1/fx \\
  -H "X-API-Key: ${exampleKey}"`} />

      <H2>응답</H2>
      <CodeBlock id="fx-resp" onCopy={onCopy} copiedId={copiedId} code={`{
  "success": true,
  "data": [
    { "rate_date": "2026-05-31", "usd_krw": 1505.8, "source": "koreaexim" },
    ...
  ],
  "meta": { "total": 7 }
}`} />
    </div>
  )
}

// ─── 섹션: 공급사 ─────────────────────────────────────────────────────────────

function SuppliersSection({ exampleKey, onCopy, copiedId }: { exampleKey: string; onCopy: (t: string, id: string) => void; copiedId: string | null }) {
  const origin = useOrigin()
  return (
    <div>
      <H1>공급사 (Suppliers)</H1>
      <P>GPU 공급사 목록과 통계(활성 견적 수, 최저가 달성 수, 마지막 견적 수신일)를 조회합니다.</P>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Badge method="GET" />
        <code style={{ color: '#a5b4fc', fontSize: 14 }}>/suppliers</code>
      </div>
      <CodeBlock id="sup-get" onCopy={onCopy} copiedId={copiedId} code={`curl ${origin}/api/public/v1/suppliers \\
  -H "X-API-Key: ${exampleKey}"`} />

      <H2>공급사 등록</H2>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Badge method="POST" />
        <code style={{ color: '#a5b4fc', fontSize: 14 }}>/suppliers</code>
      </div>
      <CodeBlock id="sup-post" onCopy={onCopy} copiedId={copiedId} code={`curl -X POST ${origin}/api/public/v1/suppliers \\
  -H "X-API-Key: ${exampleKey}" \\
  -H "Content-Type: application/json" \\
  -d '{ "name": "ABC Corp", "location": "서울", "contact": "010-1234-5678" }'`} />

      <H2>요청 바디 (POST)</H2>
      <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead><tr style={{ background: '#1e293b' }}>
            <th style={{ padding: '10px 16px', textAlign: 'left', color: '#94a3b8', fontSize: 12 }}>필드</th>
            <th style={{ padding: '10px 16px', textAlign: 'left', color: '#94a3b8', fontSize: 12 }}>타입</th>
            <th style={{ padding: '10px 16px', textAlign: 'left', color: '#94a3b8', fontSize: 12 }}>설명</th>
          </tr></thead>
          <tbody>
            <ParamRow name="name" type="string" required desc="공급사 이름" />
            <ParamRow name="location" type="string" desc="위치 (선택)" />
            <ParamRow name="contact" type="string" desc="연락처 (선택)" />
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── 섹션: 시장 비교 ──────────────────────────────────────────────────────────

function MarketSection({ exampleKey, onCopy, copiedId }: { exampleKey: string; onCopy: (t: string, id: string) => void; copiedId: string | null }) {
  const origin = useOrigin()
  return (
    <div>
      <H1>시장 비교 (Market)</H1>
      <P>경쟁사 가격과 자사 가격을 비교한 시장 분석 데이터를 반환합니다. 전략 설정, 공급 이력, 신선도 정보를 포함합니다.</P>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Badge method="GET" />
        <code style={{ color: '#a5b4fc', fontSize: 14 }}>/market</code>
      </div>
      <CodeBlock id="mkt-get" onCopy={onCopy} copiedId={copiedId} code={`curl ${origin}/api/public/v1/market \\
  -H "X-API-Key: ${exampleKey}"`} />

      <H2>응답 구조</H2>
      <CodeBlock id="mkt-resp" onCopy={onCopy} copiedId={copiedId} code={`{
  "success": true,
  "data": {
    "competitors": [...],
    "products": [
      {
        "product": { "id": "...", "model_name": "H100 SXM5", ... },
        "competitors": [
          { "competitor": {...}, "price_usd": 3.2, "is_fresh": true, ... }
        ],
        "our_price_usd": 2.95,
        "market_min": 2.8,
        "market_max": 3.5,
        "market_median": 3.1,
        "strategy": { "edge_pct_normal": 3, ... },
        "supply_history": { "median_usd": 2.4, ... }
      }
    ],
    "usd_krw": 1505.8,
    "summary": { "low_count": 5, "mid_count": 10, "high_count": 2, "competitor_count": 12 }
  }
}`} />
    </div>
  )
}

// ─── 섹션: 가격 설정 ──────────────────────────────────────────────────────────

function SettingsSection({ exampleKey, onCopy, copiedId }: { exampleKey: string; onCopy: (t: string, id: string) => void; copiedId: string | null }) {
  const origin = useOrigin()
  return (
    <div>
      <H1>가격 설정 (Settings)</H1>
      <P>전역 마진율과 최신 환율 정보를 조회하거나 업데이트합니다.</P>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Badge method="GET" />
        <code style={{ color: '#a5b4fc', fontSize: 14 }}>/settings</code>
      </div>
      <CodeBlock id="set-get" onCopy={onCopy} copiedId={copiedId} code={`curl ${origin}/api/public/v1/settings \\
  -H "X-API-Key: ${exampleKey}"`} />

      <H2>마진율 업데이트</H2>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Badge method="PATCH" />
        <code style={{ color: '#a5b4fc', fontSize: 14 }}>/settings</code>
      </div>
      <CodeBlock id="set-patch" onCopy={onCopy} copiedId={copiedId} code={`curl -X PATCH ${origin}/api/public/v1/settings \\
  -H "X-API-Key: ${exampleKey}" \\
  -H "Content-Type: application/json" \\
  -d '{ "margin_pct": 20 }'`} />

      <H2>응답</H2>
      <CodeBlock id="set-resp" onCopy={onCopy} copiedId={copiedId} code={`{
  "success": true,
  "data": {
    "margin_pct": 18,
    "usd_krw": 1505.8,
    "fx_date": "2026-05-31",
    "updated_at": "2026-05-31T00:00:00Z",
    "updated_by": "admin@example.com"
  }
}`} />
    </div>
  )
}

// ─── 섹션: 풀 재고 ───────────────────────────────────────────────────────────

function PoolStockSection({ exampleKey, onCopy, copiedId }: { exampleKey: string; onCopy: (t: string, id: string) => void; copiedId: string | null }) {
  const origin = useOrigin()
  return (
    <div>
      <H1>풀 재고 (Pool Stock)</H1>
      <P>직접 공급 풀(Tier 3)의 재고 수량을 조회하거나 업데이트합니다.</P>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Badge method="GET" />
        <code style={{ color: '#a5b4fc', fontSize: 14 }}>/pool-stock</code>
      </div>
      <CodeBlock id="ps-get" onCopy={onCopy} copiedId={copiedId} code={`# 전체 조회
curl ${origin}/api/public/v1/pool-stock \\
  -H "X-API-Key: ${exampleKey}"

# 특정 제품 조회
curl "${origin}/api/public/v1/pool-stock?product_id=PRODUCT_ID" \\
  -H "X-API-Key: ${exampleKey}"`} />

      <H2>재고 업데이트</H2>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Badge method="POST" />
        <code style={{ color: '#a5b4fc', fontSize: 14 }}>/pool-stock</code>
      </div>
      <CodeBlock id="ps-post" onCopy={onCopy} copiedId={copiedId} code={`curl -X POST ${origin}/api/public/v1/pool-stock \\
  -H "X-API-Key: ${exampleKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "product_id": "PRODUCT_ID",
    "pool_qty": 10,
    "sell_price_krw": 5000000,
    "note": "5월 입고분"
  }'`} />

      <H2>요청 바디 (POST)</H2>
      <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead><tr style={{ background: '#1e293b' }}>
            <th style={{ padding: '10px 16px', textAlign: 'left', color: '#94a3b8', fontSize: 12 }}>필드</th>
            <th style={{ padding: '10px 16px', textAlign: 'left', color: '#94a3b8', fontSize: 12 }}>타입</th>
            <th style={{ padding: '10px 16px', textAlign: 'left', color: '#94a3b8', fontSize: 12 }}>설명</th>
          </tr></thead>
          <tbody>
            <ParamRow name="product_id" type="string (UUID)" required desc="GPU 제품 ID" />
            <ParamRow name="pool_qty" type="number" required desc="재고 수량 (0 이상)" />
            <ParamRow name="sell_price_krw" type="number" desc="판매가 KRW (선택 — 입력 시 direct_prices도 업데이트)" />
            <ParamRow name="note" type="string" desc="메모 (선택)" />
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── 섹션: 거래처 ─────────────────────────────────────────────────────────────

function AccountsSection({ exampleKey, onCopy, copiedId }: { exampleKey: string; onCopy: (t: string, id: string) => void; copiedId: string | null }) {
  const origin = useOrigin()
  return (
    <div>
      <H1>거래처 (Accounts)</H1>
      <P>CRM 거래처 데이터를 CRUD합니다. 커서 기반 페이지네이션과 필터를 지원합니다.</P>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Badge method="GET" />
        <code style={{ color: '#a5b4fc', fontSize: 14 }}>/accounts</code>
      </div>
      <CodeBlock id="acc-get" onCopy={onCopy} copiedId={copiedId} code={`# 목록 조회 (커서 페이지네이션)
curl "${origin}/api/public/v1/accounts?sort=name&dir=asc" \\
  -H "X-API-Key: ${exampleKey}"

# 검색
curl "${origin}/api/public/v1/accounts?search=삼성&segment=T1" \\
  -H "X-API-Key: ${exampleKey}"

# 단건 조회
curl ${origin}/api/public/v1/accounts/ACCOUNT_ID \\
  -H "X-API-Key: ${exampleKey}"`} />

      <H2>거래처 생성</H2>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Badge method="POST" />
        <code style={{ color: '#a5b4fc', fontSize: 14 }}>/accounts</code>
      </div>
      <CodeBlock id="acc-post" onCopy={onCopy} copiedId={copiedId} code={`curl -X POST ${origin}/api/public/v1/accounts \\
  -H "X-API-Key: ${exampleKey}" \\
  -H "Content-Type: application/json" \\
  -d '{ "name": "주식회사 테스트", "industry": "IT", "segment": "T2", "region": "서울" }'`} />

      <H2>거래처 수정 / 삭제</H2>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
        <Badge method="PATCH" />
        <Badge method="DELETE" />
        <code style={{ color: '#a5b4fc', fontSize: 14 }}>/accounts/{'{id}'}</code>
      </div>
      <CodeBlock id="acc-patch" onCopy={onCopy} copiedId={copiedId} code={`# 수정
curl -X PATCH ${origin}/api/public/v1/accounts/ACCOUNT_ID \\
  -H "X-API-Key: ${exampleKey}" \\
  -H "Content-Type: application/json" \\
  -d '{ "description": "중요 고객", "fit_score": 85 }'

# 삭제
curl -X DELETE ${origin}/api/public/v1/accounts/ACCOUNT_ID \\
  -H "X-API-Key: ${exampleKey}"`} />

      <H2>쿼리 파라미터 (GET 목록)</H2>
      <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead><tr style={{ background: '#1e293b' }}>
            <th style={{ padding: '10px 16px', textAlign: 'left', color: '#94a3b8', fontSize: 12 }}>파라미터</th>
            <th style={{ padding: '10px 16px', textAlign: 'left', color: '#94a3b8', fontSize: 12 }}>타입</th>
            <th style={{ padding: '10px 16px', textAlign: 'left', color: '#94a3b8', fontSize: 12 }}>설명</th>
          </tr></thead>
          <tbody>
            <ParamRow name="cursor" type="string" desc="다음 페이지 커서 (이전 응답의 nextCursor 값)" />
            <ParamRow name="search" type="string" desc="거래처명 검색" />
            <ParamRow name="segment" type="string" desc="세그먼트 필터 (T1, T2, 공공, ...)" />
            <ParamRow name="industry" type="string" desc="업종 필터 (부분 일치)" />
            <ParamRow name="region" type="string" desc="지역 필터 (부분 일치)" />
            <ParamRow name="sort" type="string" desc="정렬 필드: created_at, name, fit_score, industry, region" />
            <ParamRow name="dir" type="asc | desc" desc="정렬 방향 (기본: desc)" />
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── 섹션: 담당자 ─────────────────────────────────────────────────────────────

function ContactsSection({ exampleKey, onCopy, copiedId }: { exampleKey: string; onCopy: (t: string, id: string) => void; copiedId: string | null }) {
  const origin = useOrigin()
  return (
    <div>
      <H1>담당자 (Contacts)</H1>
      <P>거래처 담당자를 조회하거나 등록합니다.</P>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Badge method="GET" />
        <code style={{ color: '#a5b4fc', fontSize: 14 }}>/contacts</code>
      </div>
      <CodeBlock id="con-get" onCopy={onCopy} copiedId={copiedId} code={`curl "${origin}/api/public/v1/contacts?search=김" \\
  -H "X-API-Key: ${exampleKey}"

# 단건 조회
curl ${origin}/api/public/v1/contacts/CONTACT_ID \\
  -H "X-API-Key: ${exampleKey}"`} />

      <H2>담당자 생성</H2>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Badge method="POST" />
        <code style={{ color: '#a5b4fc', fontSize: 14 }}>/contacts</code>
      </div>
      <CodeBlock id="con-post" onCopy={onCopy} copiedId={copiedId} code={`curl -X POST ${origin}/api/public/v1/contacts \\
  -H "X-API-Key: ${exampleKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "홍길동",
    "email": "hong@example.com",
    "title": "CTO",
    "account_id": "ACCOUNT_ID"
  }'`} />

      <H2>담당자 수정 / 삭제</H2>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
        <Badge method="PATCH" />
        <Badge method="DELETE" />
        <code style={{ color: '#a5b4fc', fontSize: 14 }}>/contacts/{'{id}'}</code>
      </div>
      <CodeBlock id="con-patch" onCopy={onCopy} copiedId={copiedId} code={`curl -X PATCH ${origin}/api/public/v1/contacts/CONTACT_ID \\
  -H "X-API-Key: ${exampleKey}" \\
  -H "Content-Type: application/json" \\
  -d '{ "title": "CEO", "phone": "010-1234-5678" }'`} />
    </div>
  )
}

// ─── 섹션: 영업기회 ──────────────────────────────────────────────────────────

function DealsSection({ exampleKey, onCopy, copiedId }: { exampleKey: string; onCopy: (t: string, id: string) => void; copiedId: string | null }) {
  const origin = useOrigin()
  return (
    <div>
      <H1>영업기회 (Deals)</H1>
      <P>영업기회를 조회하거나 등록합니다. 스테이지를 변경하면 성공 확률이 자동 계산됩니다.</P>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Badge method="GET" />
        <code style={{ color: '#a5b4fc', fontSize: 14 }}>/deals</code>
      </div>
      <CodeBlock id="dea-get" onCopy={onCopy} copiedId={copiedId} code={`curl "${origin}/api/public/v1/deals?stage=PoC" \\
  -H "X-API-Key: ${exampleKey}"

# 단건 조회
curl ${origin}/api/public/v1/deals/DEAL_ID \\
  -H "X-API-Key: ${exampleKey}"`} />

      <H2>영업기회 생성</H2>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Badge method="POST" />
        <code style={{ color: '#a5b4fc', fontSize: 14 }}>/deals</code>
      </div>
      <CodeBlock id="dea-post" onCopy={onCopy} copiedId={copiedId} code={`curl -X POST ${origin}/api/public/v1/deals \\
  -H "X-API-Key: ${exampleKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "title": "H100 임대 계약",
    "account_id": "ACCOUNT_ID",
    "value": 50000000,
    "stage": "컨택"
  }'`} />

      <H2>스테이지 → 확률 자동 변환</H2>
      <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10, overflow: 'hidden', marginBottom: 24 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead><tr style={{ background: '#1e293b' }}>
            <th style={{ padding: '10px 16px', textAlign: 'left', color: '#94a3b8', fontSize: 12 }}>stage</th>
            <th style={{ padding: '10px 16px', textAlign: 'left', color: '#94a3b8', fontSize: 12 }}>probability</th>
          </tr></thead>
          <tbody>
            {[['신규','5%'],['검증','15%'],['컨택','30%'],['PoC','50%'],['제안','65%'],['협상','80%'],['수주','100%'],['실패','0%']].map(([s,p]) => (
              <tr key={s}>
                <td style={{ padding: '8px 16px', borderBottom: '1px solid #1e293b' }}><code style={{ color: '#a5b4fc' }}>{s}</code></td>
                <td style={{ padding: '8px 16px', borderBottom: '1px solid #1e293b', color: '#64748b' }}>{p}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <H2>영업기회 수정 / 삭제</H2>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
        <Badge method="PATCH" />
        <Badge method="DELETE" />
        <code style={{ color: '#a5b4fc', fontSize: 14 }}>/deals/{'{id}'}</code>
      </div>
      <CodeBlock id="dea-patch" onCopy={onCopy} copiedId={copiedId} code={`curl -X PATCH ${origin}/api/public/v1/deals/DEAL_ID \\
  -H "X-API-Key: ${exampleKey}" \\
  -H "Content-Type: application/json" \\
  -d '{ "stage": "제안", "value": 80000000 }'`} />
    </div>
  )
}

// ─── 섹션: 오류 코드 ─────────────────────────────────────────────────────────

function ErrorsSection() {
  const errors = [
    { code: 401, name: '인증 오류', desc: 'API 키가 없거나 유효하지 않습니다.' },
    { code: 403, name: '접근 거부', desc: 'API 키가 폐기되었습니다.' },
    { code: 404, name: '찾을 수 없음', desc: '요청한 리소스가 존재하지 않습니다.' },
    { code: 400, name: '잘못된 요청', desc: '요청 바디가 유효하지 않습니다. 검증 오류를 확인하세요.' },
    { code: 429, name: '요청 초과', desc: '요청 제한을 초과했습니다. 잠시 후 다시 시도하세요.' },
    { code: 500, name: '서버 오류', desc: '예상치 못한 서버 오류가 발생했습니다.' },
  ]

  return (
    <div>
      <H1>오류 코드</H1>
      <P>모든 오류는 <code style={{ color: '#a5b4fc', background: '#1e293b', padding: '1px 6px', borderRadius: 4 }}>success: false</code> 플래그와 <code style={{ color: '#a5b4fc', background: '#1e293b', padding: '1px 6px', borderRadius: 4 }}>error</code> 메시지를 포함합니다.</P>

      <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10, padding: '1.25rem 1.5rem', marginBottom: 24 }}>
        <pre style={{ margin: 0, fontSize: 13, color: '#e2e8f0' }}>{`{ "success": false, "error": "Invalid API key." }`}</pre>
      </div>

      <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: '#1e293b' }}>
              <th style={{ padding: '10px 16px', textAlign: 'left', color: '#94a3b8', fontWeight: 600, fontSize: 12 }}>상태 코드</th>
              <th style={{ padding: '10px 16px', textAlign: 'left', color: '#94a3b8', fontWeight: 600, fontSize: 12 }}>이름</th>
              <th style={{ padding: '10px 16px', textAlign: 'left', color: '#94a3b8', fontWeight: 600, fontSize: 12 }}>설명</th>
            </tr>
          </thead>
          <tbody>
            {errors.map(({ code, name, desc }) => (
              <tr key={code}>
                <td style={{ padding: '10px 16px', borderBottom: '1px solid #1e293b' }}>
                  <code style={{ color: code >= 500 ? '#ef4444' : code >= 400 ? '#f59e0b' : '#10b981', fontWeight: 700 }}>{code}</code>
                </td>
                <td style={{ padding: '10px 16px', borderBottom: '1px solid #1e293b', color: '#e2e8f0', fontWeight: 500 }}>{name}</td>
                <td style={{ padding: '10px 16px', borderBottom: '1px solid #1e293b', color: '#64748b' }}>{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
