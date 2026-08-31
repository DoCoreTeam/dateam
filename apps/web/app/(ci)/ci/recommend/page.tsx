// app/(ci)/ci/recommend/page.tsx — "오늘 뭘 만들까"에 답하는 화면
//
// 이 화면이 생긴 이유(진단 2026-08-27):
//   화면 13개가 전부 "지금 이 단계에 몇 건 있다"를 보여 주고 있었고, 어느 화면도
//   결론을 말하지 않았다. 그래서 판단이 통째로 사용자에게 남았다.
//   "어떤 주제로 할까"에 답하려면 떡상 + 발견 + 비교군이 동시에 필요한데
//   그 셋이 서로 다른 메뉴에 흩어져 있었다.
//
// 판정 기준(§재정의): **문장이 먼저 보이면 편집장, 표가 먼저 보이면 창고.**
//   그래서 이 화면은 목록이 아니라 카드다. 카드마다 무엇을·왜 지금·근거 셋이 함께 있다.
//
// 서버 컴포넌트다 — 읽기만 하는 화면에 클라이언트 번들을 늘리지 않는다.

import { redirect } from 'next/navigation'
import { getRequestUser } from '@/lib/supabase/server'
import { resolveActiveWorkspace } from '@/lib/ci/workspace'
import { getRecommendations } from '@/lib/ci/queries/recommend'
import { getSignals, signalKindLabel } from '@/lib/ci/queries/trends'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'
import SignalSpark from '@/components/ci/SignalSpark'

export const dynamic = 'force-dynamic'

export default async function RecommendPage() {
  const user = await getRequestUser()
  if (!user) redirect('/login')
  const workspace = await resolveActiveWorkspace(user.id)
  if (!workspace) redirect('/ci')

  // 「지금 바깥에서 무슨 일이 있나」와 「우리 판에서 무엇이 통했나」는 다른 질문이다.
  // 둘 다 «오늘 뭘 만들까»의 답이므로 한 화면에서 함께 본다.
  const [{ cards, basisText, emptyReason, discoveryNotice }, signals] = await Promise.all([
    getRecommendations(workspace.id),
    getSignals(workspace.id),
  ])
  const topSignals = signals.slice(0, 5)

  return (
    <>
      <PageHeader
        title="오늘 뭘 만들까"
        description="평소보다 잘된 것과, 왜 잘됐는지"
      />

      {/*
        지금 바깥에서 화제인 것.
        이슈를 등록해도 아무 데도 안 쓰이던 자리를 여기서 닫는다 —
        확인한 이슈가 곧바로 기획으로 넘어간다.
      */}
      {topSignals.length > 0 && (
        <section className="card" style={{ padding: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
          <h2 style={{ fontSize: 'var(--fs-md)', fontWeight: 700, margin: '0 0 var(--space-1)' }}>
            지금 바깥에서 화제인 것
          </h2>
          <p className="ci-basis" style={{ margin: '0 0 var(--space-3)' }}>
            확인을 마친 이슈 {topSignals.length}건 · 트렌드의 「이슈」 탭에서 관리합니다
          </p>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {topSignals.map((sg) => (
              <li key={sg.id}>
                <div style={{ fontWeight: 600 }}>{sg.title}</div>
                <p className="ci-basis" style={{ margin: 'var(--space-1) 0 var(--space-2)' }}>
                  {signalKindLabel(sg.kind)}
                  {sg.source ? ` · ${sg.source}` : ''}
                  {sg.occurredAtText ? ` · ${sg.occurredAtText}` : ''}
                  {sg.topicName ? ` · 주제 ${sg.topicName}` : ''}
                </p>
                <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
                  <SignalSpark
                    workspaceId={workspace.id}
                    title={sg.title}
                    note={[
                      `출처: ${sg.source ?? '미상'}`,
                      sg.url ? `주소: ${sg.url}` : null,
                      sg.reason ? `왜: ${sg.reason}` : null,
                    ].filter(Boolean).join('\n')}
                  />
                  {sg.url && (
                    <a href={sg.url} target="_blank" rel="noopener noreferrer" className="ci-metric">
                      원문 보기
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 숫자에는 항상 기준을 병기한다(설계서 §6.6 정상 상태 규칙) */}
      {basisText && <p className="ci-basis" style={{ marginBottom: 'var(--space-4)' }}>{basisText}</p>}

      {emptyReason ? (
        <EmptyState
          title="아직 추천할 소재가 없습니다"
          description={emptyReason}
          action={{ label: '관심 채널 추가', href: '/ci/monitoring' }}
        />
      ) : (
        <>
          {discoveryNotice && (
            <p
              className="ci-status ci-status-info"
              style={{ display: 'inline-flex', marginBottom: 'var(--space-4)' }}
            >
              {discoveryNotice}
            </p>
          )}

          <div className="ci-card-grid">
            {cards.map((c) => (
              <article key={c.id} className="ci-content-card">
                {c.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    className="ci-thumb" src={c.thumbnailUrl} alt=""
                    loading="lazy" width={320} height={180}
                  />
                ) : (
                  <div className="ci-thumb ci-thumb-empty">썸네일 없음</div>
                )}

                <div className="ci-card-body">
                  <h3 className="ci-card-title">{c.title}</h3>

                  {/* 왜 지금 — 배수와 "무엇과 비교한 값인지"를 반드시 함께 낸다(§4.3) */}
                  <p style={{
                    fontSize: 'var(--fs-lg)', fontWeight: 700,
                    color: 'var(--brand)', margin: 'var(--space-2) 0 0',
                  }}>
                    {c.outlierText ?? '배수 근거 부족'}
                  </p>
                  <p className="ci-basis">{c.cohortText}</p>
                  <p className="ci-basis">{c.channelName}</p>

                  {/* 근거 — 같은 주제에서 서로 다른 채널 3곳 이상 반복 확인된 것만 온다 */}
                  {c.discoveries.length > 0 && (
                    <ul style={{
                      listStyle: 'none', padding: 0,
                      margin: 'var(--space-3) 0 0',
                      borderTop: 'var(--hairline) solid var(--border-color)',
                      paddingTop: 'var(--space-3)',
                    }}>
                      {c.discoveries.map((d) => (
                        <li key={d.id} style={{ marginBottom: 'var(--space-2)' }}>
                          <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text)' }}>
                            {d.statement}
                          </span>
                          <span className="ci-basis" style={{ display: 'block' }}>
                            {d.basisText}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {c.url && (
                    <a
                      href={c.url} target="_blank" rel="noopener noreferrer"
                      style={{
                        display: 'inline-block', marginTop: 'var(--space-3)',
                        fontSize: 'var(--fs-sm)',
                      }}
                    >
                      원본 보기
                    </a>
                  )}
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </>
  )
}
