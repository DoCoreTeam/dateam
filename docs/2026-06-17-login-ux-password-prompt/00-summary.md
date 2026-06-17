# FAST PATH Summary — 로그인 UX 점검·문구 명확화 (v0.7.181)

작업: 빈 비밀번호 로그인 실패 시 안내 문구를 "비밀번호가 필요한 계정입니다. 비밀번호를 입력해 주세요"로 명확화.
대상: apps/web/app/(auth)/login/actions.ts (메시지 1곳)
이유: 사용자 요청 — 비밀번호가 설정된 계정엔 '비밀번호 필요'를 명확히 안내. 기존 문구는 생성에러("이메일 또는 비밀번호가 올바르지 않습니다")와 섞여 모호.
영향: 없음(인증 로직·반환형 무변경, 메시지 텍스트만).

## 사용자 요청 4종 — 현황(v0.7.180에 이미 구현, 미배포라 화면 미반영)
- [x] ① 아이디만 입력+엔터 로그인: actions.ts 빈 비번→센티넬 시도 (유지)
- [x] ② 비번 설정 계정 안내: 이번에 문구 명확화
- [x] ③ 실패 시 비번칸 포커스: LoginForm passwordRef + useEffect(state.error) (유지)
- [x] ④ 제출 시 버튼 pending("로그인 중…") + 공용 스피너 AXLoadingOverlay: SubmitButton/PendingOverlay (유지)

→ 핵심: 위 ①③④는 코드에 있으나 teamda.vercel.app 미배포 상태라 안 보였음. 배포 필요.
