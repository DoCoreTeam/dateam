# FAST PATH Summary — API 키 발급 silent failure 수정

## 작업
`/api-keys` 화면에서 키 발급/폐기가 "안 되는데 아무 안내도 없는" silent failure를 가시화. 비-JSON 응답·세션 리다이렉트·네트워크 오류를 잡아 명확한 메시지(세션 만료→재로그인) 노출.

## 대상
- `apps/web/app/(member)/api-keys/page.tsx` — `createKey()`, `revokeKey()`

## 이유 (근본 원인)
- 백엔드 전 경로는 정상임을 직접 입증:
  - 미들웨어: 인증 사용자는 통과(GET 성공 = 폐기 키 렌더됨)
  - DB `api_keys` 스키마/제약/트리거 정상, raw SQL `INSERT 0 1`
  - 라우트가 쓰는 admin(service role) PostgREST insert → **HTTP 201**
- 진짜 원인은 클라이언트 silent failure:
  - 미들웨어는 미인증 `/api/user/*`를 `/login`(HTML)로 307 리다이렉트
  - 세션이 끊긴 채 POST하면 응답이 JSON이 아닌 로그인 HTML
  - `const data = await res.json()` 가 throw → `try`에 `catch` 없음(`finally`만) → **아무 알림 없이 버튼만 리셋**
  - 사용자에겐 "발급이 안된다"로 보임
- 동일 패턴이 `revokeKey()`에도 존재(같은 결함류) → 함께 보수

## 변경 내용
- `createKey`/`revokeKey`: `res.redirected || status 401 || url에 /login` 감지 → "세션 만료, 재로그인" 안내
- `res.json()`을 `.catch(() => null)`로 안전 파싱, 실패 시 `HTTP {status}` 포함 메시지
- 전체를 `try/catch`로 감싸 네트워크 오류도 가시화
- 백엔드/DB/미들웨어 무변경 (정상 입증됨)

## 영향
- 표시/에러 처리 한정. 계산·데이터·라우팅 로직 불변. 회귀 위험 낮음.
- 세션 만료가 실제 원인이었던 사용자는 재로그인으로 즉시 해결, 그 외 실패도 더 이상 침묵하지 않음.

## 완료 조건
- [ ] 비-JSON/리다이렉트 응답에서 alert로 사용자에게 명확히 안내
- [ ] 정상 세션에서 키 생성/폐기 기존 동작 유지
- [ ] tsc 0 errors / design:check 통과
- [ ] DC-REV 통과
