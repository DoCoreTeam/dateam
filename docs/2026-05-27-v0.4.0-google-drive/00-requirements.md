# Requirements — Google Drive 스토리지 연동

## 배경
- contacts 폼에 명함 이미지 업로드 필요
- 향후 파일이 많아질 것을 고려해 Google Drive를 기본 스토리지로 채택
- 어드민이 자신의 Google 계정(OAuth)으로 Drive 연결

## 기능 요구사항
1. 어드민 시스템설정 → "Google Drive 연결" 섹션 추가
   - "Google 계정 연결" 버튼 → OAuth 승인 → 연결됨/계정명 표시
   - "연결 해제" 버튼
2. 담당자 폼에 명함 이미지 업로드 필드 추가
   - 업로드 → Drive `AX사업본부/명함/` 폴더에 저장
   - 담당자 상세 페이지에서 명함 이미지 표시
3. 이미지는 프록시 API(`/api/files/drive/[fileId]`)를 통해 서빙 (Drive URL 직접 노출 X)
4. 토큰(access_token, refresh_token)은 `system_settings` 테이블에 암호화 저장

## 비기능 요구사항
- refresh_token 자동 갱신 (access_token 만료 시)
- Drive 미연결 상태에서 업로드 시도 → 명확한 에러 메시지
- RLS: 토큰은 admin만 read/write

## 사용자 가이드 (Google Cloud Console 설정)
→ 04-user-guide.md 참조
