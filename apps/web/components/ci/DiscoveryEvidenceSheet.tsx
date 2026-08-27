'use client'

// components/ci/DiscoveryEvidenceSheet.tsx — 발견의 근거 시트
//
// 왜 이 화면이 생겼나(2026-08-27 실측):
//   성공 공식 목록은 "근거 7건 · 채널 4곳"이라는 **숫자만** 보여주고, 행을 눌러도
//   하이라이트만 됐다(§2-3-1 (1) 위반). 정작 근거는 `ci_discovery_evidence` 에
//   observation("잘된 것의 제목은 …인 반면, 평범한 3건은 …")까지 붙어 43건이
//   저장돼 있었고, 읽는 코드가 0건이었다.
//
//   근거를 못 여는 발견은 "믿어라"는 말과 같다. 이 시트가 그 말을 근거로 바꾼다.

import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useEscClose } from '@/lib/use-esc-close'
import { SkelList } from '@/components/ui/LoadingSkeleton'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'
import type { DiscoveryEvidence } from '@/lib/ci/queries/discovery-evidence'
import type { ApiResponse } from '@/lib/ci/contracts'

interface Props {
  discoveryId: string
  workspaceId: string
  /** 목록이 이미 아는 문장 — 여는 순간 헤더가 비지 않게 미리 그린다 */
  statement: string
  onClose: () => void
}

export default function DiscoveryEvidenceSheet({
  discoveryId, workspaceId, statement, onClose,
}: Props) {
  useEscClose(onClose)

  const [data, setData] = useState<DiscoveryEvidence | null>(null)
  const [error, setError] = useState<{ code: string; message: string } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)

    fetch(`/api/ci/discoveries/${discoveryId}/evidence`, {
      headers: { 'X-CI-Workspace': workspaceId },
    })
      .then((r) => r.json() as Promise<ApiResponse<DiscoveryEvidence>>)
      .then((res) => {
        if (!alive) return
        if (res.success) setData(res.data)
        else setError({ code: res.error.code, message: res.error.message })
      })
      .catch((e: unknown) => {
        // 조용히 삼키면 사용자는 빈 시트를 고장으로 읽는다
        if (alive) setError({ code: 'NETWORK', message: e instanceof Error ? e.message : '근거를 불러오지 못했습니다.' })
      })
      .finally(() => { if (alive) setLoading(false) })

    return () => { alive = false }
  }, [discoveryId, workspaceId])

  return (
    <div className="ci-sheet-backdrop" onClick={onClose} role="presentation">
      <aside
        className="ci-sheet"
        style={{ width: 'min(560px, 100%)' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="발견의 근거"
      >
        <header className="ci-sheet-head">
          <h2 className="tape-title" style={{ margin: 0 }}>발견의 근거</h2>
          <button type="button" className="btn-ghost" onClick={onClose} aria-label="닫기">
            <X size={18} />
          </button>
        </header>

        <div className="ci-sheet-body">
          {/* 무엇에 대한 근거인지 먼저 — 목록에서 넘어온 문장을 그대로 쓴다 */}
          <p style={{ fontSize: 'var(--fs-base)', fontWeight: 700, lineHeight: 1.6, margin: 0 }}>
            {data?.statement ?? statement}
          </p>
          {data && (
            <p className="ci-basis" style={{ marginTop: 'var(--space-2)' }}>
              {data.basisText}
              {data.topicName ? ` · ${data.topicName}` : ''}
            </p>
          )}

          <div
            role="presentation"
            style={{
              borderTop: 'var(--hairline) solid var(--border-light)',
              margin: 'var(--space-4) 0',
            }}
          />

          {loading && <SkelList rows={4} />}

          {error && (
            <ErrorState
              message={error.message}
              code={error.code}
              onRetry={() => setData(null)}
            />
          )}

          {!loading && !error && data && data.items.length === 0 && (
            <EmptyState
              title="이 발견에 딸린 게시물이 없습니다"
              description="근거가 된 게시물이 지워졌을 수 있습니다. 다시 계산하면 살아 있는 근거만 남습니다."
            />
          )}

          {!loading && !error && data && data.items.length > 0 && (
            <ul style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              {data.items.map((it) => (
                <li key={it.contentId} className="card" style={{ padding: 'var(--space-3)' }}>
                  <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start' }}>
                    {it.thumbnailUrl && (
                      // 목록 썸네일과 같은 크기 — 어느 게시물인지 눈으로 먼저 찾는다
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={it.thumbnailUrl}
                        alt=""
                        width={96}
                        height={54}
                        loading="lazy"
                        style={{
                          width: '96px', height: '54px', objectFit: 'cover',
                          borderRadius: 'var(--radius)', flexShrink: 0,
                        }}
                      />
                    )}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p style={{ fontWeight: 600, fontSize: 'var(--fs-sm)', margin: 0, lineHeight: 1.5 }}>
                        {it.canonicalUrl
                          ? (
                            <a href={it.canonicalUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--text)' }}>
                              {it.title ?? '제목 없음'}
                            </a>
                          )
                          : (it.title ?? '제목 없음')}
                      </p>
                      {it.channelName && <p className="ci-basis" style={{ marginTop: '2px' }}>{it.channelName}</p>}
                    </div>
                  </div>

                  {/* 이 시트의 존재 이유 — "왜 그렇게 봤나"가 여기 있다 */}
                  {it.observation && (
                    <p style={{
                      marginTop: 'var(--space-3)',
                      fontSize: 'var(--fs-sm)',
                      lineHeight: 1.7,
                      color: 'var(--text-muted)',
                    }}>
                      {it.observation}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  )
}
