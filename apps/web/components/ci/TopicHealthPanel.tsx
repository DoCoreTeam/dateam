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
//
// **지킬 수 없는 약속을 하지 않는다**: 예전엔 채울 것이 하나도 없는데도
// 「신호 다시 받아오기로 근거를 채우면 제안이 나타납니다」라고 안내했다. 눌러도 아무 일이
// 없었고 화면은 영원히 같은 상태였다(사용자 지적 "주제점검쪽 화면 왜 계속 그대로지?").
// 이제 버튼은 **채울 수 있을 때만** 뜨고, 못 채우는 것은 이유를 밝힌다.

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
  /** 신호가 없어 판정할 근거조차 없는 채널 */
  unjudgedChannels: number
  /** 이미 주제가 붙어 제안할 게 없는 채널 */
  assignedChannels: number
  totalChannels: number
}

interface BackfillData {
  total: number
  /** **다시 받아올 수 있는** 신호 없는 게시물 — 버튼이 실제로 처리하는 수 */
  missingSignals: number
  /** 커넥터가 없어 받아올 수 없는 게시물 — 세지만 채울 수 없으므로 따로 밝힌다 */
  unfillable: number
}

interface BackfillResult {
  scanned: number
  filled: number
  channels: number
  remaining: number | null
  reason: 'no_api_key' | null
}

interface ProposeResult {
  created: { id: string; name: string }[]
  channels: number
  skipped: string[]
}

export default function TopicHealthPanel({ workspaceId }: { workspaceId: string }) {
  const router = useRouter()
  const [health, setHealth] = useState<BackfillData | null>(null)
  const [propose, setPropose] = useState<ProposeData | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /**
   * 고른 제안 — **선택 여부만** 담는다.
   *
   * 왜 이름과 나눠 두는가: 예전엔 한 칸이 선택 여부와 이름을 겸했다. 그래서 이름을 지우면
   * 빈 문자열이 "선택 안 함"으로 읽혀 체크가 풀리고 입력칸이 잠겼고, 다시 체크해도 `??`가
   * 빈 문자열을 통과시켜 **새로고침 전까지 그 행이 죽었다**(G3 발견 ①).
   */
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  /** 사용자가 고친 이름. 확인이지 받아쓰기가 아니다 */
  const [names, setNames] = useState<Record<string, string>>({})

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
        setPicked(Object.fromEntries(p.data.proposals.map((x) => [x.name, true])))
        setNames(Object.fromEntries(p.data.proposals.map((x) => [x.name, x.name])))
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
      if (d.reason === 'no_api_key') {
        setError('유튜브 API 키가 설정되지 않아 신호를 받아올 수 없어요. 설정에서 키를 넣어 주세요')
        return
      }
      setNotice(
        d.filled === 0
          ? (d.scanned === 0
            ? '다시 받아올 게시물이 이미 하나도 남지 않았어요'
            : `게시물 ${d.scanned}건을 확인했지만 플랫폼이 주제 신호를 주지 않았어요`)
          : `게시물 ${d.filled}건에 신호를 채우고 채널 ${d.channels}곳을 다시 판정했어요`
            + (d.remaining ? ` (남은 ${d.remaining}건은 한 번 더 누르면 이어서 채웁니다)` : ''),
      )
      await load()
      router.refresh()
    } finally { setBusy(false) }
  }

  /** 고른 제안을 주제로 만든다. 규칙까지 함께 만들어야 다음 게시물부터 알아본다 */
  async function createPicked() {
    if (!propose) return
    // 빈 이름을 여기서 조용히 버리지 않는다 — 버리면 눌러도 아무 일이 없고,
    // 사용자는 왜 안 만들어졌는지 알 수 없다. 서버가 "주제 이름을 입력해 주세요"라고 말하게 둔다.
    const chosen = propose.proposals
      .filter((p) => picked[p.name])
      .map((p) => ({
        name: (names[p.name] ?? p.name).trim(),
        channelIds: p.channelIds,
        signalPatterns: p.signalPatterns.slice(0, 8),
        categoryPatterns: p.categoryPatterns.slice(0, 8),
      }))
    if (chosen.length === 0) return

    setBusy(true); setNotice(null); setError(null)
    try {
      const res = await fetch('/api/ci/topics/propose', {
        method: 'POST', headers, body: JSON.stringify({ proposals: chosen }),
      }).then((r) => r.json() as Promise<ApiResponse<ProposeResult>>)
      if (!res.success) { setError(res.error.message); return }
      const d = res.data
      setNotice(
        `주제 ${d.created.length}개를 만들고 채널 ${d.channels}곳에 붙였습니다. 게시물도 함께 다시 판정했어요`
        + (d.skipped.length > 0 ? ` (이미 같은 이름이 있어 건너뜀: ${d.skipped.join(', ')})` : ''),
      )
      await load()
      router.refresh()
    } finally { setBusy(false) }
  }

  /**
   * 채널이 몇 곳이고 그중 몇 곳이 아직 판정되지 않았는지 — 한 문장.
   *
   * 왜 공용으로 두는가: 이 숫자는 제안이 0건일 때만 필요한 게 아니다. 제안이 **적을** 때도
   * 사용자는 "왜 이것뿐이지"를 묻는다(G3 발견 ③). 예전엔 0건 분기에만 있어서, 제안이
   * 1건이라도 나오면 근거가 통째로 사라졌다. 두 분기가 같은 문장을 쓰게 해서 갈리지 않게 한다.
   */
  function channelCounts(d: ProposeData) {
    return (
      <p className="ci-basis">
        채널 <span className="ci-num">{d.totalChannels}</span>곳 가운데{' '}
        <span className="ci-num">{d.unjudgedChannels}</span>곳은 게시물에 플랫폼 신호가 담기지
        않아 무엇에 대한 채널인지 아직 판정하지 못했습니다
        {d.assignedChannels > 0 && (
          <>, <span className="ci-num">{d.assignedChannels}</span>곳은 이미 주제가 붙어 있습니다</>
        )}
      </p>
    )
  }

  if (loading) {
    return (
      <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
        <span className="ci-basis"><AXDotLoader size={5} /> 주제 현황을 확인합니다</span>
      </div>
    )
  }

  const proposals = propose?.proposals ?? []
  /** 지금 눌러서 채울 수 있는 게시물 수 — 이 값이 0이면 버튼을 그리지 않는다 */
  const missing = health?.missingSignals ?? 0
  /** 신호는 없지만 커넥터가 없어 채울 수 없는 게시물 수 */
  const unfillable = health?.unfillable ?? 0
  const pickedCount = proposals.filter((p) => picked[p.name]).length

  /**
   * 제안이 0건인데 **판정할 근거가 없는 채널이 있는** 상태.
   *
   * 왜 따로 두는가: 0건인 것 자체는 결함이 아니지만, 화면이 **왜 0건인지 말하지 않으면**
   * 사용자는 빈 화면을 보고 아무것도 알 수 없다(G3 발견 A: API가 이유를 계산해 보내는데
   * 화면이 그 값을 인터페이스에 선언만 하고 버렸다). 채널이 전부 주제에 붙은 상태는
   * 할 일이 없으므로 여전히 숨긴다 — 여기서 말해야 할 것은 **막힌 이유**뿐이다.
   */
  const stalled = proposals.length === 0 && (propose?.unjudgedChannels ?? 0) > 0
  const hasTopicSection = proposals.length > 0 || stalled

  // 할 일이 없으면 화면을 차지하지 않는다. 알림이 뜬 직후만 결과를 보여 준다.
  //
  // 채울 수 없는 게시물(unfillable)만 남은 상태는 **할 일이 아니다** — 그것만으로 카드를
  // 띄우면 누를 것도 없는 줄이 영구히 남는다. 그 수는 아래 stalled 분기에서 이유로 밝힌다.
  if (missing === 0 && !hasTopicSection && !notice && !error) return null

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

      {/* ① 판단 근거 — 신호가 비어 있으면 무엇을 넣어도 분류가 안 된다.
          **채울 수 있을 때만** 그린다. 못 채우는 것을 여기 세면 눌러도 안 변하는 줄이 남는다. */}
      {missing > 0 && (
        <div style={{
          display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-end',
          justifyContent: 'space-between', flexWrap: 'wrap',
          paddingBottom: 'var(--space-3)',
          borderBottom: hasTopicSection ? 'var(--hairline) solid var(--border-light)' : undefined,
          marginBottom: hasTopicSection ? 'var(--space-3)' : 0,
        }}>
          <div style={{ minWidth: 0 }}>
            <strong className="ci-num">게시물 {missing}건</strong>
            <span>은 플랫폼 신호 없이 담겼습니다 (전체 <span className="ci-num">{health?.total ?? 0}</span>건)</span>
            <p className="ci-basis">
              담을 때 카테고리·태그를 받아오지 않던 시절의 게시물입니다. 다시 읽어 오면 판정 근거가 생깁니다
            </p>
            {unfillable > 0 && (
              <p className="ci-basis">
                이와 별개로 <span className="ci-num">{unfillable}</span>건은 유튜브가 아니어서
                유튜브가 아니어서 이 버튼으로는 신호를 채우지 못합니다
              </p>
            )}
          </div>
          <button type="button" className="btn-primary" onClick={runBackfill} disabled={busy}>
            <RefreshCw size={15} aria-hidden /> 신호 다시 받아오기
          </button>
        </div>
      )}

      {/* ②-a 제안이 0건일 때 — 왜 없는지 말한다. 빈 화면은 사용자에게 아무것도 알려 주지 않는다 */}
      {stalled && propose && (
        <div>
          <p style={{ marginBottom: 'var(--space-1)' }}>{propose.summaryText}</p>
          {channelCounts(propose)}
          <p className="ci-basis">
            {missing > 0
              ? '위의 「신호 다시 받아오기」로 근거를 채우면 판정되는 채널부터 제안이 나타납니다'
              : unfillable > 0
                ? `신호 없이 담긴 ${unfillable}건은 유튜브가 아니라 다시 받아오지 못합니다. 게시물이 더 모이면 자동으로 제안이 나타납니다`
                : '지금 다시 받아올 신호는 남아 있지 않습니다. 게시물이 더 모이면 자동으로 제안이 나타납니다'}
          </p>
        </div>
      )}

      {/* ②-b 주제 체계 — 데이터가 이미 답을 주고 있다. 사람은 확인만 한다 */}
      {proposals.length > 0 && propose && (
        <div>
          <p style={{ marginBottom: 'var(--space-2)' }}>
            수집한 채널을 보니 이렇게 나뉩니다. 이대로 주제를 만들까요?
          </p>
          {/* 제안이 있을 때도 남은 채널을 밝힌다 — "왜 이것뿐이지"의 답이다(G3 발견 ③) */}
          {propose.unjudgedChannels > 0 && channelCounts(propose)}
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 'var(--space-2)' }}>
            {proposals.map((p) => (
              <li key={p.name} style={{
                display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start',
              }}>
                <input
                  type="checkbox"
                  id={`tp-${p.name}`}
                  checked={Boolean(picked[p.name])}
                  onChange={(e) => setPicked((s) => ({ ...s, [p.name]: e.target.checked }))}
                  style={{ marginTop: '0.7rem' }}
                />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <label className="label" htmlFor={`tn-${p.name}`} style={{ position: 'absolute', left: '-9999px' }}>
                    주제 이름
                  </label>
                  <input
                    className="input-field" id={`tn-${p.name}`}
                    value={names[p.name] ?? p.name}
                    disabled={!picked[p.name] || busy}
                    onChange={(e) => setNames((s) => ({ ...s, [p.name]: e.target.value }))}
                    style={{ maxWidth: '18rem' }}
                  />
                  {/* 근거를 같이 보여 준다 — 근거 없이 물으면 사용자도 답할 수가 없다 */}
                  <p className="ci-basis">{p.reason}</p>
                </div>
              </li>
            ))}
          </ul>

          {propose.unassigned.length > 0 && (
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
