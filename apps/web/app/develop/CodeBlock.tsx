'use client'

/**
 * 개발자센터의 코드 덩이 하나 — 복사 단추가 붙은 `pre`
 *
 * **왜 부품으로 뺐나**: `page.tsx` 안에만 있어서 새 항목(AI 공통층)이 같은 것을 다시 짰다.
 * 두 벌이 된 순간 한쪽만 고쳐지고, 실제로 그렇게 복사 단추의 색이 갈릴 뻔했다.
 * 이 저장소가 표를 네 방식으로 그리게 된 경로가 그것이다.
 */

interface Props {
  code: string
  id: string
  onCopy: (text: string, id: string) => void
  copiedId: string | null
  lang?: string
}

export default function CodeBlock({ code, id, onCopy, copiedId, lang = 'bash' }: Props) {
  const copied = copiedId === id
  return (
    <div className="card card-flush" style={{ overflow: 'hidden', marginBottom: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--space-2) var(--space-3)', borderBottom: 'var(--hairline) solid var(--border-light)' }}>
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{lang}</span>
        {/* 「됐다」를 인라인 색으로 말하지 않는다 — 상태는 클래스, 색은 토큰 */}
        <button type="button" className={copied ? 'btn-ghost is-done' : 'btn-ghost'} onClick={() => onCopy(code, id)}>
          {copied ? '✓ 복사됨' : '복사'}
        </button>
      </div>
      <pre style={{ margin: 0, padding: 'var(--space-5) var(--space-6)', fontSize: 'var(--fs-sm)', lineHeight: 1.7, color: 'var(--text)', background: 'var(--surface-muted)', overflowX: 'auto', whiteSpace: 'pre' }}>{code}</pre>
    </div>
  )
}
