# Google Drive OAuth 연동 설정 가이드

newAX 관리자가 Google Drive 계정을 연동하여 파일 관리 기능을 활성화하는 방법을 단계별로 설명합니다.

## 사전 준비

- Google 계정 1개 (Google Drive 액세스 권한 필요)
- Google Cloud Console 접근 권한
- newAX 프로젝트 관리자 권한

---

## STEP 1: Google Cloud Console 프로젝트 확인/생성

1. [Google Cloud Console](https://console.cloud.google.com)에 접속합니다.
2. 상단의 프로젝트 선택 드롭다운을 클릭합니다.
3. **기존 프로젝트 선택** 또는 **새 프로젝트 생성**:
   - 새로 만들 경우: `새 프로젝트` 버튼 → 프로젝트 이름 입력 (예: `newAX-Google-Drive`) → 생성

---

## STEP 2: Google Drive API 활성화

1. Google Cloud Console 좌측 메뉴에서 **API 및 서비스** → **라이브러리**를 클릭합니다.
2. 검색창에 `Google Drive API`를 입력합니다.
3. 검색 결과에서 `Google Drive API` 카드를 클릭합니다.
4. **사용 설정** 버튼을 클릭합니다.
5. 활성화 완료 시 "Google Drive API가 이 프로젝트에서 사용 설정되었습니다"라는 메시지가 표시됩니다.

---

## STEP 3: OAuth 동의 화면 구성

1. **API 및 서비스** → **OAuth 동의 화면**으로 이동합니다.
2. **사용자 유형 선택**:
   - **내부(Internal)**: 조직 내부에서만 테스트 및 사용 (추천)
   - **외부(External)**: 외부 사용자도 접근 가능 (이 경우 Google 검수 필요)
3. 선택 후 **만들기** 버튼을 클릭합니다.

### 앱 정보 입력

1. **앱 이름**: `newAX` 또는 조직명
2. **사용자 지원 이메일**: 귀사 이메일 주소
3. **개발자 연락처 정보**: 귀사 이메일 주소
4. **저장 후 계속**을 클릭합니다.

### 스코프(권한) 추가

1. **스코프** 페이지에서 **범위 추가 또는 제거**를 클릭합니다.
2. 검색창에 `drive.file`을 입력합니다.
3. 다음 스코프를 선택합니다:
   - `../auth/drive.file` (앱이 생성한 파일에만 접근)
4. **업데이트** → **저장 후 계속**을 클릭합니다.

### 테스트 사용자 추가 (외부 앱 선택 시에만)

외부(External)로 설정한 경우:

1. **테스트 사용자** 페이지에서 **테스트 사용자 추가**를 클릭합니다.
2. 테스트할 Google 계정의 이메일을 입력합니다.
3. **추가** 버튼을 클릭합니다.

Google 검수 이전까지 추가된 테스트 사용자만 연동을 테스트할 수 있습니다.

---

## STEP 4: OAuth 클라이언트 ID 생성

1. **API 및 서비스** → **사용자 인증 정보**로 이동합니다.
2. 상단의 **+ 사용자 인증 정보 만들기** 버튼을 클릭합니다.
3. **OAuth 클라이언트 ID**를 선택합니다.
4. **애플리케이션 유형** 선택에서 **웹 애플리케이션**을 선택합니다.
5. 프로젝트 이름 입력 (예: `newAX Web App`)

### 승인된 리디렉션 URI 추가

1. **승인된 리디렉션 URI** 섹션에서 **URI 추가**를 클릭합니다.
2. **개발 환경**:
   ```
   http://localhost:3000/api/auth/google-drive/callback
   ```
3. **프로덕션 환경**:
   ```
   https://your-domain.com/api/auth/google-drive/callback
   ```
   (your-domain.com은 실제 도메인으로 변경)

4. **만들기** 버튼을 클릭합니다.

### 클라이언트 인증 정보 복사

1. 생성 완료 후 모달에서 다음 정보를 복사합니다:
   - **클라이언트 ID**: `xxx.apps.googleusercontent.com` 형식
   - **클라이언트 보안 비밀번호**: 긴 문자열
2. 이 정보는 STEP 5에서 사용됩니다.

---

## STEP 5: 환경변수 설정

프로젝트의 환경설정 파일에 다음 내용을 추가합니다.

**파일 위치**: `apps/web/.env.local`

```env
# Google Drive OAuth
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google-drive/callback
```

**값 입력 시 주의사항**:
- `GOOGLE_CLIENT_ID`: STEP 4에서 복사한 클라이언트 ID 붙여넣기
- `GOOGLE_CLIENT_SECRET`: STEP 4에서 복사한 클라이언트 보안 비밀번호 붙여넣기
- `GOOGLE_REDIRECT_URI`: 개발 중이면 `http://localhost:3000/...` 유지, 프로덕션이면 실제 도메인으로 변경

---

## STEP 6: 앱에서 Google Drive 연동

### 6-1. 개발 서버 재시작

터미널에서 다음 명령어를 실행합니다:

```bash
pnpm dev
```

환경변수가 로드된 새로운 개발 서버가 시작됩니다.

### 6-2. 관리자 패널에서 연동

1. newAX 앱을 열고 **관리자 패널** → **시스템설정**으로 이동합니다.
2. **Google Drive 연동** 섹션을 찾습니다.
3. **"Google 계정 연결"** 또는 **"다시 연결"** 버튼을 클릭합니다.
4. Google 로그인 화면으로 이동합니다.
5. 연동할 Google 계정으로 로그인합니다.
6. **"newAX가 다음 권한을 요청합니다"** 화면에서 **허용** 버튼을 클릭합니다.
7. 다시 newAX 앱으로 돌아가며, 화면에 **"연결됨"** 상태가 표시되면 성공입니다.

---

## 주의사항

### OAuth 검수 (외부 앱 사용 시)

- **내부(Internal)** 앱: 추가 검수 없이 즉시 사용 가능
- **외부(External)** 앱: Google 검수 필수
  - 최초 배포 시 자동으로 Google 검수 요청이 발생합니다.
  - 검수 완료 전까지는 테스트 사용자만 연동 가능합니다.
  - 검수 소요 시간: 1-7일 (Google 기준)

### 리프레시 토큰 관련

- **초기 연동 시**: Google로부터 리프레시 토큰 발급 (자동 저장됨)
- **재연동 필요 시**:
  1. Google 계정의 [앱 접근 권한 관리](https://myaccount.google.com/permissions) 페이지 방문
  2. `newAX` 앱 찾기 → **제거** 또는 **연결 해제**
  3. newAX에서 다시 "Google 계정 연결" 클릭
  4. 재인증 후 새 리프레시 토큰 발급

### 프로덕션 배포 시 필수 확인 사항

1. **GOOGLE_REDIRECT_URI 업데이트**:
   ```
   https://your-actual-domain.com/api/auth/google-drive/callback
   ```
2. **Google Cloud Console에서 리디렉션 URI 등록**:
   - 위와 동일한 URI를 사용자 인증 정보에 추가해야 합니다.
3. **환경변수 보안**:
   - `GOOGLE_CLIENT_SECRET`은 절대 깃허브에 커밋하면 안 됩니다.
   - 서버 환경변수로만 관리하세요.

---

## 트러블슈팅

### "리디렉션 URI 불일치" 오류

**원인**: 환경변수의 GOOGLE_REDIRECT_URI와 Google Cloud Console 등록 URI가 다름

**해결**:
1. 환경변수 파일 확인
2. Google Cloud Console의 **사용자 인증 정보** → 해당 OAuth 클라이언트 ID 편집
3. 리디렉션 URI 정확히 일치하는지 확인 (http vs https, 도메인, 경로)

### "스코프 동의 페이지가 반복해서 나타남"

**원인**: 이전 세션의 리프레시 토큰이 만료되었거나 무효화됨

**해결**:
1. Google 계정의 [앱 접근 권한 관리](https://myaccount.google.com/permissions) 방문
2. newAX 제거
3. newAX에서 다시 연동

### "401 Unauthorized" 오류

**원인**: 클라이언트 ID 또는 클라이언트 보안 비밀번호 오류

**해결**:
1. STEP 4에서 복사한 값이 정확한지 재확인
2. 환경변수 파일 저장 후 개발 서버 재시작

---

## 완료 확인

Google Drive 연동이 성공하면:

1. 관리자 패널에 **"연결됨"** 상태 표시
2. Google Drive 파일 관리 기능 활성화
3. 앱에서 Google Drive 문서 조회/생성/수정 가능

모든 설정이 완료되었습니다.
