'use client'

import SegmentedTabs from '@/components/ui/SegmentedTabs'
import { LANGUAGES, type RequestSpec } from '@/lib/api-docs/snippets'
import { useApiLang, useApiLanguage } from './api-lang'

interface CodeTabsProps {
  spec: RequestSpec
  baseUrl: string
  id: string
  onCopy: (text: string, id: string) => void
  copiedId: string | null
}

// 엔드포인트 요청 1개(RequestSpec)를 언어 탭으로 렌더.
// 탭 렌더러는 SegmentedTabs(SSOT) — 여기서 tablist를 자작하지 않는다.
// 스니펫은 lib/api-docs/snippets(SSOT)에서 생성 — 화면에서 손코딩하지 않는다.
export default function CodeTabs({ spec, baseUrl, id, onCopy, copiedId }: CodeTabsProps) {
  // 언어는 화면 전체가 한 벌을 쓴다 — 블록마다 다시 고르게 두지 않는다(api-lang.tsx)
  const { langId, setLangId } = useApiLang()
  const lang = useApiLanguage()
  const code = lang.generate(spec, baseUrl)
  const copyId = `${id}-${lang.id}`
  // 한 화면에 CodeTabs가 여러 개 뜬다(엔드포인트마다 1개).
  // SegmentedTabs는 탭 id로 DOM id(segtab-*)를 만들고 ←/→ 이동 때 getElementById로 포커스를 옮긴다.
  // 인스턴스별로 네임스페이스하지 않으면 id가 중복돼 포커스가 화면 첫 코드블록으로 튄다.
  const ns = `${id}__`

  return (
    <div style={{ marginBottom: 'var(--space-4)' }}>
      <SegmentedTabs
        ariaLabel="언어 선택"
        tabs={LANGUAGES.map(l => ({ id: ns + l.id, label: l.label }))}
        activeId={ns + langId}
        onSelect={(tabId) => setLangId(tabId.slice(ns.length))}
      />

      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)', padding: 'var(--space-2) var(--space-3)', borderBottom: 'var(--hairline) solid var(--border-light)' }}>
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{lang.label}</span>
          <button type="button" className="btn-ghost" onClick={() => onCopy(code, copyId)}>
            {copiedId === copyId ? '✓ 복사됨' : '복사'}
          </button>
        </div>
        <pre style={{ margin: 0, padding: 'var(--space-5) var(--space-6)', fontSize: 'var(--fs-sm)', lineHeight: 1.7, color: 'var(--text)', background: 'var(--surface-muted)', overflowX: 'auto', whiteSpace: 'pre' }}>{code}</pre>
      </div>
    </div>
  )
}
