# FAST PATH Summary — v0.7.180 로그인 UX 강화

작업: 로그인 화면 UX 2건(무관) 동시 — ① 엔터 제출 + 실패 시 비밀번호칸 자동 포커스(+이메일 보존) ② 제출 시 회사 로고 로딩 애니메이션으로 반응 가시화

대상:
- `app/(auth)/login/page.tsx` — 폼을 클라이언트 컴포넌트로 위임, error/email/brandName 전달
- `app/(auth)/login/LoginForm.tsx` (신규) — 클라이언트 폼: useFormStatus 로딩 오버레이 + 에러 시 비밀번호 포커스 + 이메일 prefill
- `app/(auth)/login/actions.ts` — 로그인 실패 redirect에 email 쿼리 보존(prefill용)

재사용(무수정): `components/ui/AXLoadingOverlay.tsx`(브랜드 char-wave + 진행바, SSOT 로딩 오버레이)

이유:
- ① ID만 입력+엔터 시 제출은 네이티브 폼으로 되나, 실패 시 비번칸으로 커서가 안 가 재입력이 불편 → 자동 포커스. 서버컴포넌트라 포커스 불가 → 폼만 클라이언트로 분리.
- ② 제출 시 시각 피드백이 전혀 없어 "눌렸는지" 불분명 → 회사 로고가 나타나는 듯한 전체화면 로딩 오버레이(기존 SSOT 재사용)로 액션 명확화.

영향: 로그인 페이지 한정. 인증 로직(signIn 센티넬 플로우)·비밀번호 정책 무변경. 다른 세션과 파일 충돌 없음(로그인 전용 파일만 수정).

검증: tsc --noEmit, pnpm design:check, 🟥 DC-REV.
