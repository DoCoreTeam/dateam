'use client'

// components/ui/shell/ShellExit.tsx — 하위 서비스에서 나가는 문 (정책 §2-3-3 N-2)
//
// **왜 부품인가**: 나가는 문이 화면마다 따로 달려 있었다. CI 는 사이드바 하단에 「사내 업무로」,
// CRM 은 계정 메뉴에만 「홈으로 나가기」, 관리자는 「멤버 화면으로」 — **셋 다 `/home` 으로 간다.**
// 자리가 둘이고 문구가 셋이면 사용자는 **서로 다른 곳으로 가는 줄** 안다.
//
// 그래서 셸이 스스로 판정하고 스스로 그린다. 화면은 아무것도 넘기지 않는다 —
// 넘기게 두면 넘기는 것을 잊은 서비스에만 문이 없어진다(그게 CRM 이었다).

import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { surfaceOf } from '@/lib/nav/surface'
import { EXIT_TO_MAIN } from '@/lib/nav/menu'

export default function ShellExit() {
  const surface = surfaceOf(usePathname())
  // 이미 메인이면 나갈 곳이 없다 — 지금 있는 곳으로 가는 링크는 소음이다
  if (surface === 'member') return null

  return (
    <div className="shell-workspace">
      <Link className="shell-workspace-exit" href={EXIT_TO_MAIN.href}>
        <ArrowLeft size={16} />
        {EXIT_TO_MAIN.label}
      </Link>
    </div>
  )
}
