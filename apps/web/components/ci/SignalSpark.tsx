'use client'

// components/ci/SignalSpark.tsx — 확정된 이슈를 곧바로 기획으로 잇는 버튼
//
// **왜 필요한가**(실측 2026-08-31): 이슈를 등록해도 아무 일도 일어나지 않았다.
// 쓰이는 곳 세 군데(이슈 탭 목록·어시스턴트 조회·보드 핀)가 전부 «보여주기»일 뿐
// 어떤 판단에도 들어가지 않았다. 그 상태에서 자동 수집만 붙이면
// **아무도 안 읽는 목록이 자동으로 길어질 뿐**이다.
//
// 그래서 이슈가 서는 자리를 「오늘 뭘 만들까」로 옮기고, 여기서 한 번에 기획으로 넘긴다.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import type { ApiResponse } from '@/lib/ci/contracts'

interface Props {
  workspaceId: string
  title: string
  /** 왜 이 소재인지 — 아이디어 메모에 근거로 함께 남긴다 */
  note: string
}

export default function SignalSpark({ workspaceId, title, note }: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function make() {
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/ci/ideas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CI-Workspace': workspaceId },
        body: JSON.stringify({ title, note }),
      }).then((r) => r.json() as Promise<ApiResponse<{ id: string }>>)
      // 실패를 조용히 삼키지 않는다 — 눌렀는데 아무 일도 안 나면 두 번째부터 아무도 안 누른다
      if (!res.success) { setError(res.error.message); return }
      router.push('/ci/pipeline')
    } catch {
      setError('연결이 끊겨 만들지 못했습니다')
    } finally { setBusy(false) }
  }

  return (
    <>
      {/* 자작 버튼을 만들지 않는다 — 공용 부품이 높이·상태·질감을 이미 갖고 있다(§2 부품 우선) */}
      <NbButton variant="ghost" onClick={make} disabled={busy}>
        <Sparkles size={14} />
        {busy ? '만드는 중…' : '이 소재로 기획 시작'}
      </NbButton>
      {error && <p className="ci-status ci-status-warn" style={{ marginTop: 'var(--space-2)' }}>{error}</p>}
    </>
  )
}
