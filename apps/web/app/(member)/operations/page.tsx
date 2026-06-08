import { createAdminClient } from '@/lib/supabase/server'

interface Project {
  name: string
  client: string
  target: string
  progress: number
  pm: string
  phase: string
}

interface Member {
  name: string
  role: string
  domain: string
  pm: string[]
  extras: string[]
  timesplit: string
}

interface RhythmData {
  rr_matrix?: string[][]
}

function getPhaseBadgeStyle(phase: string): React.CSSProperties {
  if (phase === '진행중') {
    return {
      background: 'var(--brand-soft)',
      color: 'var(--brand-dark)',
      border: 'var(--hairline) solid var(--brand-soft-2)',
    }
  }
  if (phase === '제안' || phase === '기획') {
    return {
      background: 'var(--warning-bg)',
      color: 'var(--warning)',
      border: 'var(--hairline) solid var(--warning-border)',
    }
  }
  if (phase === '상시') {
    return {
      background: 'var(--color-bg)',
      color: 'var(--text-muted)',
      border: 'var(--border-w-2) solid var(--border-color)',
    }
  }
  if (phase === 'API') {
    return {
      background: 'var(--info-bg)',
      color: 'var(--info)',
      border: 'var(--hairline) solid var(--info-border)',
    }
  }
  return {
    background: 'var(--color-bg)',
    color: 'var(--text-muted)',
    border: 'var(--border-w-2) solid var(--border-color)',
  }
}

export default async function OperationsPage() {
  const adminClient = createAdminClient()

  const { data: projectsRow } = await adminClient
    .from('org_content')
    .select('value')
    .eq('key', 'projects')
    .single() as unknown as { data: { value: unknown } | null; error: unknown }

  const { data: membersRow } = await adminClient
    .from('org_content')
    .select('value')
    .eq('key', 'members')
    .single() as unknown as { data: { value: unknown } | null; error: unknown }

  const { data: rhythmRow } = await adminClient
    .from('org_content')
    .select('value')
    .eq('key', 'rhythm')
    .single() as unknown as { data: { value: unknown } | null; error: unknown }

  const projects = (projectsRow?.value as Project[]) ?? []
  const members = (membersRow?.value as Member[]) ?? []
  const rhythm = rhythmRow?.value as RhythmData | null
  const rrMatrix = rhythm?.rr_matrix ?? []

  const rrHeaders = ['프로젝트', 'PM', '개발 PM', '백엔드', '프론트', '지원']

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '2.5rem',
      }}
    >
      {/* 섹션 1: 진행 프로젝트 */}
      <section>
        <h2
          style={{
            fontSize: '1rem',
            fontWeight: 700,
            color: 'var(--text)',
            letterSpacing: '-0.01em',
            marginBottom: '1rem',
          }}
        >
          진행 프로젝트
        </h2>
        <div className="responsive-grid-cols-2">
          {projects.map((project, idx) => {
            const isDim = project.progress === 0
            return (
              <article
                key={idx}
                style={{
                  background: '#fff',
                  border: 'var(--border-w-2) solid var(--border-color)',
                  borderRadius: 'var(--radius)',
                  padding: '1.25rem 1.5rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem',
                  opacity: isDim ? 0.6 : 1,
                  transition: 'box-shadow 200ms ease',
                }}
              >
                {/* 상단: 이름 + phase badge + progress % */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: '0.75rem',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      flexWrap: 'wrap',
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    <span
                      style={{
                        fontWeight: 700,
                        fontSize: '0.9375rem',
                        color: 'var(--text)',
                        letterSpacing: '-0.01em',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {project.name}
                    </span>
                    <span
                      style={{
                        fontSize: '0.6875rem',
                        fontWeight: 600,
                        padding: '0.15rem 0.5rem',
                        borderRadius: '9999px',
                        whiteSpace: 'nowrap',
                        ...getPhaseBadgeStyle(project.phase),
                      }}
                    >
                      {project.phase}
                    </span>
                  </div>
                  <span
                    style={{
                      fontWeight: 700,
                      fontSize: '1.125rem',
                      color: 'var(--text)',
                      flexShrink: 0,
                      letterSpacing: '-0.02em',
                    }}
                  >
                    {project.progress}%
                  </span>
                </div>

                {/* 프로그레스바 */}
                <div
                  style={{
                    height: '6px',
                    background: 'var(--surface-muted)',
                    borderRadius: '9999px',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${project.progress}%`,
                      borderRadius: '9999px',
                      background:
                        project.phase === '진행중'
                          ? 'linear-gradient(90deg, var(--info), var(--brand), var(--brand))'
                          : 'var(--text-faint)',
                      transition: 'width 600ms cubic-bezier(0.16, 1, 0.3, 1)',
                    }}
                  />
                </div>

                {/* 하단: client · pm · target */}
                <div
                  style={{
                    display: 'flex',
                    gap: '1rem',
                    flexWrap: 'wrap',
                  }}
                >
                  {[
                    { label: '고객사', value: project.client },
                    { label: 'PM', value: project.pm },
                    { label: '대상', value: project.target },
                  ].map(({ label, value }) => (
                    <span
                      key={label}
                      style={{
                        fontSize: '0.75rem',
                        color: 'var(--text-faint)',
                        display: 'flex',
                        gap: '0.25rem',
                      }}
                    >
                      <span style={{ color: 'var(--border-subtle)' }}>{label}</span>
                      <span style={{ color: 'var(--text-muted)' }}>{value}</span>
                    </span>
                  ))}
                </div>
              </article>
            )
          })}
        </div>
      </section>

      {/* 섹션 2: 본부 멤버 */}
      <section>
        <h2
          style={{
            fontSize: '1rem',
            fontWeight: 700,
            color: 'var(--text)',
            letterSpacing: '-0.01em',
            marginBottom: '1rem',
          }}
        >
          본부 멤버
        </h2>
        <div className="responsive-grid-cols-2">
          {members.map((member, idx) => {
            const visiblePMs = member.pm?.slice(0, 3) ?? []
            const extraPMCount = (member.pm?.length ?? 0) - visiblePMs.length
            const visibleExtras = member.extras?.slice(0, 2) ?? []

            return (
              <article
                key={idx}
                style={{
                  background: '#fff',
                  border: 'var(--border-w-2) solid var(--border-color)',
                  borderRadius: 'var(--radius)',
                  padding: '1.25rem 1.5rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem',
                }}
              >
                {/* 이름 + role */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                  <span
                    style={{
                      fontWeight: 700,
                      fontSize: '1.0625rem',
                      color: 'var(--text)',
                      letterSpacing: '-0.01em',
                    }}
                  >
                    {member.name}
                  </span>
                  <span
                    style={{
                      fontSize: '0.75rem',
                      color: 'var(--brand)',
                      fontWeight: 500,
                    }}
                  >
                    {member.role}
                  </span>
                </div>

                {/* domain */}
                {member.domain && (
                  <div
                    style={{
                      background: 'var(--brand-soft)',
                      borderRadius: 'var(--radius)',
                      padding: '0.375rem 0.75rem',
                      fontSize: '0.8125rem',
                      color: 'var(--brand-dark)',
                      fontWeight: 500,
                    }}
                  >
                    {member.domain}
                  </div>
                )}

                {/* timesplit */}
                {member.timesplit && (
                  <span
                    style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-faint)',
                    }}
                  >
                    {member.timesplit}
                  </span>
                )}

                {/* PM 담당 목록 */}
                {visiblePMs.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    <span
                      style={{
                        fontSize: '0.6875rem',
                        fontWeight: 600,
                        color: 'var(--text-faint)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                      }}
                    >
                      PM
                    </span>
                    <ul
                      style={{
                        margin: 0,
                        padding: 0,
                        listStyle: 'none',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.2rem',
                      }}
                    >
                      {visiblePMs.map((pm, i) => (
                        <li
                          key={i}
                          style={{
                            fontSize: '0.8125rem',
                            color: 'var(--text-muted)',
                            paddingLeft: '0.875rem',
                            position: 'relative',
                          }}
                        >
                          <span
                            style={{
                              position: 'absolute',
                              left: 0,
                              color: 'var(--brand-soft-2)',
                            }}
                          >
                            ·
                          </span>
                          {pm}
                        </li>
                      ))}
                      {extraPMCount > 0 && (
                        <li
                          style={{
                            fontSize: '0.75rem',
                            color: 'var(--text-faint)',
                            paddingLeft: '0.875rem',
                          }}
                        >
                          외 {extraPMCount}개
                        </li>
                      )}
                    </ul>
                  </div>
                )}

                {/* extras */}
                {visibleExtras.length > 0 && (
                  <ul
                    style={{
                      margin: 0,
                      padding: 0,
                      listStyle: 'none',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.2rem',
                    }}
                  >
                    {visibleExtras.map((extra, i) => (
                      <li
                        key={i}
                        style={{
                          fontSize: '0.75rem',
                          color: 'var(--text-faint)',
                          paddingLeft: '0.875rem',
                          position: 'relative',
                        }}
                      >
                        <span
                          style={{
                            position: 'absolute',
                            left: 0,
                            color: 'var(--color-border)',
                          }}
                        >
                          ·
                        </span>
                        {extra}
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            )
          })}
        </div>
      </section>

      {/* 섹션 3: R&R 매트릭스 */}
      {rrMatrix.length > 0 && (
        <section>
          <h2
            style={{
              fontSize: '1rem',
              fontWeight: 700,
              color: 'var(--text)',
              letterSpacing: '-0.01em',
              marginBottom: '1rem',
            }}
          >
            R&R 매트릭스
          </h2>
          <div className="table-responsive">
            <table
              className="table-base table-card"
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: '0.875rem',
              }}
            >
              <thead>
                <tr>
                  {rrHeaders.map((header, i) => (
                    <th
                      key={i}
                      style={{
                        padding: '0.75rem 1rem',
                        textAlign: 'left',
                        fontWeight: 600,
                        fontSize: '0.75rem',
                        color: 'var(--text-muted)',
                        background: 'var(--color-bg)',
                        borderBottom: 'var(--border-w-2) solid var(--border-color)',
                        borderRight: i < rrHeaders.length - 1 ? 'var(--border-w-2) solid var(--border-color)' : 'none',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rrMatrix.map((row, rowIdx) => (
                  <tr
                    key={rowIdx}
                    style={{
                      borderBottom:
                        rowIdx < rrMatrix.length - 1 ? 'var(--border-w-2) solid var(--border-color)' : 'none',
                    }}
                  >
                    {row.map((cell, colIdx) => (
                      <td
                        key={colIdx}
                        className={colIdx === 0 ? 'card-header' : undefined}
                        data-label={colIdx > 0 ? rrHeaders[colIdx] : undefined}
                        style={{
                          padding: '0.75rem 1rem',
                          color: colIdx === 0 ? 'var(--text)' : 'var(--text-muted)',
                          fontWeight: colIdx === 0 ? 600 : 400,
                          borderRight:
                            colIdx < row.length - 1 ? 'var(--border-w-2) solid var(--border-color)' : 'none',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
