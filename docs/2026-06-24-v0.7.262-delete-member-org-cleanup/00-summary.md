# 구성원 삭제 시 조직도 정리 (A안) — v0.7.262 (FAST)

## 문제
구성원 삭제(deleteUser=profiles 소프트삭제+auth ban)가 org_nodes를 안 건드려, 조직도에 person 노드가 고아로 남음.
근본: org_nodes.user_id는 ON DELETE CASCADE이나 소프트삭제(UPDATE)라 FK 미발동.

## 수정 (app/admin/users/actions.ts deleteUser)
- profile 소프트삭제 후 org_nodes 정리(수동, FK 대체):
  ① type='person' AND user_id=userId 노드 삭제(closure는 ON DELETE CASCADE 동반 정리)
  ② head_user_id=userId 참조 해제(부서장 null) — 삭제된 사람은 로그인 불가라 권한 부작용 없음
  ③ 정리 실패는 console.warn 관측(소프트삭제 본체 롤백 불가)
- revalidatePath: /admin/org-chart, /admin/members, /org 추가.

## 검증 (실데이터)
- 테스트: person노드+부서장참조 시나리오 → 정리 쿼리 → 노드 제거·head null·closure 정리 PASS.
- 기존 고아([E2E]GPU테스트) 정리 완료 → 삭제된 사용자의 잔여 조직도 노드 0.
- 568 테스트·tsc0·next build·DC-REV 89 APPROVED.

## 한계/후속
- person 노드는 리프(자식0 실측)라 안전. 삭제→재초대 시 조직도 재배치는 별도(inviteUser는 노드 미생성).
