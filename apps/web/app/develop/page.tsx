'use client'

import { useState } from 'react'

type Section = 'overview' | 'auth' | 'products' | 'quote' | 'inventory' | 'keys' | 'errors'

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://your-domain.com'

const EXAMPLE_KEY = 'ax_live_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4'

export default function DevelopPage() {
  const [activeSection, setActiveSection] = useState<Section>('overview')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  function copy(text: string, id: string) {
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
    try {
      navigator.clipboard.writeText(text)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.cssText = 'position:fixed;opacity:0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
  }

  return (
    <div style={{ fontFamily: "'Inter', -apple-system, sans-serif", background: '#0a0a0f', minHeight: '100vh', color: '#e2e8f0' }}>

      {/* Header */}
      <header style={{ borderBottom: '1px solid #1e293b', padding: '0 2rem', position: 'sticky', top: 0, background: 'rgba(10,10,15,0.95)', backdropFilter: 'blur(12px)', zIndex: 100 }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 60 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: '#fff' }}>A</div>
            <span style={{ fontWeight: 700, fontSize: 16, color: '#f1f5f9' }}>AX API</span>
            <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 100, background: '#1e293b', color: '#6366f1', fontWeight: 600, letterSpacing: '0.05em' }}>v1</span>
          </div>
          <nav style={{ display: 'flex', gap: 8 }}>
            {(['overview', 'auth', 'products', 'quote', 'inventory', 'keys', 'errors'] as Section[]).map((s) => (
              <button key={s} onClick={() => setActiveSection(s)}
                style={{ padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500, background: activeSection === s ? '#1e293b' : 'transparent', color: activeSection === s ? '#e2e8f0' : '#64748b', transition: 'all .15s' }}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '3rem 2rem', display: 'grid', gridTemplateColumns: '220px 1fr', gap: '3rem' }}>

        {/* Sidebar */}
        <aside>
          <nav style={{ position: 'sticky', top: 80 }}>
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>Getting Started</div>
              {[{id:'overview',label:'Overview'},{id:'auth',label:'Authentication'}].map(({id,label}) => (
                <SidebarItem key={id} active={activeSection===id as Section} onClick={() => setActiveSection(id as Section)}>{label}</SidebarItem>
              ))}
            </div>
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>Endpoints</div>
              {[{id:'products',label:'Products'},{id:'quote',label:'Quote'},{id:'inventory',label:'Inventory'}].map(({id,label}) => (
                <SidebarItem key={id} active={activeSection===id as Section} onClick={() => setActiveSection(id as Section)}>{label}</SidebarItem>
              ))}
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>Reference</div>
              {[{id:'keys',label:'API Keys'},{id:'errors',label:'Error Codes'}].map(({id,label}) => (
                <SidebarItem key={id} active={activeSection===id as Section} onClick={() => setActiveSection(id as Section)}>{label}</SidebarItem>
              ))}
            </div>
          </nav>
        </aside>

        {/* Main content */}
        <main style={{ minWidth: 0 }}>
          {activeSection === 'overview' && <OverviewSection baseUrl={BASE_URL} onCopy={copy} copiedId={copiedId} />}
          {activeSection === 'auth' && <AuthSection exampleKey={EXAMPLE_KEY} onCopy={copy} copiedId={copiedId} />}
          {activeSection === 'products' && <ProductsSection baseUrl={BASE_URL} exampleKey={EXAMPLE_KEY} onCopy={copy} copiedId={copiedId} />}
          {activeSection === 'quote' && <QuoteSection baseUrl={BASE_URL} exampleKey={EXAMPLE_KEY} onCopy={copy} copiedId={copiedId} />}
          {activeSection === 'inventory' && <InventorySection baseUrl={BASE_URL} exampleKey={EXAMPLE_KEY} onCopy={copy} copiedId={copiedId} />}
          {activeSection === 'keys' && <KeysSection onCopy={copy} copiedId={copiedId} />}
          {activeSection === 'errors' && <ErrorsSection />}
        </main>
      </div>
    </div>
  )
}

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
      <button onClick={() => onCopy(code, id)} style={{ position: 'absolute', top: 10, right: 10, padding: '4px 10px', borderRadius: 6, border: '1px solid #334155', background: '#1e293b', color: copiedId === id ? '#34d399' : '#94a3b8', fontSize: 12, cursor: 'pointer', transition: 'all .15s' }}>
        {copiedId === id ? '✓ Copied' : 'Copy'}
      </button>
      <pre style={{ margin: 0, padding: '1.25rem 1.5rem', fontSize: 13, lineHeight: 1.7, color: '#e2e8f0', overflowX: 'auto', whiteSpace: 'pre' }}>{code}</pre>
    </div>
  )
}

function Badge({ method }: { method: 'GET' | 'POST' | 'DELETE' }) {
  const colors: Record<string, string> = { GET: '#10b981', POST: '#6366f1', DELETE: '#ef4444' }
  return <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, background: colors[method] + '22', color: colors[method], fontWeight: 700, fontSize: 12, fontFamily: 'monospace' }}>{method}</span>
}

function EndpointHeader({ method, path, description }: { method: 'GET' | 'POST' | 'DELETE'; path: string; description: string }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <Badge method={method} />
        <code style={{ fontSize: 15, color: '#e2e8f0', background: '#0f172a', padding: '4px 12px', borderRadius: 6, border: '1px solid #1e293b' }}>{path}</code>
      </div>
      <p style={{ color: '#94a3b8', fontSize: 14, margin: 0 }}>{description}</p>
    </div>
  )
}

function ParamRow({ name, type, required, desc }: { name: string; type: string; required?: boolean; desc: string }) {
  return (
    <tr>
      <td style={{ padding: '10px 12px', borderBottom: '1px solid #1e293b' }}>
        <code style={{ color: '#a5b4fc', fontSize: 13 }}>{name}</code>
        {required && <span style={{ marginLeft: 6, fontSize: 11, color: '#ef4444', fontWeight: 600 }}>required</span>}
      </td>
      <td style={{ padding: '10px 12px', borderBottom: '1px solid #1e293b', color: '#64748b', fontSize: 13 }}>{type}</td>
      <td style={{ padding: '10px 12px', borderBottom: '1px solid #1e293b', color: '#94a3b8', fontSize: 13 }}>{desc}</td>
    </tr>
  )
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

// ─── Sections ──────────────────────────────────────────────────────────────

function OverviewSection({ baseUrl, onCopy, copiedId }: { baseUrl: string; onCopy: (t: string, id: string) => void; copiedId: string | null }) {
  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <div style={{ fontSize: 13, color: '#6366f1', fontWeight: 600, marginBottom: 8 }}>AX GPU Pricing API</div>
        <H1>Developer Documentation</H1>
        <P>The AX API gives your applications programmatic access to real-time GPU pricing, dynamic quote calculation, and inventory availability. Build integrations, automate quote generation, and embed accurate GPU pricing into your workflows.</P>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 40 }}>
        {[
          { icon: '⚡', title: 'Real-time pricing', desc: 'Live GPU market prices updated continuously' },
          { icon: '🔐', title: 'API Key auth', desc: 'Secure key-based auth. Rotate anytime from settings.' },
          { icon: '📊', title: 'Dynamic quotes', desc: 'Calculate exact quotes with custom margins.' },
        ].map(({ icon, title, desc }) => (
          <div key={title} style={{ padding: '20px', background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10 }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>{icon}</div>
            <div style={{ fontWeight: 600, color: '#e2e8f0', marginBottom: 4, fontSize: 14 }}>{title}</div>
            <div style={{ color: '#64748b', fontSize: 13 }}>{desc}</div>
          </div>
        ))}
      </div>

      <H2>Base URL</H2>
      <CodeBlock id="baseurl" code={`${baseUrl}/api/public/v1`} onCopy={onCopy} copiedId={copiedId} />

      <H2>Quick Start</H2>
      <P>Get your API key from the settings page, then make your first request:</P>
      <CodeBlock id="quickstart" onCopy={onCopy} copiedId={copiedId} code={`curl ${baseUrl}/api/public/v1/products \\
  -H "X-API-Key: ax_live_your_key_here"`} />

      <H2>Rate Limits</H2>
      <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: '#1e293b' }}>
              <th style={{ padding: '10px 16px', textAlign: 'left', color: '#94a3b8', fontWeight: 600, fontSize: 12 }}>Plan</th>
              <th style={{ padding: '10px 16px', textAlign: 'left', color: '#94a3b8', fontWeight: 600, fontSize: 12 }}>Rate Limit</th>
              <th style={{ padding: '10px 16px', textAlign: 'left', color: '#94a3b8', fontWeight: 600, fontSize: 12 }}>Max Keys</th>
            </tr>
          </thead>
          <tbody>
            <tr><td style={{ padding: '10px 16px', borderBottom: '1px solid #1e293b', color: '#e2e8f0' }}>Default</td><td style={{ padding: '10px 16px', borderBottom: '1px solid #1e293b', color: '#64748b' }}>60 req/min</td><td style={{ padding: '10px 16px', borderBottom: '1px solid #1e293b', color: '#64748b' }}>10 keys</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

function AuthSection({ exampleKey, onCopy, copiedId }: { exampleKey: string; onCopy: (t: string, id: string) => void; copiedId: string | null }) {
  return (
    <div>
      <H1>Authentication</H1>
      <P>All API requests must include a valid API key. Obtain your key from the <strong style={{ color: '#e2e8f0' }}>Settings → API Keys</strong> section of the AX dashboard.</P>

      <H2>API Key Header</H2>
      <P>Pass your key using the <code style={{ color: '#a5b4fc', background: '#1e293b', padding: '1px 6px', borderRadius: 4 }}>X-API-Key</code> request header:</P>
      <CodeBlock id="auth-curl" onCopy={onCopy} copiedId={copiedId} code={`curl https://your-domain.com/api/public/v1/products \\
  -H "X-API-Key: ${exampleKey}"`} />

      <P>Alternatively, you can use a Bearer token:</P>
      <CodeBlock id="auth-bearer" onCopy={onCopy} copiedId={copiedId} code={`curl https://your-domain.com/api/public/v1/products \\
  -H "Authorization: Bearer ${exampleKey}"`} />

      <H2>JavaScript / TypeScript</H2>
      <CodeBlock id="auth-js" onCopy={onCopy} copiedId={copiedId} code={`const API_KEY = process.env.AX_API_KEY

const res = await fetch('https://your-domain.com/api/public/v1/products', {
  headers: {
    'X-API-Key': API_KEY,
    'Content-Type': 'application/json',
  },
})
const data = await res.json()`} />

      <H2>Python</H2>
      <CodeBlock id="auth-py" onCopy={onCopy} copiedId={copiedId} code={`import requests

headers = {'X-API-Key': 'ax_live_your_key_here'}
res = requests.get('https://your-domain.com/api/public/v1/products', headers=headers)
data = res.json()`} />

      <div style={{ padding: '16px 20px', background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, marginTop: 24 }}>
        <div style={{ fontWeight: 600, color: '#ef4444', marginBottom: 6, fontSize: 14 }}>⚠️ Security</div>
        <p style={{ color: '#94a3b8', fontSize: 13, margin: 0, lineHeight: 1.6 }}>
          Never expose your API key in client-side code or public repositories. Use environment variables.
          If a key is compromised, revoke it immediately from Settings and generate a new one.
        </p>
      </div>
    </div>
  )
}

function ProductsSection({ baseUrl, exampleKey, onCopy, copiedId }: { baseUrl: string; exampleKey: string; onCopy: (t: string, id: string) => void; copiedId: string | null }) {
  return (
    <div>
      <H1>Products</H1>
      <P>Retrieve GPU product catalog with real-time pricing data.</P>

      <div style={{ border: '1px solid #1e293b', borderRadius: 10, padding: '20px 24px', marginBottom: 24 }}>
        <EndpointHeader method="GET" path="/api/public/v1/products" description="Returns all GPU products with current pricing, supplier information, and availability status." />
        <CodeBlock id="products-curl" onCopy={onCopy} copiedId={copiedId} code={`curl ${baseUrl}/api/public/v1/products \\
  -H "X-API-Key: ${exampleKey}"`} />
        <div style={{ fontWeight: 600, color: '#e2e8f0', marginBottom: 8, fontSize: 14 }}>Response</div>
        <CodeBlock id="products-resp" onCopy={onCopy} copiedId={copiedId} code={`{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "model_name": "H100 SXM5 80GB",
      "tier": "flagship",
      "vram_gb": 80,
      "pricing_mode": "dynamic",
      "price_per_unit_usd": 34500.00,
      "price_per_unit_krw": 48300000,
      "supplier": "NVIDIA Partner",
      "valid_until": "2026-06-30T00:00:00Z",
      "available": true
    }
  ],
  "meta": {
    "total": 12,
    "currency": "USD",
    "fx_usd_krw": 1400
  }
}`} />
      </div>

      <div style={{ border: '1px solid #1e293b', borderRadius: 10, padding: '20px 24px', marginBottom: 24 }}>
        <EndpointHeader method="GET" path="/api/public/v1/products/{id}" description="Returns detailed pricing and supplier information for a single GPU product." />
        <CodeBlock id="product-single-curl" onCopy={onCopy} copiedId={copiedId} code={`curl ${baseUrl}/api/public/v1/products/uuid-here \\
  -H "X-API-Key: ${exampleKey}"`} />
        <div style={{ fontWeight: 600, color: '#e2e8f0', marginBottom: 8, fontSize: 14 }}>Parameters</div>
        <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, overflow: 'hidden', marginBottom: 16 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#1e293b' }}><th style={{ padding: '8px 12px', textAlign: 'left', color: '#64748b', fontSize: 12 }}>Parameter</th><th style={{ padding: '8px 12px', textAlign: 'left', color: '#64748b', fontSize: 12 }}>Type</th><th style={{ padding: '8px 12px', textAlign: 'left', color: '#64748b', fontSize: 12 }}>Description</th></tr></thead>
            <tbody><ParamRow name="id" type="string (UUID)" required desc="The GPU product UUID" /></tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function QuoteSection({ baseUrl, exampleKey, onCopy, copiedId }: { baseUrl: string; exampleKey: string; onCopy: (t: string, id: string) => void; copiedId: string | null }) {
  return (
    <div>
      <H1>Quote</H1>
      <P>Calculate a detailed pricing quote for multiple GPU products, supporting custom margins and both USD and KRW currency output.</P>

      <div style={{ border: '1px solid #1e293b', borderRadius: 10, padding: '20px 24px', marginBottom: 24 }}>
        <EndpointHeader method="POST" path="/api/public/v1/quote" description="Calculate a quote for one or more GPU products. Custom margin overrides are supported per line item." />

        <div style={{ fontWeight: 600, color: '#e2e8f0', marginBottom: 8, fontSize: 14 }}>Request Body</div>
        <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, overflow: 'hidden', marginBottom: 16 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#1e293b' }}><th style={{ padding: '8px 12px', textAlign: 'left', color: '#64748b', fontSize: 12 }}>Field</th><th style={{ padding: '8px 12px', textAlign: 'left', color: '#64748b', fontSize: 12 }}>Type</th><th style={{ padding: '8px 12px', textAlign: 'left', color: '#64748b', fontSize: 12 }}>Description</th></tr></thead>
            <tbody>
              <ParamRow name="items" type="array" required desc="Array of line items (1–50)" />
              <ParamRow name="items[].product_id" type="string (UUID)" required desc="GPU product UUID" />
              <ParamRow name="items[].quantity" type="integer" required desc="Quantity (1–10000)" />
              <ParamRow name="items[].custom_margin_pct" type="number" desc="Override margin % (0–200). Defaults to system setting." />
              <ParamRow name="currency" type="'USD' | 'KRW'" desc="Output currency for totals. Default: USD" />
            </tbody>
          </table>
        </div>

        <CodeBlock id="quote-curl" onCopy={onCopy} copiedId={copiedId} code={`curl -X POST ${baseUrl}/api/public/v1/quote \\
  -H "X-API-Key: ${exampleKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "items": [
      { "product_id": "uuid-here", "quantity": 4 },
      { "product_id": "uuid-here-2", "quantity": 8, "custom_margin_pct": 20 }
    ],
    "currency": "USD"
  }'`} />

        <div style={{ fontWeight: 600, color: '#e2e8f0', marginBottom: 8, fontSize: 14 }}>Response</div>
        <CodeBlock id="quote-resp" onCopy={onCopy} copiedId={copiedId} code={`{
  "success": true,
  "data": {
    "items": [
      {
        "product_id": "uuid-here",
        "model_name": "A100 SXM4 80GB",
        "quantity": 4,
        "unit_price_usd": 12500.00,
        "unit_price_krw": 17500000,
        "total_usd": 50000.00,
        "total_krw": 70000000,
        "margin_pct": 18,
        "available": true
      }
    ],
    "summary": {
      "subtotal_usd": 50000.00,
      "subtotal_krw": 70000000,
      "currency": "USD",
      "total": 50000.00,
      "fx_usd_krw": 1400,
      "fx_rate_date": "2026-05-31",
      "quoted_at": "2026-05-31T10:00:00.000Z"
    }
  }
}`} />
      </div>
    </div>
  )
}

function InventorySection({ baseUrl, exampleKey, onCopy, copiedId }: { baseUrl: string; exampleKey: string; onCopy: (t: string, id: string) => void; copiedId: string | null }) {
  return (
    <div>
      <H1>Inventory</H1>
      <P>Check real-time availability and stock levels for GPU products.</P>

      <div style={{ border: '1px solid #1e293b', borderRadius: 10, padding: '20px 24px', marginBottom: 24 }}>
        <EndpointHeader method="GET" path="/api/public/v1/inventory" description="Returns current stock levels and availability status for all GPU products." />
        <CodeBlock id="inv-curl" onCopy={onCopy} copiedId={copiedId} code={`curl ${baseUrl}/api/public/v1/inventory \\
  -H "X-API-Key: ${exampleKey}"`} />
        <div style={{ fontWeight: 600, color: '#e2e8f0', marginBottom: 8, fontSize: 14 }}>Response</div>
        <CodeBlock id="inv-resp" onCopy={onCopy} copiedId={copiedId} code={`{
  "success": true,
  "data": [
    {
      "product_id": "uuid",
      "model_name": "H100 PCIe 80GB",
      "tier": "flagship",
      "vram_gb": 80,
      "available_qty": 16,
      "reserved_qty": 4,
      "total_qty": 20,
      "in_stock": true,
      "updated_at": "2026-05-31T08:00:00Z"
    }
  ],
  "meta": {
    "total": 8,
    "as_of": "2026-05-31T10:00:00.000Z"
  }
}`} />
      </div>
    </div>
  )
}

function KeysSection({ onCopy, copiedId }: { onCopy: (t: string, id: string) => void; copiedId: string | null }) {
  return (
    <div>
      <H1>API Keys</H1>
      <P>Manage your API keys programmatically via the session-authenticated management API.</P>

      <div style={{ padding: '14px 18px', background: 'rgba(99,102,241,0.05)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 10, marginBottom: 24 }}>
        <div style={{ fontWeight: 600, color: '#a5b4fc', marginBottom: 4, fontSize: 14 }}>💡 Session Required</div>
        <p style={{ color: '#94a3b8', fontSize: 13, margin: 0 }}>These endpoints require an active user session (cookie-based auth), not an API key. They are intended for your own settings UI integrations.</p>
      </div>

      <div style={{ border: '1px solid #1e293b', borderRadius: 10, padding: '20px 24px', marginBottom: 16 }}>
        <EndpointHeader method="GET" path="/api/user/api-keys" description="List all API keys for the authenticated user." />
        <CodeBlock id="keys-list" onCopy={onCopy} copiedId={copiedId} code={`GET /api/user/api-keys

// Response
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "Production Integration",
      "masked_key": "ax_live_a1b2c3d4••••••••••••••••••••••••",
      "status": "active",
      "created_at": "2026-05-01T00:00:00Z",
      "last_used_at": "2026-05-31T09:00:00Z",
      "request_count": 1423,
      "rate_limit_per_minute": 60
    }
  ]
}`} />
      </div>

      <div style={{ border: '1px solid #1e293b', borderRadius: 10, padding: '20px 24px', marginBottom: 16 }}>
        <EndpointHeader method="POST" path="/api/user/api-keys" description="Create a new API key. The full key is only returned once — store it securely." />
        <CodeBlock id="keys-create" onCopy={onCopy} copiedId={copiedId} code={`POST /api/user/api-keys
Content-Type: application/json

{ "name": "My Integration" }

// Response
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "My Integration",
    "key": "ax_live_a1b2c3d4e5f6...",
    "note": "Store this key securely — it will not be shown again."
  }
}`} />
      </div>

      <div style={{ border: '1px solid #1e293b', borderRadius: 10, padding: '20px 24px', marginBottom: 16 }}>
        <EndpointHeader method="DELETE" path="/api/user/api-keys/{id}" description="Revoke an API key immediately. Requests using this key will be rejected." />
        <CodeBlock id="keys-delete" onCopy={onCopy} copiedId={copiedId} code={`DELETE /api/user/api-keys/{key_id}

// Response
{
  "success": true,
  "message": "API key revoked successfully."
}`} />
      </div>
    </div>
  )
}

function ErrorsSection() {
  const errors = [
    { code: 401, name: 'Unauthorized', desc: 'Missing or invalid API key.' },
    { code: 403, name: 'Forbidden', desc: 'API key has been revoked.' },
    { code: 404, name: 'Not Found', desc: 'The requested resource does not exist.' },
    { code: 400, name: 'Bad Request', desc: 'Invalid request body. Check validation details.' },
    { code: 429, name: 'Too Many Requests', desc: 'Rate limit exceeded. Wait and retry.' },
    { code: 500, name: 'Internal Server Error', desc: 'Unexpected server error.' },
  ]

  return (
    <div>
      <H1>Error Codes</H1>
      <P>All errors follow a consistent JSON structure with a <code style={{ color: '#a5b4fc', background: '#1e293b', padding: '1px 6px', borderRadius: 4 }}>success: false</code> flag and an <code style={{ color: '#a5b4fc', background: '#1e293b', padding: '1px 6px', borderRadius: 4 }}>error</code> message.</P>

      <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10, padding: '1.25rem 1.5rem', marginBottom: 24 }}>
        <pre style={{ margin: 0, fontSize: 13, color: '#e2e8f0' }}>{`{
  "success": false,
  "error": "Invalid API key."
}`}</pre>
      </div>

      <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: '#1e293b' }}>
              <th style={{ padding: '10px 16px', textAlign: 'left', color: '#94a3b8', fontWeight: 600, fontSize: 12 }}>Status</th>
              <th style={{ padding: '10px 16px', textAlign: 'left', color: '#94a3b8', fontWeight: 600, fontSize: 12 }}>Name</th>
              <th style={{ padding: '10px 16px', textAlign: 'left', color: '#94a3b8', fontWeight: 600, fontSize: 12 }}>Description</th>
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
