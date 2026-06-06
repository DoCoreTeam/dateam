'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import DemoSection from './DemoSection'

type Section = 'overview' | 'auth' | 'products' | 'quote' | 'inventory' | 'fx' | 'suppliers' | 'market' | 'settings' | 'pool-stock' | 'accounts' | 'contacts' | 'deals' | 'demo' | 'errors'

function useOrigin(fallback = 'https://your-domain.com') {
  const [origin, setOrigin] = useState(fallback)
  useEffect(() => { setOrigin(window.location.origin) }, [])
  return origin
}

const EXAMPLE_KEY = 'ax_live_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4'

// ─── 공통 컴포넌트 ────────────────────────────────────────────────────────────

function SidebarItem({ children, active, onClick }: { children: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: active ? 600 : 400, background: active ? 'rgba(124,58,237,0.1)' : 'transparent', color: active ? '#a5b4fc' : '#64748b', borderLeft: active ? '2px solid var(--brand)' : '2px solid transparent', marginBottom: 2, transition: 'all .15s' }}>
      {children}
    </button>
  )
}

function CodeBlock({ code, id, onCopy, copiedId, lang = 'bash' }: { code: string; id: string; onCopy: (t: string, id: string) => void; copiedId: string | null; lang?: string }) {
  return (
    <div style={{ position: 'relative', background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px', background: '#1a2332', borderBottom: '1px solid #1e293b' }}>
        <span style={{ fontSize: 11, color: '#475569', fontFamily: 'monospace' }}>{lang}</span>
        <button onClick={() => onCopy(code, id)} style={{ padding: '3px 10px', borderRadius: 6, border: '1px solid #334155', background: '#1e293b', color: copiedId === id ? '#34d399' : '#94a3b8', fontSize: 12, cursor: 'pointer' }}>
          {copiedId === id ? '✓ 복사됨' : '복사'}
        </button>
      </div>
      <pre style={{ margin: 0, padding: '1.25rem 1.5rem', fontSize: 13, lineHeight: 1.7, color: 'var(--color-border)', overflowX: 'auto', whiteSpace: 'pre' }}>{code}</pre>
    </div>
  )
}

function Badge({ method }: { method: 'GET' | 'POST' | 'PATCH' | 'DELETE' }) {
  const colors: Record<string, string> = { GET: '#10b981', POST: 'var(--brand)', PATCH: '#f59e0b', DELETE: '#ef4444' }
  return <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 4, background: colors[method] + '22', color: colors[method], fontWeight: 700, fontSize: 12, fontFamily: 'monospace' }}>{method}</span>
}

function H1({ children }: { children: React.ReactNode }) {
  return <h1 style={{ fontSize: 30, fontWeight: 800, color: '#f1f5f9', marginBottom: 12, letterSpacing: '-0.02em' }}>{children}</h1>
}
function H2({ children }: { children: React.ReactNode }) {
  return <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-border)', marginBottom: 12, marginTop: 32, letterSpacing: '-0.01em' }}>{children}</h2>
}
function P({ children }: { children: React.ReactNode }) {
  return <p style={{ color: '#94a3b8', lineHeight: 1.7, fontSize: 15, marginBottom: 16 }}>{children}</p>
}
function Callout({ type = 'info', title, children }: { type?: 'info' | 'warn' | 'tip'; title: string; children: React.ReactNode }) {
  const cfg = {
    info: { border: 'rgba(124,58,237,0.3)', bg: 'rgba(124,58,237,0.05)', color: '#a5b4fc', icon: '💡' },
    warn: { border: 'rgba(239,68,68,0.25)', bg: 'rgba(239,68,68,0.05)', color: '#f87171', icon: '⚠️' },
    tip:  { border: 'rgba(16,185,129,0.25)', bg: 'rgba(16,185,129,0.05)', color: '#34d399', icon: '✅' },
  }[type]
  return (
    <div style={{ padding: '14px 18px', background: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: 10, marginBottom: 20 }}>
      <div style={{ fontWeight: 700, color: cfg.color, marginBottom: 6, fontSize: 13 }}>{cfg.icon} {title}</div>
      <div style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.6 }}>{children}</div>
    </div>
  )
}
function EndpointHeader({ method, path, desc }: { method: 'GET'|'POST'|'PATCH'|'DELETE'; path: string; desc: string }) {
  return (
    <div style={{ border: '1px solid #1e293b', borderRadius: 10, padding: '16px 20px', marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <Badge method={method} />
        <code style={{ fontSize: 14, color: 'var(--color-border)', background: '#0f172a', padding: '4px 12px', borderRadius: 6, border: '1px solid #1e293b' }}>/api/public/v1{path}</code>
      </div>
      <p style={{ color: '#64748b', fontSize: 13, margin: 0 }}>{desc}</p>
    </div>
  )
}
function ParamTable({ children, title = '파라미터' }: { children: React.ReactNode; title?: string }) {
  return (
    <>
      <div style={{ fontWeight: 600, color: 'var(--color-border)', marginBottom: 8, fontSize: 14 }}>{title}</div>
      <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10, overflow: 'hidden', marginBottom: 20 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ background: '#1e293b' }}>
            <th style={{ padding: '9px 14px', textAlign: 'left', color: '#64748b', fontWeight: 600, fontSize: 12 }}>필드</th>
            <th style={{ padding: '9px 14px', textAlign: 'left', color: '#64748b', fontWeight: 600, fontSize: 12 }}>타입</th>
            <th style={{ padding: '9px 14px', textAlign: 'left', color: '#64748b', fontWeight: 600, fontSize: 12 }}>설명</th>
          </tr></thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </>
  )
}
function PR({ name, type, required, desc }: { name: string; type: string; required?: boolean; desc: string }) {
  return (
    <tr>
      <td style={{ padding: '10px 14px', borderBottom: '1px solid #1e293b' }}>
        <code style={{ color: '#a5b4fc', fontSize: 12 }}>{name}</code>
        {required && <span style={{ marginLeft: 6, fontSize: 10, color: '#ef4444', fontWeight: 700, background: 'rgba(239,68,68,0.1)', padding: '1px 5px', borderRadius: 3 }}>필수</span>}
      </td>
      <td style={{ padding: '10px 14px', borderBottom: '1px solid #1e293b', color: '#64748b', fontSize: 12 }}>{type}</td>
      <td style={{ padding: '10px 14px', borderBottom: '1px solid #1e293b', color: '#94a3b8', fontSize: 12 }}>{desc}</td>
    </tr>
  )
}

// ─── 섹션: 개요 ──────────────────────────────────────────────────────────────

function OverviewSection({ onCopy, copiedId }: { onCopy: (t: string, id: string) => void; copiedId: string | null }) {
  const origin = useOrigin()
  return (
    <div>
      <div style={{ fontSize: 13, color: 'var(--brand)', fontWeight: 600, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>AX GPU 가격 API</div>
      <H1>개발자 문서</H1>
      <P>AX API는 GPU 실시간 가격 조회, 동적 견적 계산, 재고·공급사·경쟁사 데이터에 프로그래밍 방식으로 접근하게 해줍니다. 외부 시스템 연동, 견적 자동화, ERP/CRM 통합에 활용하세요.</P>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 36 }}>
        {[
          { icon: '⚡', title: '실시간 가격', desc: '지속 업데이트되는 156개 GPU 모델 시장 가격. 경쟁사 비교 포함.' },
          { icon: '🔐', title: 'API Key 인증', desc: 'X-API-Key 헤더 방식. 언제든지 발급·폐기 가능. 분당 60회 기본 제공.' },
          { icon: '📊', title: '동적 견적', desc: '커스텀 마진 적용, USD/KRW 통화 선택, 항목별 가용성 확인.' },
          { icon: '🏭', title: '재고 추적', desc: 'Tier별 재고 수량 실시간 조회. 풀 재고(Tier 3) 직접 업데이트 지원.' },
          { icon: '🌐', title: 'CRM 연동', desc: '거래처·담당자·영업기회 CRUD. 스테이지별 확률 자동 계산.' },
          { icon: '💱', title: '환율 동기화', desc: 'USD/KRW 환율 이력(최근 7일). 가격 계산에 자동 반영.' },
        ].map(({ icon, title, desc }) => (
          <div key={title} style={{ padding: '18px 20px', background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10 }}>
            <div style={{ fontSize: 22, marginBottom: 8 }}>{icon}</div>
            <div style={{ fontWeight: 700, color: 'var(--color-border)', marginBottom: 4, fontSize: 14 }}>{title}</div>
            <div style={{ color: '#64748b', fontSize: 12, lineHeight: 1.5 }}>{desc}</div>
          </div>
        ))}
      </div>

      <H2>Base URL</H2>
      <CodeBlock id="baseurl" code={`${origin}/api/public/v1`} onCopy={onCopy} copiedId={copiedId} />

      <H2>빠른 시작 (30초)</H2>
      <P>API 키를 발급받고 첫 요청을 보내는 전체 흐름입니다.</P>
      <CodeBlock id="quickstart" lang="bash" onCopy={onCopy} copiedId={copiedId} code={`# 1. GPU 제품 목록 조회
curl ${origin}/api/public/v1/products \\
  -H "X-API-Key: ax_live_여기에_키_입력"

# 2. H100 4장 견적 계산 (product_id는 1번 응답에서 확인)
curl -X POST ${origin}/api/public/v1/quote \\
  -H "X-API-Key: ax_live_여기에_키_입력" \\
  -H "Content-Type: application/json" \\
  -d '{"items": [{"product_id": "PRODUCT_UUID", "quantity": 4}], "currency": "KRW"}'`} />

      <H2>응답 공통 포맷</H2>
      <P>모든 응답은 아래 구조를 따릅니다. 에러 시에도 동일한 포맷으로 반환됩니다.</P>
      <CodeBlock id="resp-format" lang="json" onCopy={onCopy} copiedId={copiedId} code={`// 성공
{
  "success": true,
  "data": { ... },           // 단건 또는 배열
  "meta": {                  // 목록 API에만 포함
    "total": 156,
    "nextCursor": "2026-05-31T00:00:00Z__uuid",  // null이면 마지막 페이지
    "hasMore": false
  }
}

// 실패
{
  "success": false,
  "error": "Invalid API key."
}`} />

      <H2>페이지네이션</H2>
      <P>목록 API는 커서 기반 페이지네이션을 사용합니다. 응답의 <code style={{ color: '#a5b4fc', background: '#1e293b', padding: '1px 6px', borderRadius: 4 }}>nextCursor</code> 값을 다음 요청의 <code style={{ color: '#a5b4fc', background: '#1e293b', padding: '1px 6px', borderRadius: 4 }}>cursor</code> 파라미터로 전달하세요.</P>
      <CodeBlock id="pagination" lang="bash" onCopy={onCopy} copiedId={copiedId} code={`# 첫 페이지 (기본 20건)
curl "${origin}/api/public/v1/accounts" -H "X-API-Key: KEY"
# → { "nextCursor": "2026-05-30T12:00:00Z__uuid", "hasMore": true }

# 다음 페이지
curl "${origin}/api/public/v1/accounts?cursor=2026-05-30T12:00:00Z__uuid" \\
  -H "X-API-Key: KEY"`} />

      <H2>Rate Limiting</H2>
      <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10, overflow: 'hidden', marginBottom: 20 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ background: '#1e293b' }}>
            <th style={{ padding: '10px 16px', textAlign: 'left', color: '#64748b', fontWeight: 600, fontSize: 12 }}>플랜</th>
            <th style={{ padding: '10px 16px', textAlign: 'left', color: '#64748b', fontWeight: 600, fontSize: 12 }}>한도</th>
            <th style={{ padding: '10px 16px', textAlign: 'left', color: '#64748b', fontWeight: 600, fontSize: 12 }}>최대 키 수</th>
            <th style={{ padding: '10px 16px', textAlign: 'left', color: '#64748b', fontWeight: 600, fontSize: 12 }}>응답 헤더</th>
          </tr></thead>
          <tbody>
            <tr>
              <td style={{ padding: '10px 16px', color: 'var(--color-border)' }}>기본</td>
              <td style={{ padding: '10px 16px', color: '#64748b' }}>분당 60회</td>
              <td style={{ padding: '10px 16px', color: '#64748b' }}>10개</td>
              <td style={{ padding: '10px 16px' }}><code style={{ color: '#94a3b8', fontSize: 12 }}>X-RateLimit-*</code></td>
            </tr>
          </tbody>
        </table>
      </div>
      <Callout type="warn" title="한도 초과 시">
        HTTP 429를 반환합니다. Retry-After 헤더를 확인하고 지수 백오프(exponential backoff)를 구현하세요.
        대량 데이터 조회는 필터+커서 조합으로 청크 단위로 처리하세요.
      </Callout>
    </div>
  )
}

// ─── 섹션: 인증 ──────────────────────────────────────────────────────────────

function AuthSection({ exampleKey, onCopy, copiedId }: { exampleKey: string; onCopy: (t: string, id: string) => void; copiedId: string | null }) {
  const origin = useOrigin()
  return (
    <div>
      <H1>인증</H1>
      <P>모든 API 요청에는 유효한 API 키가 필요합니다. <strong style={{ color: 'var(--color-border)' }}>설정 → API Keys</strong>에서 키를 발급하세요. 키는 HMAC-SHA256으로 해시되어 저장되며 언제든지 재복사할 수 있습니다.</P>

      <H2>X-API-Key 헤더 (권장)</H2>
      <CodeBlock id="auth-curl" lang="bash" onCopy={onCopy} copiedId={copiedId} code={`curl ${origin}/api/public/v1/products \\
  -H "X-API-Key: ${exampleKey}"`} />

      <H2>Authorization Bearer (대안)</H2>
      <CodeBlock id="auth-bearer" lang="bash" onCopy={onCopy} copiedId={copiedId} code={`curl ${origin}/api/public/v1/products \\
  -H "Authorization: Bearer ${exampleKey}"`} />

      <H2>JavaScript / TypeScript</H2>
      <CodeBlock id="auth-js" lang="typescript" onCopy={onCopy} copiedId={copiedId} code={`const AX_API_KEY = process.env.AX_API_KEY   // 환경변수에서 로드

const response = await fetch('${origin}/api/public/v1/products', {
  headers: {
    'X-API-Key': AX_API_KEY,
    'Content-Type': 'application/json',
  },
})

if (!response.ok) {
  const err = await response.json()
  throw new Error(err.error)        // { success: false, error: "..." }
}

const { data, meta } = await response.json()`} />

      <H2>Python</H2>
      <CodeBlock id="auth-py" lang="python" onCopy={onCopy} copiedId={copiedId} code={`import os, requests

headers = {'X-API-Key': os.environ['AX_API_KEY']}
res = requests.get('${origin}/api/public/v1/products', headers=headers)
res.raise_for_status()
data = res.json()['data']`} />

      <H2>인증 오류 응답</H2>
      <CodeBlock id="auth-err" lang="json" onCopy={onCopy} copiedId={copiedId} code={`// 401 — 키 없음 또는 잘못된 형식
{ "success": false, "error": "Unauthorized" }

// 403 — 키가 폐기된 경우
{ "success": false, "error": "API key has been revoked." }`} />

      <Callout type="warn" title="보안 필수 사항">
        API 키를 클라이언트 코드(브라우저 JS, 모바일 앱)에 절대 노출하지 마세요.
        서버사이드 환경변수(<code>process.env.AX_API_KEY</code>)를 사용하세요.
        유출 시 즉시 폐기하고 새 키를 발급하세요.
      </Callout>

      <Callout type="tip" title="키 순환(Key Rotation) 전략">
        프로덕션에서는 구 키를 폐기하기 전에 신 키를 먼저 배포해 다운타임 없이 교체하세요.
        한 계정에 최대 10개의 활성 키를 유지할 수 있습니다.
      </Callout>
    </div>
  )
}

// ─── 섹션: 제품 ──────────────────────────────────────────────────────────────

function ProductsSection({ exampleKey, onCopy, copiedId }: { exampleKey: string; onCopy: (t: string, id: string) => void; copiedId: string | null }) {
  const origin = useOrigin()
  return (
    <div>
      <H1>제품 목록 (Products)</H1>
      <P>실시간 가격 데이터가 포함된 GPU 제품 카탈로그를 조회합니다. 모든 제품은 현재 공급사 가격과 마진이 적용된 판매가를 함께 반환합니다.</P>
      <Callout type="tip" title="언제 사용하나요?">
        견적 계산 전 <code>product_id</code>를 조회할 때, 가용 GPU 목록을 UI에 표시할 때, 외부 ERP에 제품 카탈로그를 동기화할 때 사용합니다.
      </Callout>

      <EndpointHeader method="GET" path="/products" desc="모든 GPU 제품의 현재 가격, 공급사 정보, 가용 여부를 반환합니다." />
      <CodeBlock id="products-curl" lang="bash" onCopy={onCopy} copiedId={copiedId} code={`curl ${origin}/api/public/v1/products \\
  -H "X-API-Key: ${exampleKey}"`} />

      <ParamTable title="응답 필드 (data[])">
        <PR name="id" type="uuid" desc="제품 고유 ID. 견적·재고 API에서 product_id로 사용." />
        <PR name="model_name" type="string" desc="GPU 모델명 (예: H100 SXM5, A100 80GB)" />
        <PR name="tier" type="1 | 2 | 3" desc="Tier 1=최상위, 2=중간, 3=직접 공급 풀" />
        <PR name="memory" type="string" desc="GPU VRAM (예: 80GB, 40GB)" />
        <PR name="gpu_count" type="integer" desc="묶음 GPU 수량 (단품=1, 서버팩=8 등)" />
        <PR name="pricing_mode" type="dynamic | fixed" desc="dynamic=시장가 연동, fixed=고정가" />
        <PR name="price_per_unit_usd" type="number" desc="단위당 판매가 (USD). 마진 포함." />
        <PR name="price_per_unit_krw" type="number" desc="단위당 판매가 (KRW). 당일 환율 적용." />
        <PR name="supplier" type="string" desc="공급사 이름" />
        <PR name="valid_until" type="ISO 8601" desc="가격 유효 기한. 이후에는 재조회 권장." />
        <PR name="available" type="boolean" desc="현재 주문 가능 여부" />
      </ParamTable>

      <CodeBlock id="products-resp" lang="json" onCopy={onCopy} copiedId={copiedId} code={`{
  "success": true,
  "data": [
    {
      "id": "b3f2a1c4-...",
      "model_name": "H100 SXM5",
      "tier": 1,
      "memory": "80GB",
      "gpu_count": 1,
      "pricing_mode": "dynamic",
      "price_per_unit_usd": 34500.00,
      "price_per_unit_krw": 51907500,
      "supplier": "NVIDIA 공인 파트너",
      "valid_until": "2026-06-30T00:00:00Z",
      "available": true
    }
  ],
  "meta": { "total": 156, "currency": "USD", "fx_usd_krw": 1504.0 }
}`} />

      <EndpointHeader method="GET" path="/products/{id}" desc="단일 GPU 제품의 상세 정보를 반환합니다." />
      <CodeBlock id="product-single" lang="bash" onCopy={onCopy} copiedId={copiedId} code={`curl ${origin}/api/public/v1/products/b3f2a1c4-... \\
  -H "X-API-Key: ${exampleKey}"`} />
    </div>
  )
}

// ─── 섹션: 견적 ──────────────────────────────────────────────────────────────

function QuoteSection({ exampleKey, onCopy, copiedId }: { exampleKey: string; onCopy: (t: string, id: string) => void; copiedId: string | null }) {
  const origin = useOrigin()
  return (
    <div>
      <H1>견적 계산 (Quote)</H1>
      <P>하나 이상의 GPU 제품에 대한 상세 견적을 계산합니다. 제품별 커스텀 마진 설정과 USD/KRW 통화 선택이 지원됩니다. 계산은 실시간 가격 + 최신 환율을 사용합니다.</P>
      <Callout type="tip" title="언제 사용하나요?">
        고객 제안서 자동 생성, ERP 연동 견적 워크플로, 실시간 가격 비교 UI에 활용하세요.
        <code>custom_margin_pct</code>로 고객사별 마진을 개별 설정할 수 있습니다.
      </Callout>

      <EndpointHeader method="POST" path="/quote" desc="여러 제품·수량 조합의 견적을 한 번에 계산합니다." />

      <ParamTable title="요청 바디">
        <PR name="items" type="array" required desc="견적 항목 목록 (1~50개)" />
        <PR name="items[].product_id" type="uuid" required desc="제품 ID (GET /products에서 조회)" />
        <PR name="items[].quantity" type="integer" required desc="수량 (1 이상)" />
        <PR name="items[].custom_margin_pct" type="number" desc="마진율 오버라이드 (0~200%). 미지정 시 시스템 기본 마진 사용." />
        <PR name="currency" type="'USD' | 'KRW'" desc="출력 통화. 기본값: USD. KRW 선택 시 당일 환율 자동 적용." />
      </ParamTable>

      <CodeBlock id="quote-curl" lang="bash" onCopy={onCopy} copiedId={copiedId} code={`curl -X POST ${origin}/api/public/v1/quote \\
  -H "X-API-Key: ${exampleKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "items": [
      { "product_id": "b3f2a1c4-...", "quantity": 4 },
      { "product_id": "a2e1b3d5-...", "quantity": 8, "custom_margin_pct": 20 }
    ],
    "currency": "KRW"
  }'`} />

      <ParamTable title="응답 필드 (data.items[])">
        <PR name="model_name" type="string" desc="GPU 모델명" />
        <PR name="quantity" type="integer" desc="요청 수량" />
        <PR name="unit_price_usd" type="number" desc="단위당 공급가 (USD, 마진 적용 전)" />
        <PR name="unit_price_krw" type="number" desc="단위당 공급가 (KRW)" />
        <PR name="total_usd" type="number" desc="소계 (USD)" />
        <PR name="total_krw" type="number" desc="소계 (KRW)" />
        <PR name="margin_pct" type="number" desc="적용된 마진율 (%)" />
        <PR name="available" type="boolean" desc="현재 재고 가용 여부" />
      </ParamTable>

      <ParamTable title="응답 필드 (data.summary)">
        <PR name="total" type="number" desc="선택 통화 기준 최종 합계" />
        <PR name="currency" type="string" desc="출력 통화" />
        <PR name="fx_usd_krw" type="number" desc="적용된 USD/KRW 환율" />
        <PR name="quoted_at" type="ISO 8601" desc="견적 생성 시각" />
      </ParamTable>

      <CodeBlock id="quote-resp" lang="json" onCopy={onCopy} copiedId={copiedId} code={`{
  "success": true,
  "data": {
    "items": [
      {
        "model_name": "H100 SXM5",
        "quantity": 4,
        "unit_price_usd": 34500.00,
        "unit_price_krw": 51907500,
        "total_usd": 138000.00,
        "total_krw": 207630000,
        "margin_pct": 18,
        "available": true
      }
    ],
    "summary": {
      "total": 207630000,
      "currency": "KRW",
      "fx_usd_krw": 1504.0,
      "quoted_at": "2026-05-31T10:00:00.000Z"
    }
  }
}`} />
    </div>
  )
}

// ─── 섹션: 재고 ──────────────────────────────────────────────────────────────

function InventorySection({ exampleKey, onCopy, copiedId }: { exampleKey: string; onCopy: (t: string, id: string) => void; copiedId: string | null }) {
  const origin = useOrigin()
  return (
    <div>
      <H1>재고 조회 (Inventory)</H1>
      <P>GPU 제품의 실시간 재고 수량과 가용 여부를 확인합니다. 모든 Tier를 포함한 통합 재고 현황입니다.</P>
      <Callout type="tip" title="언제 사용하나요?">
        고객 주문 전 재고 확인, 품절 알림 시스템 구축, 재고 대시보드 구성에 사용하세요.
        풀 재고(Tier 3) 업데이트는 <code>POST /pool-stock</code>을 사용하세요.
      </Callout>

      <EndpointHeader method="GET" path="/inventory" desc="모든 GPU 제품의 현재 재고 수량과 가용 여부를 반환합니다." />
      <CodeBlock id="inv-curl" lang="bash" onCopy={onCopy} copiedId={copiedId} code={`curl ${origin}/api/public/v1/inventory \\
  -H "X-API-Key: ${exampleKey}"`} />

      <ParamTable title="응답 필드 (data[])">
        <PR name="product_id" type="uuid" desc="제품 ID" />
        <PR name="model_name" type="string" desc="GPU 모델명" />
        <PR name="tier" type="1 | 2 | 3" desc="공급 Tier" />
        <PR name="memory" type="string" desc="VRAM 용량" />
        <PR name="available_qty" type="integer" desc="현재 가용 수량 (0이면 품절)" />
        <PR name="in_stock" type="boolean" desc="true면 즉시 공급 가능" />
        <PR name="updated_at" type="ISO 8601" desc="재고 정보 마지막 업데이트 시각" />
      </ParamTable>

      <CodeBlock id="inv-resp" lang="json" onCopy={onCopy} copiedId={copiedId} code={`{
  "success": true,
  "data": [
    {
      "product_id": "b3f2a1c4-...",
      "model_name": "H100 SXM5",
      "tier": 1,
      "memory": "80GB",
      "available_qty": 12,
      "in_stock": true,
      "updated_at": "2026-05-31T08:00:00Z"
    }
  ],
  "meta": { "total": 156, "as_of": "2026-05-31T10:00:00.000Z" }
}`} />
    </div>
  )
}

// ─── 섹션: 환율 ──────────────────────────────────────────────────────────────

function FxSection({ exampleKey, onCopy, copiedId }: { exampleKey: string; onCopy: (t: string, id: string) => void; copiedId: string | null }) {
  const origin = useOrigin()
  return (
    <div>
      <H1>환율 (FX Rates)</H1>
      <P>최근 7일간의 USD/KRW 환율 이력을 조회합니다. 가격 계산에 사용되는 환율 데이터로, 매일 자동 업데이트됩니다.</P>
      <Callout type="tip" title="언제 사용하나요?">
        환율 변동에 따른 가격 변화를 추적하거나, 별도 환율 소스 없이 당일 환율을 빠르게 조회할 때 사용하세요.
        가격 API(<code>/products</code>, <code>/quote</code>)는 이 환율을 자동 반영합니다.
      </Callout>

      <EndpointHeader method="GET" path="/fx" desc="최근 7일간의 USD/KRW 환율 이력을 반환합니다." />
      <CodeBlock id="fx-get" lang="bash" onCopy={onCopy} copiedId={copiedId} code={`curl ${origin}/api/public/v1/fx \\
  -H "X-API-Key: ${exampleKey}"`} />

      <ParamTable title="응답 필드 (data[])">
        <PR name="rate_date" type="YYYY-MM-DD" desc="환율 적용일" />
        <PR name="usd_krw" type="number" desc="1 USD 기준 KRW 환율 (예: 1504.5)" />
        <PR name="source" type="string" desc="환율 데이터 출처 (예: koreaexim, manual)" />
      </ParamTable>

      <CodeBlock id="fx-resp" lang="json" onCopy={onCopy} copiedId={copiedId} code={`{
  "success": true,
  "data": [
    { "rate_date": "2026-05-31", "usd_krw": 1504.0, "source": "koreaexim" },
    { "rate_date": "2026-05-30", "usd_krw": 1501.3, "source": "koreaexim" }
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
      <P>GPU 공급사 목록과 통계(활성 견적 수, 최저가 달성 수, 마지막 견적 수신일)를 조회하고 신규 공급사를 등록합니다.</P>
      <Callout type="tip" title="언제 사용하나요?">
        공급사 포털 연동, 입고 알림 시스템, 조달 자동화 워크플로에 사용하세요.
      </Callout>

      <EndpointHeader method="GET" path="/suppliers" desc="등록된 모든 공급사와 통계를 반환합니다." />
      <CodeBlock id="sup-get" lang="bash" onCopy={onCopy} copiedId={copiedId} code={`curl ${origin}/api/public/v1/suppliers \\
  -H "X-API-Key: ${exampleKey}"`} />

      <ParamTable title="응답 필드 (data[])">
        <PR name="id" type="uuid" desc="공급사 고유 ID" />
        <PR name="name" type="string" desc="공급사 이름" />
        <PR name="location" type="string | null" desc="위치/지역" />
        <PR name="contact" type="string | null" desc="연락처 (이메일 또는 전화)" />
        <PR name="active_quotes" type="integer" desc="현재 활성 견적 수" />
        <PR name="lowest_count" type="integer" desc="최저가 달성 횟수" />
        <PR name="last_received" type="ISO 8601 | null" desc="마지막 견적 수신 일시" />
      </ParamTable>

      <EndpointHeader method="POST" path="/suppliers" desc="신규 공급사를 등록합니다." />
      <ParamTable title="요청 바디">
        <PR name="name" type="string" required desc="공급사 이름 (고유값)" />
        <PR name="location" type="string" desc="위치 (선택)" />
        <PR name="contact" type="string" desc="연락처 (선택)" />
      </ParamTable>
      <CodeBlock id="sup-post" lang="bash" onCopy={onCopy} copiedId={copiedId} code={`curl -X POST ${origin}/api/public/v1/suppliers \\
  -H "X-API-Key: ${exampleKey}" \\
  -H "Content-Type: application/json" \\
  -d '{ "name": "ABC Corp", "location": "서울", "contact": "supply@abc.com" }'`} />
    </div>
  )
}

// ─── 섹션: 시장 비교 ──────────────────────────────────────────────────────────

function MarketSection({ exampleKey, onCopy, copiedId }: { exampleKey: string; onCopy: (t: string, id: string) => void; copiedId: string | null }) {
  const origin = useOrigin()
  return (
    <div>
      <H1>시장 비교 (Market)</H1>
      <P>경쟁사 가격과 자사 가격을 비교한 시장 분석 데이터를 반환합니다. 전략 포지셔닝, 공급 이력 중앙값, 데이터 신선도를 포함합니다.</P>
      <Callout type="tip" title="언제 사용하나요?">
        가격 경쟁력 분석, 임원 보고서 자동화, 가격 알림 시스템에 활용하세요.
        <code>is_fresh</code> 필드로 오래된 경쟁사 데이터를 필터링할 수 있습니다.
      </Callout>

      <EndpointHeader method="GET" path="/market" desc="전체 제품에 대한 시장 비교 데이터를 반환합니다." />
      <CodeBlock id="mkt-get" lang="bash" onCopy={onCopy} copiedId={copiedId} code={`curl ${origin}/api/public/v1/market \\
  -H "X-API-Key: ${exampleKey}"`} />

      <ParamTable title="응답 필드 (data.products[])">
        <PR name="product" type="object" desc="GPU 제품 기본 정보 (id, model_name, memory, tier)" />
        <PR name="our_price_usd" type="number" desc="자사 판매가 (USD)" />
        <PR name="market_min" type="number" desc="시장 최저가 (USD, 신선 데이터 기준)" />
        <PR name="market_max" type="number" desc="시장 최고가 (USD)" />
        <PR name="market_median" type="number" desc="시장 중앙값 (USD)" />
        <PR name="competitors" type="array" desc="경쟁사별 가격 목록" />
        <PR name="competitors[].price_usd" type="number" desc="경쟁사 가격 (USD/hr)" />
        <PR name="competitors[].is_fresh" type="boolean" desc="7일 이내 수집된 신선 데이터 여부" />
        <PR name="competitors[].collected_at" type="ISO 8601" desc="데이터 수집 시각" />
        <PR name="strategy" type="object | null" desc="가격 전략 설정값 (edge_pct_normal, edge_pct_aggressive)" />
        <PR name="supply_history" type="object | null" desc="공급사 이력 통계 (median_usd, min_usd, quote_count)" />
      </ParamTable>

      <CodeBlock id="mkt-resp" lang="json" onCopy={onCopy} copiedId={copiedId} code={`{
  "success": true,
  "data": {
    "usd_krw": 1504.0,
    "summary": { "low_count": 5, "mid_count": 10, "high_count": 2, "competitor_count": 12 },
    "products": [
      {
        "product": { "id": "b3f2a1c4-...", "model_name": "H100 SXM5", "memory": "80GB" },
        "our_price_usd": 2.95,
        "market_min": 2.80,
        "market_max": 3.50,
        "market_median": 3.10,
        "competitors": [
          { "competitor": { "name": "A사" }, "price_usd": 3.20, "is_fresh": true, "collected_at": "2026-05-30T..." }
        ],
        "strategy": { "edge_pct_normal": 3, "edge_pct_aggressive": 8 }
      }
    ]
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
      <P>전역 마진율과 최신 환율 정보를 조회하거나 업데이트합니다. 마진율 변경은 <code style={{ color: '#a5b4fc', background: '#1e293b', padding: '1px 6px', borderRadius: 4 }}>gpu_audit_logs</code>에 기록됩니다.</P>
      <Callout type="warn" title="주의">
        마진율 변경은 즉시 모든 견적 계산에 반영됩니다. 변경 전 기존 견적이 있다면 재발행을 검토하세요.
      </Callout>

      <EndpointHeader method="GET" path="/settings" desc="현재 전역 마진율과 환율 정보를 반환합니다." />
      <CodeBlock id="set-get" lang="bash" onCopy={onCopy} copiedId={copiedId} code={`curl ${origin}/api/public/v1/settings \\
  -H "X-API-Key: ${exampleKey}"`} />

      <ParamTable title="응답 필드 (data)">
        <PR name="margin_pct" type="number" desc="현재 전역 마진율 (%)" />
        <PR name="usd_krw" type="number" desc="오늘 적용 환율" />
        <PR name="fx_date" type="YYYY-MM-DD" desc="환율 기준일" />
        <PR name="updated_at" type="ISO 8601" desc="마진율 마지막 변경 시각" />
        <PR name="updated_by" type="string" desc="마지막 변경자 이메일" />
      </ParamTable>

      <EndpointHeader method="PATCH" path="/settings" desc="전역 마진율을 업데이트합니다." />
      <ParamTable title="요청 바디">
        <PR name="margin_pct" type="number" required desc="새 마진율 (0~999 사이의 숫자)" />
      </ParamTable>
      <CodeBlock id="set-patch" lang="bash" onCopy={onCopy} copiedId={copiedId} code={`curl -X PATCH ${origin}/api/public/v1/settings \\
  -H "X-API-Key: ${exampleKey}" \\
  -H "Content-Type: application/json" \\
  -d '{ "margin_pct": 20 }'`} />
    </div>
  )
}

// ─── 섹션: 풀 재고 ───────────────────────────────────────────────────────────

function PoolStockSection({ exampleKey, onCopy, copiedId }: { exampleKey: string; onCopy: (t: string, id: string) => void; copiedId: string | null }) {
  const origin = useOrigin()
  return (
    <div>
      <H1>풀 재고 (Pool Stock)</H1>
      <P>직접 공급 풀(Tier 3)의 재고 수량을 조회하거나 업데이트합니다. 수량을 변경하면 재고 현황(<code style={{ color: '#a5b4fc', background: '#1e293b', padding: '1px 6px', borderRadius: 4 }}>/inventory</code>)에 즉시 반영됩니다.</P>
      <Callout type="tip" title="언제 사용하나요?">
        입고 처리 자동화, WMS 연동, 재고 수량 실시간 업데이트에 사용하세요.
        <code>sell_price_krw</code>를 함께 전달하면 판매가도 동시에 업데이트됩니다.
      </Callout>

      <EndpointHeader method="GET" path="/pool-stock" desc="현재 풀 재고(Tier 3) 목록을 반환합니다." />
      <CodeBlock id="ps-get" lang="bash" onCopy={onCopy} copiedId={copiedId} code={`# 전체 조회
curl ${origin}/api/public/v1/pool-stock \\
  -H "X-API-Key: ${exampleKey}"

# 특정 제품만 조회
curl "${origin}/api/public/v1/pool-stock?product_id=b3f2a1c4-..." \\
  -H "X-API-Key: ${exampleKey}"`} />

      <ParamTable title="쿼리 파라미터">
        <PR name="product_id" type="uuid" desc="특정 제품 필터 (선택)" />
      </ParamTable>

      <EndpointHeader method="POST" path="/pool-stock" desc="풀 재고 수량을 업데이트합니다." />
      <ParamTable title="요청 바디">
        <PR name="product_id" type="uuid" required desc="업데이트할 제품 ID" />
        <PR name="pool_qty" type="integer" required desc="새 재고 수량 (0 이상. 0 입력 시 품절 처리)" />
        <PR name="sell_price_krw" type="number" desc="판매가 KRW (선택. 입력 시 direct_prices도 동시 업데이트)" />
        <PR name="note" type="string" desc="메모 (선택. 예: '5월 입고분')" />
      </ParamTable>
      <CodeBlock id="ps-post" lang="bash" onCopy={onCopy} copiedId={copiedId} code={`curl -X POST ${origin}/api/public/v1/pool-stock \\
  -H "X-API-Key: ${exampleKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "product_id": "b3f2a1c4-...",
    "pool_qty": 10,
    "sell_price_krw": 5000000,
    "note": "5월 입고분"
  }'`} />
    </div>
  )
}

// ─── 섹션: 거래처 ─────────────────────────────────────────────────────────────

function AccountsSection({ exampleKey, onCopy, copiedId }: { exampleKey: string; onCopy: (t: string, id: string) => void; copiedId: string | null }) {
  const origin = useOrigin()
  return (
    <div>
      <H1>거래처 (Accounts)</H1>
      <P>CRM 거래처 데이터를 조회·생성·수정·삭제합니다. 커서 기반 페이지네이션과 복합 필터를 지원합니다.</P>
      <Callout type="tip" title="언제 사용하나요?">
        외부 CRM·ERP 시스템 연동, 거래처 동기화, 영업 분석 데이터 추출에 활용하세요.
      </Callout>

      <EndpointHeader method="GET" path="/accounts" desc="거래처 목록을 커서 기반 페이지네이션으로 반환합니다." />
      <ParamTable title="쿼리 파라미터">
        <PR name="cursor" type="string" desc="다음 페이지 커서 (이전 응답의 nextCursor)" />
        <PR name="search" type="string" desc="거래처명 부분 검색" />
        <PR name="segment" type="string" desc="세그먼트 필터 (T1, T2, 공공, 스타트업 등)" />
        <PR name="industry" type="string" desc="업종 필터 (부분 일치)" />
        <PR name="region" type="string" desc="지역 필터 (부분 일치)" />
        <PR name="sort" type="string" desc="정렬 기준: created_at, name, fit_score, industry, region" />
        <PR name="dir" type="asc | desc" desc="정렬 방향 (기본: desc)" />
      </ParamTable>
      <CodeBlock id="acc-get" lang="bash" onCopy={onCopy} copiedId={copiedId} code={`# 목록 조회
curl "${origin}/api/public/v1/accounts?segment=T1&sort=name&dir=asc" \\
  -H "X-API-Key: ${exampleKey}"

# 검색
curl "${origin}/api/public/v1/accounts?search=삼성" \\
  -H "X-API-Key: ${exampleKey}"

# 단건 조회
curl "${origin}/api/public/v1/accounts/ACCOUNT_ID" \\
  -H "X-API-Key: ${exampleKey}"`} />

      <EndpointHeader method="POST" path="/accounts" desc="신규 거래처를 생성합니다." />
      <ParamTable title="요청 바디">
        <PR name="name" type="string" required desc="거래처명" />
        <PR name="industry" type="string" desc="업종" />
        <PR name="segment" type="string" desc="세그먼트 (T1, T2, 공공 등)" />
        <PR name="region" type="string" desc="지역" />
        <PR name="description" type="string" desc="설명" />
        <PR name="fit_score" type="0~100" desc="적합도 점수" />
      </ParamTable>
      <CodeBlock id="acc-post" lang="bash" onCopy={onCopy} copiedId={copiedId} code={`curl -X POST ${origin}/api/public/v1/accounts \\
  -H "X-API-Key: ${exampleKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "주식회사 테스트",
    "industry": "AI/ML",
    "segment": "T2",
    "region": "서울",
    "fit_score": 75
  }'`} />

      <EndpointHeader method="PATCH" path="/accounts/{id}" desc="거래처 정보를 부분 수정합니다." />
      <EndpointHeader method="DELETE" path="/accounts/{id}" desc="거래처를 삭제합니다." />
      <CodeBlock id="acc-patch" lang="bash" onCopy={onCopy} copiedId={copiedId} code={`# 수정
curl -X PATCH ${origin}/api/public/v1/accounts/ACCOUNT_ID \\
  -H "X-API-Key: ${exampleKey}" \\
  -H "Content-Type: application/json" \\
  -d '{ "fit_score": 90, "description": "핵심 고객" }'

# 삭제
curl -X DELETE ${origin}/api/public/v1/accounts/ACCOUNT_ID \\
  -H "X-API-Key: ${exampleKey}"`} />
    </div>
  )
}

// ─── 섹션: 담당자 ─────────────────────────────────────────────────────────────

function ContactsSection({ exampleKey, onCopy, copiedId }: { exampleKey: string; onCopy: (t: string, id: string) => void; copiedId: string | null }) {
  const origin = useOrigin()
  return (
    <div>
      <H1>담당자 (Contacts)</H1>
      <P>거래처 담당자를 조회하거나 등록합니다. 담당자는 반드시 거래처(<code style={{ color: '#a5b4fc', background: '#1e293b', padding: '1px 6px', borderRadius: 4 }}>account_id</code>)와 연결됩니다.</P>
      <Callout type="tip" title="언제 사용하나요?">
        명함 관리 시스템 연동, 거래처별 담당자 포털, 이메일 자동화 워크플로에 활용하세요.
      </Callout>

      <EndpointHeader method="GET" path="/contacts" desc="담당자 목록을 반환합니다. 거래처 이름 포함." />
      <ParamTable title="쿼리 파라미터">
        <PR name="cursor" type="string" desc="다음 페이지 커서" />
        <PR name="search" type="string" desc="담당자명 검색" />
        <PR name="account_id" type="uuid" desc="특정 거래처의 담당자만 조회" />
      </ParamTable>
      <CodeBlock id="con-get" lang="bash" onCopy={onCopy} copiedId={copiedId} code={`# 목록 조회
curl "${origin}/api/public/v1/contacts?search=김" \\
  -H "X-API-Key: ${exampleKey}"

# 특정 거래처 담당자
curl "${origin}/api/public/v1/contacts?account_id=ACCOUNT_ID" \\
  -H "X-API-Key: ${exampleKey}"

# 단건 조회
curl "${origin}/api/public/v1/contacts/CONTACT_ID" \\
  -H "X-API-Key: ${exampleKey}"`} />

      <EndpointHeader method="POST" path="/contacts" desc="신규 담당자를 생성합니다." />
      <ParamTable title="요청 바디">
        <PR name="name" type="string" required desc="담당자 이름" />
        <PR name="account_id" type="uuid" desc="연결 거래처 ID" />
        <PR name="email" type="string" desc="이메일 주소" />
        <PR name="phone" type="string" desc="전화번호" />
        <PR name="title" type="string" desc="직함 (예: CTO, 구매팀장)" />
        <PR name="department" type="string" desc="부서" />
      </ParamTable>
      <CodeBlock id="con-post" lang="bash" onCopy={onCopy} copiedId={copiedId} code={`curl -X POST ${origin}/api/public/v1/contacts \\
  -H "X-API-Key: ${exampleKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "홍길동",
    "account_id": "ACCOUNT_ID",
    "email": "hong@example.com",
    "title": "CTO"
  }'`} />

      <EndpointHeader method="PATCH" path="/contacts/{id}" desc="담당자 정보를 수정합니다." />
      <EndpointHeader method="DELETE" path="/contacts/{id}" desc="담당자를 삭제합니다." />
    </div>
  )
}

// ─── 섹션: 영업기회 ──────────────────────────────────────────────────────────

function DealsSection({ exampleKey, onCopy, copiedId }: { exampleKey: string; onCopy: (t: string, id: string) => void; copiedId: string | null }) {
  const origin = useOrigin()
  return (
    <div>
      <H1>영업기회 (Deals)</H1>
      <P>영업기회를 조회·생성·수정합니다. 스테이지를 변경하면 성공 확률이 자동으로 재계산됩니다.</P>
      <Callout type="tip" title="언제 사용하나요?">
        Slack 봇으로 영업기회 업데이트, 외부 견적 시스템과 CRM 동기화, 주간 파이프라인 리포트 자동 생성에 활용하세요.
      </Callout>

      <EndpointHeader method="GET" path="/deals" desc="영업기회 목록을 커서 기반 페이지네이션으로 반환합니다." />
      <ParamTable title="쿼리 파라미터">
        <PR name="cursor" type="string" desc="다음 페이지 커서" />
        <PR name="search" type="string" desc="제목 검색" />
        <PR name="stage" type="string" desc="스테이지 필터 (신규, 컨택, PoC, 제안, 협상, 수주 등)" />
        <PR name="sort" type="string" desc="정렬: created_at, title, stage, value, probability" />
        <PR name="dir" type="asc | desc" desc="정렬 방향" />
      </ParamTable>
      <CodeBlock id="dea-get" lang="bash" onCopy={onCopy} copiedId={copiedId} code={`# 제안 단계 기회 조회
curl "${origin}/api/public/v1/deals?stage=제안" \\
  -H "X-API-Key: ${exampleKey}"

# 단건 조회
curl "${origin}/api/public/v1/deals/DEAL_ID" \\
  -H "X-API-Key: ${exampleKey}"`} />

      <EndpointHeader method="POST" path="/deals" desc="신규 영업기회를 생성합니다." />
      <ParamTable title="요청 바디">
        <PR name="title" type="string" required desc="영업기회 제목" />
        <PR name="account_id" type="uuid" desc="거래처 ID" />
        <PR name="contact_id" type="uuid" desc="담당자 ID" />
        <PR name="stage" type="string" desc="스테이지 (기본: 신규). probability 자동 설정." />
        <PR name="value" type="number" desc="예상 금액 (KRW)" />
        <PR name="close_date" type="YYYY-MM-DD" desc="예상 클로즈 날짜" />
        <PR name="product" type="string" desc="관련 GPU 제품명" />
        <PR name="lead_type" type="string" desc="리드 유형 (Inbound, Outbound 등)" />
      </ParamTable>
      <CodeBlock id="dea-post" lang="bash" onCopy={onCopy} copiedId={copiedId} code={`curl -X POST ${origin}/api/public/v1/deals \\
  -H "X-API-Key: ${exampleKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "title": "H100 서버 임대 계약",
    "account_id": "ACCOUNT_ID",
    "value": 50000000,
    "stage": "컨택",
    "product": "H100 SXM5",
    "close_date": "2026-07-31"
  }'`} />

      <H2>스테이지 → 확률 자동 변환</H2>
      <P>스테이지를 변경하면 <code style={{ color: '#a5b4fc', background: '#1e293b', padding: '1px 6px', borderRadius: 4 }}>probability</code> 필드가 자동으로 업데이트됩니다.</P>
      <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10, overflow: 'hidden', marginBottom: 24 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ background: '#1e293b' }}>
            <th style={{ padding: '10px 16px', textAlign: 'left', color: '#64748b', fontSize: 12 }}>stage</th>
            <th style={{ padding: '10px 16px', textAlign: 'left', color: '#64748b', fontSize: 12 }}>probability</th>
            <th style={{ padding: '10px 16px', textAlign: 'left', color: '#64748b', fontSize: 12 }}>의미</th>
          </tr></thead>
          <tbody>
            {[
              ['신규', '5%', '초기 인식 단계'],
              ['검증', '15%', '잠재 고객 검증 중'],
              ['컨택', '30%', '실제 미팅·연락 완료'],
              ['PoC', '50%', '기술 검증 진행 중'],
              ['제안', '65%', '견적/제안서 발송'],
              ['협상', '80%', '조건 협상 진행 중'],
              ['수주', '100%', '계약 완료'],
              ['실패', '0%', '기회 종료'],
            ].map(([s, p, m]) => (
              <tr key={s} style={{ borderTop: '1px solid #1e293b' }}>
                <td style={{ padding: '10px 16px' }}><code style={{ color: '#a5b4fc' }}>{s}</code></td>
                <td style={{ padding: '10px 16px', color: '#10b981', fontWeight: 700 }}>{p}</td>
                <td style={{ padding: '10px 16px', color: '#64748b' }}>{m}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <EndpointHeader method="PATCH" path="/deals/{id}" desc="영업기회를 수정합니다." />
      <EndpointHeader method="DELETE" path="/deals/{id}" desc="영업기회를 삭제합니다." />
      <CodeBlock id="dea-patch" lang="bash" onCopy={onCopy} copiedId={copiedId} code={`# 스테이지 업데이트 (probability 자동 재계산)
curl -X PATCH ${origin}/api/public/v1/deals/DEAL_ID \\
  -H "X-API-Key: ${exampleKey}" \\
  -H "Content-Type: application/json" \\
  -d '{ "stage": "제안", "value": 80000000 }'`} />
    </div>
  )
}

// ─── 섹션: 오류 코드 ─────────────────────────────────────────────────────────

function ErrorsSection({ onCopy, copiedId }: { onCopy: (t: string, id: string) => void; copiedId: string | null }) {
  return (
    <div>
      <H1>오류 코드</H1>
      <P>모든 오류는 HTTP 상태 코드와 함께 아래 포맷으로 반환됩니다. <code style={{ color: '#a5b4fc', background: '#1e293b', padding: '1px 6px', borderRadius: 4 }}>error</code> 필드에 사람이 읽을 수 있는 메시지가 포함됩니다.</P>
      <CodeBlock id="err-fmt" lang="json" onCopy={onCopy} copiedId={copiedId} code={`{ "success": false, "error": "Invalid API key." }`} />

      <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10, overflow: 'hidden', marginBottom: 24 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ background: '#1e293b' }}>
            <th style={{ padding: '10px 16px', textAlign: 'left', color: '#64748b', fontWeight: 600, fontSize: 12 }}>코드</th>
            <th style={{ padding: '10px 16px', textAlign: 'left', color: '#64748b', fontWeight: 600, fontSize: 12 }}>이름</th>
            <th style={{ padding: '10px 16px', textAlign: 'left', color: '#64748b', fontWeight: 600, fontSize: 12 }}>원인</th>
            <th style={{ padding: '10px 16px', textAlign: 'left', color: '#64748b', fontWeight: 600, fontSize: 12 }}>해결</th>
          </tr></thead>
          <tbody>
            {[
              { code: 400, color: '#f59e0b', name: 'Bad Request', cause: '요청 바디 형식 오류 또는 필수 필드 누락', fix: 'details 필드에서 구체적인 오류 위치 확인' },
              { code: 401, color: '#f59e0b', name: 'Unauthorized', cause: 'X-API-Key 헤더 없음 또는 잘못된 키 형식', fix: 'ax_live_ 접두사 포함 전체 키 값 확인' },
              { code: 403, color: '#f59e0b', name: 'Forbidden', cause: 'API 키가 폐기된 상태', fix: '새 키를 발급하고 코드 업데이트' },
              { code: 404, color: '#64748b', name: 'Not Found', cause: '요청한 리소스 ID가 존재하지 않음', fix: 'ID 값이 올바른지 확인' },
              { code: 429, color: '#ef4444', name: 'Too Many Requests', cause: '분당 요청 한도 초과', fix: 'Retry-After 헤더 대기 후 재시도. 지수 백오프 적용.' },
              { code: 500, color: '#ef4444', name: 'Internal Server Error', cause: '서버 내부 오류', fix: '잠시 후 재시도. 지속 시 관리자에게 문의' },
            ].map(({ code, color, name, cause, fix }) => (
              <tr key={code} style={{ borderTop: '1px solid #1e293b' }}>
                <td style={{ padding: '12px 16px' }}><code style={{ color, fontWeight: 700, fontSize: 13 }}>{code}</code></td>
                <td style={{ padding: '12px 16px', color: 'var(--color-border)', fontWeight: 500 }}>{name}</td>
                <td style={{ padding: '12px 16px', color: '#64748b', fontSize: 12 }}>{cause}</td>
                <td style={{ padding: '12px 16px', color: '#94a3b8', fontSize: 12 }}>{fix}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <H2>재시도(Retry) 권장 패턴</H2>
      <CodeBlock id="retry-js" lang="typescript" onCopy={onCopy} copiedId={copiedId} code={`async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = await fetch(url, options)

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('Retry-After') ?? '5')
      await new Promise(r => setTimeout(r, retryAfter * 1000))
      continue
    }

    if (res.status >= 500 && attempt < maxRetries - 1) {
      await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000))
      continue
    }

    return res
  }
  throw new Error('Max retries exceeded')
}`} />
    </div>
  )
}

// ─── 메인 페이지 ──────────────────────────────────────────────────────────────

export default function DevelopPage() {
  const [activeSection, setActiveSection] = useState<Section>('overview')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [showDashboardLink, setShowDashboardLink] = useState(false)
  const [showApplyLink, setShowApplyLink] = useState(false)

  useEffect(() => {
    const sb = createClient()
    sb.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { setShowApplyLink(true); return }
      const { data } = await sb.from('profiles').select('role').eq('id', user.id).single()
      const role = (data as { role?: string } | null)?.role
      if (role === 'admin' || role === 'member') setShowDashboardLink(true)
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

  return (
    <div style={{ fontFamily: "'Inter', -apple-system, sans-serif", background: '#0a0a0f', minHeight: '100vh', color: 'var(--color-border)' }}>
      {/* 헤더 — 상단 nav 제거, 로고 + CTA만 */}
      <header style={{ borderBottom: '1px solid #1e293b', padding: '0 2rem', position: 'sticky', top: 0, background: 'rgba(10,10,15,0.95)', backdropFilter: 'blur(12px)', zIndex: 100 }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 56 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <a href="/home" style={{ width: 30, height: 30, borderRadius: 7, background: 'linear-gradient(135deg, var(--brand), var(--brand))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#fff', textDecoration: 'none' }}>A</a>
            <span style={{ fontWeight: 700, fontSize: 15, color: '#f1f5f9' }}>AX API</span>
            <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 100, background: '#1e293b', color: 'var(--brand)', fontWeight: 600 }}>v1</span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {showDashboardLink && (
              <a href="/home" style={{ padding: '6px 14px', borderRadius: 8, background: 'rgba(124,58,237,0.1)', color: '#a5b4fc', fontSize: 13, fontWeight: 500, textDecoration: 'none', border: '1px solid rgba(124,58,237,0.2)' }}>
                ← 대시보드
              </a>
            )}
            {showApplyLink && (
              <a href="/api-access" style={{ padding: '6px 14px', borderRadius: 8, background: 'linear-gradient(135deg, var(--brand), var(--brand))', color: '#fff', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
                API 키 신청 →
              </a>
            )}
            <a href="/api-keys" style={{ padding: '6px 14px', borderRadius: 8, background: 'transparent', color: '#64748b', fontSize: 13, textDecoration: 'none', border: '1px solid #1e293b' }}>
              내 키 관리
            </a>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '2.5rem 2rem', display: 'grid', gridTemplateColumns: '220px 1fr', gap: '3rem' }}>
        {/* 사이드바 */}
        <aside>
          <nav style={{ position: 'sticky', top: 76 }}>
            {[
              { label: '시작하기', items: [{ id: 'overview' as Section, l: '개요' }, { id: 'auth' as Section, l: '인증' }] },
              { label: 'GPU 가격', items: [{ id: 'products' as Section, l: '제품 목록' }, { id: 'quote' as Section, l: '견적 계산' }, { id: 'inventory' as Section, l: '재고 조회' }, { id: 'fx' as Section, l: '환율' }, { id: 'suppliers' as Section, l: '공급사' }, { id: 'market' as Section, l: '시장 비교' }, { id: 'settings' as Section, l: '가격 설정' }, { id: 'pool-stock' as Section, l: '풀 재고' }] },
              { label: 'CRM', items: [{ id: 'accounts' as Section, l: '거래처' }, { id: 'contacts' as Section, l: '담당자' }, { id: 'deals' as Section, l: '영업기회' }] },
              { label: '체험', items: [{ id: 'demo' as Section, l: '🧪 라이브 데모' }] },
              { label: '참조', items: [{ id: 'errors' as Section, l: '오류 코드' }] },
            ].map(({ label, items }) => (
              <div key={label} style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6, padding: '0 12px' }}>{label}</div>
                {items.map(({ id, l }) => (
                  <SidebarItem key={id} active={activeSection === id} onClick={() => setActiveSection(id)}>{l}</SidebarItem>
                ))}
              </div>
            ))}
          </nav>
        </aside>

        {/* 메인 콘텐츠 */}
        <main style={{ minWidth: 0 }}>
          {activeSection === 'overview'   && <OverviewSection onCopy={copy} copiedId={copiedId} />}
          {activeSection === 'auth'       && <AuthSection exampleKey={EXAMPLE_KEY} onCopy={copy} copiedId={copiedId} />}
          {activeSection === 'products'   && <ProductsSection exampleKey={EXAMPLE_KEY} onCopy={copy} copiedId={copiedId} />}
          {activeSection === 'quote'      && <QuoteSection exampleKey={EXAMPLE_KEY} onCopy={copy} copiedId={copiedId} />}
          {activeSection === 'inventory'  && <InventorySection exampleKey={EXAMPLE_KEY} onCopy={copy} copiedId={copiedId} />}
          {activeSection === 'fx'         && <FxSection exampleKey={EXAMPLE_KEY} onCopy={copy} copiedId={copiedId} />}
          {activeSection === 'suppliers'  && <SuppliersSection exampleKey={EXAMPLE_KEY} onCopy={copy} copiedId={copiedId} />}
          {activeSection === 'market'     && <MarketSection exampleKey={EXAMPLE_KEY} onCopy={copy} copiedId={copiedId} />}
          {activeSection === 'settings'   && <SettingsSection exampleKey={EXAMPLE_KEY} onCopy={copy} copiedId={copiedId} />}
          {activeSection === 'pool-stock' && <PoolStockSection exampleKey={EXAMPLE_KEY} onCopy={copy} copiedId={copiedId} />}
          {activeSection === 'accounts'   && <AccountsSection exampleKey={EXAMPLE_KEY} onCopy={copy} copiedId={copiedId} />}
          {activeSection === 'contacts'   && <ContactsSection exampleKey={EXAMPLE_KEY} onCopy={copy} copiedId={copiedId} />}
          {activeSection === 'deals'      && <DealsSection exampleKey={EXAMPLE_KEY} onCopy={copy} copiedId={copiedId} />}
          {activeSection === 'demo'       && <DemoSection />}
          {activeSection === 'errors'     && <ErrorsSection onCopy={copy} copiedId={copiedId} />}
        </main>
      </div>
    </div>
  )
}
