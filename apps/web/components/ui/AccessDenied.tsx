// components/ui/AccessDenied.tsx — 못 들어온 이유를 그 자리에서 말한다 (접근권한 SSOT)
//
// 왜 생겼나 (실측 2026-09-21):
//   구 영업 네 화면(/accounts·/contacts·/deals·/lead-intake)은 `requireAdmin()` 이
//   `/dashboard` 로 보내고 next.config 가 그것을 `/home` 으로 되돌렸다. 즉 **눌렀는데
//   홈에 와 있고 아무 말도 없었다.** 사용자는 자기가 잘못 눌렀다고 생각한다.
//
//   같은 사고를 CRM 레이아웃이 이미 겪고 고쳤다(`CrmDenied`) — 그 주석에 이렇게 적혀 있다:
//   "홈 화면이 그 쿼리를 아무 데서도 표시하지 않아 사용자는 그냥 홈으로 튕긴 것으로만 보였다."
//   그 자리에서 말하면 주소도 그대로라 새로고침해도 같은 안내가 나온다.
//
// 왜 공용인가: 접근권한이 생기면 «못 들어오는 자리»가 표면 수만큼 늘어난다.
//   화면마다 따로 적으면 말이 갈리고, 갈린 말은 사용자에게 다른 사고로 읽힌다.
//
// 셸 안에서 그리는 것이 기본이다 — 사이드바를 그대로 둔 채 이 화면만 막혔다는 것이
// 보여야 «시스템이 고장 난 것»이 아니라 «내 권한이 아직 아닌 것»으로 읽힌다.

import { Lock } from 'lucide-react'
import EmptyState from './EmptyState'

export interface AccessDeniedProps {
  /** 무엇에 못 들어왔나 — 화면 이름을 그대로 쓴다 */
  what: string
  /** 왜 — 사용자의 말로 한 줄. 내부 구조를 싣지 않는다 */
  why?: string
  /** 다음 행동. 기본은 홈으로 */
  action?: { label: string; href: string }
  /**
   * 셸 밖에서 그릴 때. 하위 서비스 셸처럼 «멤버여야 셸이 나오는» 자리에서만 쓴다.
   * 기본은 false — 셸 안에서 그려야 사용자가 자기 위치를 잃지 않는다.
   */
  standalone?: boolean
}

const DEFAULT_WHY = '관리자가 이 화면을 열어 주면 바로 보입니다. 필요하면 관리자에게 요청해 주세요.'

export default function AccessDenied({
  what,
  why = DEFAULT_WHY,
  action = { label: '홈으로 돌아가기', href: '/home' },
  standalone = false,
}: AccessDeniedProps) {
  const body = (
    <EmptyState
      title={`${what}에 접근할 권한이 없습니다`}
      description={why}
      icon={<Lock size={28} />}
      action={action}
    />
  )

  if (!standalone) return body

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--space-4)',
        padding: 'var(--space-6)',
        textAlign: 'center',
        background: 'var(--surface-bg)',
        color: 'var(--text)',
      }}
    >
      {body}
    </main>
  )
}
