'use client'

// components/ci/LinkIntakeBox.tsx — 전역 링크 투입 (설계서 §5.3)
// "어느 화면에서든 링크 붙여넣기와 모바일 공유 시트로 수집함에 투입"
// 입구를 하나로 두어야 유입 경로가 갈라지지 않는다.

import { useState } from 'react'
import type { ApiResponse, CiIngestResult } from '@/lib/ci/contracts'
import { isEnterKey } from '@/lib/ui/ime'
import ErrorState from '@/components/ui/ErrorState'
import { wakeQueueDriver } from '@/components/ci/QueueDriver'

interface LinkIntakeBoxProps {
  workspaceId: string
  onDone?: (result: CiIngestResult) => void
  placeholder?: string
  source?: 'inbox' | 'monitoring'
}

export default function LinkIntakeBox({
  workspaceId, onDone, placeholder, source = 'inbox',
}: LinkIntakeBoxProps) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<CiIngestResult | null>(null)
  const [error, setError] = useState<{ code: string; message: string } | null>(null)

  async function submit() {
    const urls = value.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)
    if (urls.length === 0) return

    setBusy(true); setError(null); setResult(null)
    try {
      const res = await fetch('/api/ci/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CI-Workspace': workspaceId },
        body: JSON.stringify({ urls, source }),
      }).then((r) => r.json() as Promise<ApiResponse<CiIngestResult>>)

      if (!res.success) {
        setError({ code: res.error.code, message: res.error.message })
        return
      }

      setResult(res.data)
      if (res.data.accepted.length > 0) {
        setValue('')
        // 큐 구동기의 유휴 유예를 푼다 — 방금 넣은 것이 바로 돌아야 한다
        wakeQueueDriver()
      }
      setBusy(false)

      // 새로고침은 **화면을 확정한 뒤** 건다.
      //
      // 왜 같은 tick에 부르면 안 되는가: `router.refresh()`는 서버 컴포넌트를 다시 그리고,
      // 그게 끝날 때까지 뒤따르는 상태 커밋을 붙잡는다(transition). 그래서 접수는 이미 끝났는데
      // 버튼은 "보내는 중…" 그대로, 입력칸도 안 비워진 채 멈춰 보인다.
      // (실측: API 응답 1.1초인데 화면은 7초가 지나도 그대로였다)
      //
      // 사용자에게 중요한 것은 "받았다"는 확인이고, 목록 갱신은 그다음이다. 순서를 그대로 지킨다.
      setTimeout(() => onDone?.(res.data), 0)
      return
    } catch {
      setError({ code: 'INTERNAL', message: '링크를 보내지 못했습니다. 잠시 후 다시 시도해 주세요' })
    } finally {
      setBusy(false)
    }
  }

  const acceptedChannels = result?.accepted.filter((a) => a.kind === 'channel').length ?? 0
  const acceptedContents = result?.accepted.filter((a) => a.kind === 'content').length ?? 0

  return (
    // 아래 형제와 붙지 않게 이 부품이 자기 아래 여백을 갖는다 — 화면마다 넣으면 한 화면만 빠진다.
    // 실측(#72 [6]): /ci/inbox 입력창 bottom 260 · 주제 점검 카드 top 260 → 간격 0px.
    // 같은 구조가 /ci 홈에도 있어 화면이 아니라 부품에서 고친다(TopicHealthPanel과 같은 규약).
    <div style={{ marginBottom: 'var(--space-4)' }}>
      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'stretch' }}>
        <label className="label" htmlFor="ci-link-intake" style={{ position: 'absolute', left: '-9999px' }}>
          링크 붙여넣기
        </label>
        <input className="input-field"
          id="ci-link-intake"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (isEnterKey(e) && !e.shiftKey) { e.preventDefault(); submit() } }}
          placeholder={placeholder ?? '게시물이나 채널 주소를 붙여넣으세요 (여러 개는 줄바꿈이나 쉼표로 구분)'}
          disabled={busy}
          style={{ flex: 1 }}
        />
        <button type="button" className="btn-primary" onClick={submit} disabled={busy || !value.trim()}>
          {busy ? '보내는 중…' : '추가'}
        </button>
      </div>

      {error && (
        <div style={{ marginTop: 'var(--space-2)' }}>
          <ErrorState message={error.message} code={error.code} />
        </div>
      )}

      {result && (
        <div style={{ marginTop: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          {/* 무엇으로 알아들었는지 밝힌다 — 채널을 넣었는데 "1건 수집"이라고만 하면
              계정 전체를 훑는 중인지 게시물 하나만 담았는지 알 수 없다 */}
          {acceptedChannels > 0 && (
            <p className="ci-status ci-status-ok" style={{ alignSelf: 'flex-start' }}>
              계정 {acceptedChannels}곳을 등록하고 게시물을 훑는 중입니다
            </p>
          )}
          {acceptedContents > 0 && (
            <p className="ci-status ci-status-ok" style={{ alignSelf: 'flex-start' }}>
              게시물 {acceptedContents}건 수집을 시작했습니다 · 그 계정의 다른 게시물도 함께 봅니다
            </p>
          )}
          {result.rejected.map((r) => (
            <p key={r.url} className="ci-status ci-status-warn" style={{ alignSelf: 'flex-start' }}>
              {r.message} — {r.url}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
