# Architecture — Google Drive 스토리지 연동

## 흐름도

### OAuth 연결 흐름
```
어드민 클릭
  → GET /api/auth/google-drive          (state 생성, Google OAuth URL 리다이렉트)
  → Google OAuth 승인
  → GET /api/auth/google-drive/callback (code→token 교환, system_settings 저장)
  → /admin/settings 리다이렉트 (연결 완료)
```

### 명함 업로드 흐름
```
ContactForm 파일 선택
  → POST /api/files/drive/upload        (multipart, 서버에서 Drive API 호출)
  → Drive AX사업본부/명함/ 에 저장
  → { fileId } 반환
  → contacts DB에 business_card_drive_id 저장
```

### 이미지 표시 흐름
```
<img src="/api/files/drive/{fileId}">
  → GET /api/files/drive/[fileId]       (Drive API로 파일 읽어 스트리밍)
  → 브라우저에 이미지 표시
```

## 파일 구조 (신규)
```
apps/web/
├── lib/
│   └── google-drive.ts                 # Drive API 유틸 (getClient, upload, stream)
├── app/
│   ├── api/
│   │   ├── auth/google-drive/
│   │   │   ├── route.ts                # OAuth 시작 (리다이렉트)
│   │   │   └── callback/route.ts       # 토큰 교환 + 저장
│   │   └── files/drive/
│   │       ├── upload/route.ts         # 파일 업로드 → Drive
│   │       └── [fileId]/route.ts       # 프록시 스트리밍
│   └── admin/settings/
│       └── GoogleDriveSettings.tsx     # 연결 UI 컴포넌트
supabase/migrations/
└── 014_contacts_business_card.sql      # business_card_drive_id 컬럼 추가
```

## DB 변경
- `contacts` + `business_card_drive_id TEXT` 컬럼
- `system_settings` — 기존 key-value 구조 활용:
  - key: `google_drive_access_token`
  - key: `google_drive_refresh_token`
  - key: `google_drive_token_expiry`
  - key: `google_drive_account_email`
  - key: `google_drive_folder_id` (AX사업본부 루트 폴더 ID)

## 환경변수 (추가)
```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:4000/api/auth/google-drive/callback
```
