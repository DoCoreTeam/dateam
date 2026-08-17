'use client'

// components/ci/TopicHealthPanel.tsx — 주제 체계가 건강한지 한자리에서 본다
//
// 왜 이 패널이 있는가: 수집함 321건이 전부 '요리'였다. 원인은 둘이었고 둘 다
// 사람이 화면에서 볼 수 없는 곳에 있었다.
//   ① 주제가 하나뿐이라 시스템이 세상을 그 하나로 봤다 → 제안으로 체계를 세운다
//   ② 이미 담긴 게시물에 판단 근거(플랫폼 신호)가 아예 없다 → 다시 받아온다
//
// 그래서 이 패널은 "무엇이 잘못됐나"가 아니라 **지금 누르면 뭐가 좋아지나**를 말한다.
// 할 일이 없으면 아예 그리지 않는다 — 늘 떠 있으면 그때부터 장식이다.

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles, RefreshCw } from 'lucide-react'
import AXDotLoader from '@/components/ui/AXDotLoader'
import type { ApiResponse } from '@/lib/ci/contracts'

interface Proposal {
  name: string
  channelIds: string[]
  channelNames: string[]
  contentCount: number
  signalPatterns: string[]
  categoryPatterns: string[]
  reason: string
}

interface ProposeData {
  proposals: Proposal[]
  unassigned: { channelId: string; displayName: string | null; contentCount: number }[]
  summaryText: string
  unjudgedChannels: number
}

interface BackfillData {
  total: number
  missingSignals: number
}

interface BackfillResult {
  contents: number
  queued: number
  channels: number
  delaySeconds: number
  truncated: boolean
}

interface ProposeResult {
  created: { id: string; name: string }[]
  channels: number
  skipped: string[]
}

/** 초를 사람이 읽는 대기 시간으로. "1800초"는 아무 뜻이 없다. */
function waitText(seconds: number): string {
  const m = Math.ceil(seconds / 60)
  return m <= 1 ? '1분쯤' : `${m}분쯤`
}

export default function TopicHealthPanel({ workspaceId }: { workspaceId: string }) {
  const router = useRouter()
  const [health, setHealth] = useState<BackfillData | null>(null)
  const [propose, setPropose] = useState<ProposeData | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** 사용자가 고른 제안. 이름도 고칠 수 있다 — 확인이지 받아쓰기가 아니다 */
  const [picked, setPicked] = useState<Record<string, string | null>>({})

  const headers = { 'Content-Type': 'application/json', 'X-CI-Workspace': workspaceId }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [h, p] = await Promise.all([
        fetch('/api/ci/topics/backfill', { headers })
          .then((r) => r.json() as Promise<ApiResponse<BackfillData>>),
        fetch('/api/ci/topics/propose', { headers })
          .then((r) => r.json() as Promise<ApiResponse<ProposeData>>),
      ])
      if (h.success) setHealth(h.data)
      if (p.success) {
        setPropose(p.data)
        // 기본은 전부 선택 — 사용자는 빼는 쪽으로 판단한다
        setPicked(Object.fromEntries(p.data.proposals.map((x) => [x.name, x.name])))
      }
    } catch {
      setError('주제 현황을 읽지 못했어요. 새로고침해 주세요')
    } finally { setLoading(false) }
  }, [workspaceId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void load() }, [load])

  /** 신호 다시 받아오기 — 지우는 것이 없어 되돌릴 걱정이 없다 */
  async function runBackfill() {
    setBusy(true); setNotice(null); setError(null)
    try {
      const res = await fetch('/api/ci/topics/backfill', { method: 'POST', headers })
        .then((r) => r.json() as Promise<ApiResponse<BackfillResult>>)
      if (!res.success) { setError(res.error.message); return }
      const d = res.data
      setNotice(
        d.contents === 0
          ? '다시 받아올 게시물이 이미 하나도 남지 않았어요'
          : `게시물 ${d.contents}건을 다시 읽습니다. 채널 ${d.channels}곳은 ${waitText(d.delaySeconds)} 뒤에 다시 판정합니다${d.truncated ? ' (남은 건 다음에 이어서 처리합니다)' : ''}`,
      )
      await load()
      router.refresh()
    } finally { setBusy(false) }
  }

  /** 고른 제안을 주제로 만든다. 규칙까지 함께 만들어야 다음 게시물부터 알아본다 */
  async function createPicked() {
    if (!propose) return
    const chosen = propose.proposals
      .filter((p) => picked[p.name])
      .map((p) => ({
        name: (picked[p.name] ?? p.name).trim(),
        channelIds: p.channelIds,
        signalPatterns: p.signalPatterns.slice(0, 8),
        categoryPatterns: p.categoryPatterns.slice(0, 8),
      }))
      .filter((p) => p.name.length > 0)
    if (chosen.length === 0) return

    setBusy(true); setNotice(null); setError(null)
    try {
      const res = await fetch('/api/ci/topics/propose', {
        method: 'POST', headers, body: JSON.stringify({ proposals: chosen }),
      }).then((r) => r.json() as Promise<ApiResponse<ProposeResult>>)
      if (!res.success) { setError(res.error.message); return }
      const d = res.data
      setNotice(
        `주제 ${d.created.length}개를 만들고 채널 ${d.channels}곳에 붙였습니다. 게시물 재판정은 잠시 뒤 반영됩니다`
        + (d.skipped.length > 0 ? ` (이미 같은 이름이 있어 건너뜀: ${d.skipped.join(', ')})` : ''),
      )
      await load()
      router.refresh()
    } finally { setBusy(false) }
  }

  if (loading) {
    return (
      <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
        <span className="ci-basis"><AXDotLoader size={5} /> 주제 현황을 확인합니다</span>
      </div>
    )
  }

  const proposals = propose?.proposals ?? []
  const missing = health?.missingSignals ?? 0
  const pickedCount = proposals.filter((p) => picked[p.name]).length

  // 할 일이 없으면 화면을 차지하지 않는다. 알림이 뜬 직후만 결과를 보여 준다.
  if (missing === 0 && proposals.length === 0 && !notice && !error) return null

  return (
    <section className="card" style={{ marginBottom: 'var(--space-4)' }}>
      <h2 style={{
        fontSize: 'var(--fs-md)', fontWeight: 700, marginBottom: 'var(--space-1)',
        display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
      }}>
        <Sparkles size={16} aria-hidden /> 주제 점검
      </h2>
      <p className="ci-basis" style={{ marginBottom: 'var(--space-3)' }}>
        게시물이 어떤 주제인지 판정하려면 ① 플랫폼이 준 신호와 ② 고를 수 있는 주제가 둘 다 있어야 합니다
      </p>

      {/* ① 판단 근거 — 신호가 비어 있으면 무엇을 넣어도 분류가 안 된다 */}
      {missing > 0 && (
        <div style={{
          display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-end',
          justifyContent: 'space-between', flexWrap: 'wrap',
          paddingBottom: 'var(--space-3)',
          borderBottom: proposals.length > 0 ? 'var(--hairline) solid var(--border-light)' : undefined,
          marginBottom: proposals.length > 0 ? 'var(--space-3)' : 0,
        }}>
          <div style={{ minWidth: 0 }}>
            <strong className="ci-num">게시물 {missing}건</strong>
            <span> 은 플랫폼 신호 없이 담겼습니다 (전체 <span className="ci-num">{health?.total ?? 0}</span>건)</span>
            <p className="ci-basis">
              담을 때 카테고리·태그를 받아오지 않던 시절의 게시물입니다. 다시 읽어 오면 판정 근거가 생깁니다
            </p>
          </div>
          <button type="button" className="btn-primary" onClick={runBackfill} disabled={busy}>
            <RefreshCw size={15} aria-hidden /> 신호 다시 받아오기
          </button>
        </div>
      )}

      {/* ② 주제 체계 — 데이터가 이미 답을 주고 있다. 사람은 확인만 한다 */}
      {proposals.length > 0 && (
        <div>
          <p style={{ marginBottom: 'var(--space-2)' }}>
            수집한 채널을 보니 이렇게 나뉩니다. 이대로 주제를 만들까요?
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 'var(--space-2)' }}>
            {proposals.map((p) => (
              <li key={p.name} style={{
                display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start',
              }}>
                <input
                  type="checkbox"
                  id={`tp-${p.name}`}
                  checked={Boolean(picked[p.name])}
                  onChange={(e) => setPicked((s) => ({ ...s, [p.name]: e.target.checked ? (s[p.name] ?? p.name) : null }))}
                  style={{ marginTop: '0.7rem' }}
                />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <label className="label" htmlFor={`tn-${p.name}`} style={{ position: 'absolute', left: '-9999px' }}>
                    주제 이름
                  </label>
                  <input
                    className="input-field" id={`tn-${p.name}`}
                    value={picked[p.name] ?? p.name}
                    disabled={!picked[p.name] || busy}
                    onChange={(e) => setPicked((s) => ({ ...s, [p.name]: e.target.value }))}
                    style={{ maxWidth: '18rem' }}
                  />
                  {/* 근거를 같이 보여 준다 — 근거 없이 물으면 사용자도 답할 수가 없다 */}
                  <p className="ci-basis">{p.reason}</p>
                </div>
              </li>
            ))}
          </ul>

          {propose && propose.unassigned.length > 0 && (
            <p className="ci-basis" style={{ marginTop: 'var(--space-2)' }}>
              채널 {propose.unassigned.length}곳은 아직 신호가 모이지 않아 어디에도 넣지 않았습니다
            </p>
          )}

          <div style={{ marginTop: 'var(--space-3)' }}>
            <button type="button" className="btn-primary" onClick={createPicked} disabled={busy || pickedCount === 0}>
              선택한 주제 {pickedCount}개 만들기
            </button>
          </div>
        </div>
      )}

      {/* 결과는 반드시 화면에 남긴다 — 눌러도 아무 일 없어 보이면 두 번째부터 아무도 안 누른다 */}
      {notice && <p className="ci-status ci-status-info" style={{ marginTop: 'var(--space-3)' }}>{notice}</p>}
      {error && <p className="ci-status ci-status-danger" style={{ marginTop: 'var(--space-3)' }}>{error}</p>}
    </section>
  )
}
