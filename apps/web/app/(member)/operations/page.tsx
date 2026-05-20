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
      background: '#eef2ff',
      color: '#4f46e5',
      border: '1px solid #c7d2fe',
    }
  }
  if (phase === '제안' || phase === '기획') {
    return {
      background: '#fffbeb',
      color: '#d97706',
      border: '1px solid #fde68a',
    }
  }
  if (phase === '상시') {
    return {
      background: '#f8fafc',
      color: '#64748b',
      border: '1px solid #e2e8f0',
    }
  }
  if (phase === 'API') {
    return {
      background: '#f0f9ff',
      color: '#0284c7',
      border: '1px solid #bae6fd',
    }
  }
  return {
    background: '#f8fafc',
    color: '#64748b',
    border: '1px solid #e2e8f0',
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
        padding: '2rem',
        maxWidth: '1100px',
        margin: '0 auto',
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
            color: '#0f172a',
            letterSpacing: '-0.01em',
            marginBottom: '1rem',
          }}
        >
          진행 프로젝트
        </h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '1rem',
          }}
        >
          {projects.map((project, idx) => {
            const isDim = project.progress === 0
            return (
              <article
                key={idx}
                style={{
                  background: '#fff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '1rem',
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
                        color: '#0f172a',
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
                      color: '#0f172a',
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
                    background: '#f1f5f9',
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
                          ? 'linear-gradient(90deg, #0ea5e9, #6366f1, #a855f7)'
                          : '#94a3b8',
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
                        color: '#94a3b8',
                        display: 'flex',
                        gap: '0.25rem',
                      }}
                    >
                      <span style={{ color: '#cbd5e1' }}>{label}</span>
                      <span style={{ color: '#64748b' }}>{value}</span>
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
            color: '#0f172a',
            letterSpacing: '-0.01em',
            marginBottom: '1rem',
          }}
        >
          본부 멤버
        </h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '1rem',
          }}
        >
          {members.map((member, idx) => {
            const visiblePMs = member.pm?.slice(0, 3) ?? []
            const extraPMCount = (member.pm?.length ?? 0) - visiblePMs.length
            const visibleExtras = member.extras?.slice(0, 2) ?? []

            return (
              <article
                key={idx}
                style={{
                  background: '#fff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '1rem',
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
                      color: '#0f172a',
                      letterSpacing: '-0.01em',
                    }}
                  >
                    {member.name}
                  </span>
                  <span
                    style={{
                      fontSize: '0.75rem',
                      color: '#6366f1',
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
                      background: '#eef2ff',
                      borderRadius: '0.5rem',
                      padding: '0.375rem 0.75rem',
                      fontSize: '0.8125rem',
                      color: '#3730a3',
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
                      color: '#94a3b8',
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
                        color: '#94a3b8',
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
                            color: '#475569',
                            paddingLeft: '0.875rem',
                            position: 'relative',
                          }}
                        >
                          <span
                            style={{
                              position: 'absolute',
                              left: 0,
                              color: '#c7d2fe',
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
                            color: '#94a3b8',
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
                          color: '#94a3b8',
                          paddingLeft: '0.875rem',
                          position: 'relative',
                        }}
                      >
                        <span
                          style={{
                            position: 'absolute',
                            left: 0,
                            color: '#e2e8f0',
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
              color: '#0f172a',
              letterSpacing: '-0.01em',
              marginBottom: '1rem',
            }}
          >
            R&R 매트릭스
          </h2>
          <div
            style={{
              background: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: '1rem',
              overflowX: 'auto',
            }}
          >
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: '0.875rem',
                minWidth: '560px',
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
                        color: '#64748b',
                        background: '#f8fafc',
                        borderBottom: '1px solid #e2e8f0',
                        borderRight: i < rrHeaders.length - 1 ? '1px solid #e2e8f0' : 'none',
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
                        rowIdx < rrMatrix.length - 1 ? '1px solid #e2e8f0' : 'none',
                    }}
                  >
                    {row.map((cell, colIdx) => (
                      <td
                        key={colIdx}
                        style={{
                          padding: '0.75rem 1rem',
                          color: colIdx === 0 ? '#0f172a' : '#475569',
                          fontWeight: colIdx === 0 ? 600 : 400,
                          borderRight:
                            colIdx < row.length - 1 ? '1px solid #e2e8f0' : 'none',
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
