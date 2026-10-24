'use client'

/**
 * 참고의 API 변경 내역 절 (P0168)
 *
 * 줄은 lib/api-docs/api-changes.ts selectApiChanges 가 업데이트 내역에서 고른다, 손으로 쓴 목록이 없다
 * 이 화면은 이모지를 그리지 않는다, 업데이트 내역 줄의 emoji 칸은 쓰지 않는다
 */

import { selectApiChanges } from '@/lib/api-docs/api-changes'
import { API_CHANGES_DOC } from '@/lib/api-docs/agent-doc'

const MUTED = { color: 'var(--text-muted)', lineHeight: 1.7, fontSize: 'var(--fs-md)' } as const

export default function ApiChangesSection() {
  const changes = selectApiChanges()
  return (
    <div>
      <h2 style={{ fontSize: 'var(--fs-xl)', fontWeight: 700, color: 'var(--text)', margin: '0 0 var(--space-3)', letterSpacing: '-0.01em' }}>
        {API_CHANGES_DOC.title}
      </h2>
      <p style={{ ...MUTED, marginBottom: 'var(--space-4)' }}>{API_CHANGES_DOC.intro}</p>
      {changes.length === 0 ? (
        <p style={MUTED}>{API_CHANGES_DOC.empty}</p>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--space-5)' }}>
          {changes.map((change) => (
            <section key={change.version} aria-label={`${API_CHANGES_DOC.versionPrefix}${change.version}`}>
              <h3 style={{ fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--text)', margin: '0 0 var(--space-2)', display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', alignItems: 'baseline' }}>
                <span>{API_CHANGES_DOC.versionPrefix}{change.version}</span>
                <time dateTime={change.date} style={{ fontSize: 'var(--fs-xs)', fontWeight: 400, color: 'var(--text-muted)' }}>{change.date}</time>
                {change.title ? <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>{change.title}</span> : null}
              </h3>
              <ul style={{ margin: 0, paddingLeft: 'var(--space-5)', display: 'grid', gap: 'var(--space-2)' }}>
                {change.items.map((item) => (
                  <li key={item.headline} style={MUTED}>
                    <strong style={{ color: 'var(--text)' }}>{item.headline}</strong>
                    <div>{item.detail}</div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
