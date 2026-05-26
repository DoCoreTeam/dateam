# Task Breakdown — Google Drive 연동

## Phase 1: DB + 환경 설정
- [ ] migration 014: contacts.business_card_drive_id 추가
- [ ] .env.local에 GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI 추가 (사용자 액션)
- [ ] system_settings RLS 확인

## Phase 2: 백엔드 구현
- [ ] lib/google-drive.ts: getOAuthClient, uploadFile, streamFile, refreshTokenIfNeeded
- [ ] /api/auth/google-drive/route.ts: OAuth 시작
- [ ] /api/auth/google-drive/callback/route.ts: 토큰 교환 + DB 저장
- [ ] /api/files/drive/upload/route.ts: 파일 업로드
- [ ] /api/files/drive/[fileId]/route.ts: 프록시 스트리밍

## Phase 3: 프론트엔드 구현
- [ ] GoogleDriveSettings.tsx: 연결/해제 UI
- [ ] admin/settings/page.tsx: 섹션 추가
- [ ] ContactForm.tsx: 명함 이미지 업로드 필드
- [ ] 담당자 상세 페이지: 명함 이미지 표시

## Phase 4: 가이드 문서
- [ ] 04-user-guide.md: Google Cloud Console 단계별 설정 가이드
