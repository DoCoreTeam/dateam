# FAST PATH Summary — v0.7.184

작업: Vercel 프로덕션 빌드 실패(TS2769) 긴급수정 — google-drive OAuth 콜백 타입 캐스팅

## 대상
- `apps/web/app/api/auth/google-drive/callback/route.ts`
  - import에 `type Auth` 추가
  - `google.oauth2({ version: 'v2', auth })` → `auth: auth as unknown as Auth.OAuth2Client`

## 이유 (왜 이 변경이 필요한가)
- Function Region을 서울(icn1)로 변경 후 재배포 시 `next build`가 exit 1로 실패.
- 원인: `google-auth-library`가 **10.5.0**(`@/lib/google-drive`의 `getOAuth2Client` 반환)과
  **10.7.0**(`googleapis` 번들) 두 버전 중복 설치 → `OAuth2Client`의 private `redirectUri`
  선언이 달라 타입 동일성이 깨짐(TS2769 No overload matches this call).
- 해소: `googleapis`가 재노출하는 자기 타입 `Auth.OAuth2Client`로 캐스팅. **런타임 동작 무변경**(순수 타입).

## 영향
- 연관: `lib/google-drive.ts`의 `google.drive({ auth })` 3곳은 현재 tsc EXIT=0 (에러 없음 — drive API auth 타이핑이 더 느슨).
- 검증: `tsc --noEmit` EXIT=0 / `pnpm --filter web build` exit 0 (전체 라우트 생성, Failed to compile 없음).
- DC-REV: APPROVED 82/100.

## 후속 권고 (별도 스프린트 — 이번 범위 외)
- 근본 해법: 루트 `package.json`에 `"pnpm": { "overrides": { "google-auth-library": "^10.7.0" } }`로
  단일 버전 강제 → lockfile 재생성 → 본 캐스팅 제거.
- 또는 `getOAuth2Client` 반환 타입을 `Auth.OAuth2Client`로 SSOT화.

## 배포 메모
- 이 커밋 push 후 Vercel 재배포되면 v0.7.183에서 변경한 **Function Region(icn1 단일)** 도 함께 반영됨.
- push는 사용자가 직접 수행(자동 push 금지 정책).
