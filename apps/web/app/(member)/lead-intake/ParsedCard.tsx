import type { ParsedLeadData } from '@/lib/gemini-lead'

export default function ParsedCard({ parsed }: { parsed: ParsedLeadData }) {
  return (
    <div className="parsed-card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: '0.875rem' }}>
        <span className="parsed-card-title">AI 분석 완료</span>
        {parsed.fit_score !== undefined && (
          <span className={`parsed-card-title ${parsed.fit_score >= 70 ? 'parsed-card-fit-high' : 'parsed-card-fit-low'}`}
            style={{ fontSize: '0.8rem' }}>
            Fit {parsed.fit_score}점
          </span>
        )}
      </div>
      <div className="responsive-grid-cols-2" style={{ gap: 'var(--space-3)' }}>
        {parsed.company_name && (
          <div>
            <span className="parsed-field-label">회사명</span>
            <div className="parsed-field-value-lg">{parsed.company_name}</div>
          </div>
        )}
        {parsed.contact_name && (
          <div>
            <span className="parsed-field-label">담당자</span>
            <div className="parsed-field-value-lg" style={{ fontWeight: 400 }}>
              {parsed.contact_name}{parsed.contact_title ? ` · ${parsed.contact_title}` : ''}
            </div>
          </div>
        )}
        {parsed.contact_email && (
          <div>
            <span className="parsed-field-label">이메일</span>
            <div className="parsed-field-value">{parsed.contact_email}</div>
          </div>
        )}
        {parsed.industry && (
          <div>
            <span className="parsed-field-label">업종</span>
            <div className="parsed-field-value">{parsed.industry}</div>
          </div>
        )}
        {parsed.next_action && (
          <div style={{ gridColumn: '1 / -1' }}>
            <span className="parsed-field-label">AI 추천 다음 액션</span>
            <div className="parsed-field-value">{parsed.next_action}</div>
          </div>
        )}
        {parsed.fit_reason && (
          <div style={{ gridColumn: '1 / -1' }}>
            <span className="parsed-field-label">적합도 분석</span>
            <div className="parsed-field-value">{parsed.fit_reason}</div>
          </div>
        )}
      </div>
    </div>
  )
}
