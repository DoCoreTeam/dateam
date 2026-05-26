# 04. 완료 조건 — 시스템 로고·브랜드명 관리

## 기능 완료 기준

### DB·Storage
- [ ] `supabase/migrations/008_system_settings.sql` 존재 및 적용 완료
- [ ] `system_settings` 테이블에 `logo_url`, `brand_name` 기본 row 존재
- [ ] RLS: 로그인 사용자 읽기 가능, admin만 쓰기 가능
- [ ] Supabase Storage `branding` 버킷 생성 및 public read 정책 적용

### API
- [ ] `GET /api/settings/branding` → `{ logoUrl, brandName }` 반환
- [ ] `GET` — 비인증 요청도 200 반환 (public)
- [ ] `POST /api/admin/settings/branding` — admin 200, 비admin 403
- [ ] `POST` — 2MB 초과 파일 400 에러
- [ ] `POST` — 업로드 성공 시 구 로고 Storage에서 삭제

### 어드민 UI
- [ ] `/admin/settings` 접속 시 "브랜딩 설정" 섹션 표시
- [ ] 로고 미리보기 영역 — 현재 로고 or 플레이스홀더 표시
- [ ] 파일 선택 후 미리보기 즉시 업데이트
- [ ] 저장 버튼 클릭 시 API 호출 → 성공 토스트
- [ ] 사이드바 메뉴에 "시스템 설정" 항목 표시 (admin만)

### 반영 위치
- [ ] 사이드바 상단: 로고 이미지 or 브랜드명 텍스트 동적 표시
- [ ] 로딩 애니메이션: 로고 or 브랜드명 동적 표시 (기존 애니메이션 유지)
- [ ] 로그인 화면: 로고 or 브랜드명 표시

### 폴백
- [ ] 로고 미설정 → 브랜드명 텍스트 표시
- [ ] 브랜드명 미설정 → "AX사업본부" 기본값
- [ ] img 로드 실패 → 브랜드명 텍스트로 자동 전환 (onError)
- [ ] API 실패 → 기본값("AX사업본부") 표시, 에러 미노출

### 코드 품질
- [ ] 하드코딩 "AX사업본부" 문자열 코드에서 제거 (기본값은 상수로)
- [ ] TypeScript 타입 체크 통과 (`npx tsc --noEmit`)
- [ ] SVG 파일을 img 태그로만 렌더링 (XSS 방지)
- [ ] Storage 업로드는 서버 사이드에서만 (클라이언트에서 직접 업로드 금지)
