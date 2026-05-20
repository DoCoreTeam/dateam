# Test Strategy — newAX v0.2.0

## 핵심 검증 시나리오

### Auth
- 올바른 이메일+비밀번호 → 로그인 성공 → /dashboard 리다이렉트
- 잘못된 비밀번호 → 에러 메시지 표시
- 미로그인 상태 /dashboard 접근 → /login 리다이렉트
- 일반 팀원이 /admin 접근 → 403 또는 /dashboard 리다이렉트

### 루틴 체크
- 체크박스 클릭 → DB 저장 → 새로고침 후 상태 유지
- 다른 사용자의 체크 항목은 보이지 않음

### 주간보고
- 제출 → DB 저장 → 어드민 취합 화면에서 조회 가능
- 같은 주 같은 구분으로 재작성 → 업데이트 (중복 저장 X)

### KPI
- 수치 입력 → 저장 → 히스토리 조회

## GATE 기준
- Next.js 빌드 성공 (npm run build)
- TypeScript 에러 0
- Supabase RLS 적용 확인
