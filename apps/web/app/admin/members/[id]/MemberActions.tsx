'use client'

// app/admin/members/[id]/MemberActions.tsx — 계정에 할 수 있는 일
//
// 왜 상세에도 있나 (§2-5 같은 종류 UI는 기능이 같아야 한다): 목록 행의 더보기 안에는
// PW 초기화·온보딩 초기화·퇴사 처리·삭제가 있는데 상세에는 하나도 없었다.
// 상세는 그 대상에 대해 할 수 있는 일이 **모이는** 자리다 — 목록보다 적으면 상세로 올 이유가 없다.
//
// 목록과 같은 부품을 그대로 담는다. 각자 제 확인 절차를 들고 있으므로 여기서 다시 짜지 않는다.

import ResetPasswordButton from '../../users/ResetPasswordButton'
import ResetOnboardingButton from '../../users/ResetOnboardingButton'
import ResignButton from '../../users/ResignButton'
import DeleteUserButton from '../../users/DeleteUserButton'

interface Props {
  userId: string
  userName: string
  userEmail: string
  isSelf: boolean
  isResigned: boolean
}

export default function MemberActions({ userId, userName, userEmail, isSelf, isResigned }: Props) {
  return (
    <div className="card" style={{ padding: 'var(--space-5) var(--space-6)', marginTop: '1.5rem' }}>
      <h2 className="tape-title" style={{ margin: '0 0 var(--space-4)' }}>계정 관리</h2>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
        <ResetPasswordButton userId={userId} userEmail={userEmail} userName={userName} />
        <ResetOnboardingButton userId={userId} userName={userName} />
        <ResignButton userId={userId} userName={userName} isSelf={isSelf} isResigned={isResigned} />
        <DeleteUserButton userId={userId} userName={userName} isSelf={isSelf} />
      </div>
      {isSelf && (
        <p style={{ margin: 'var(--space-3) 0 0', fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
          자기 자신에게는 퇴사 처리와 삭제가 잠겨 있습니다
        </p>
      )}
    </div>
  )
}
