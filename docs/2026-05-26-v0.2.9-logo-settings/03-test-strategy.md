# 03. 테스트 전략 — 시스템 로고·브랜드명 관리

## 테스트 레벨

### 단위 테스트
| 대상 | 검증 내용 |
|------|---------|
| `GET /api/settings/branding` | logoUrl null일 때 null 반환, brandName 기본값 "AX사업본부" |
| `POST /api/admin/settings/branding` | admin 아닌 계정 → 403 / admin → 200, DB 갱신 |
| `POST` — 파일 크기 초과 | 2MB 초과 파일 → 400 에러 |
| `POST` — 허용 외 형식 | .pdf 등 비허용 → 400 에러 |

### 통합 테스트
| 시나리오 | 검증 |
|---------|------|
| 로고 업로드 전체 흐름 | 업로드 → DB 갱신 → GET API 응답에 새 URL 포함 |
| 로고 교체 | 구 파일 Storage에서 삭제 확인 |
| 로고 삭제 | DB `logo_url` null, Storage 파일 삭제 |
| 브랜드명 변경 | DB 갱신, GET 응답 반영 |
| 비admin 업로드 시도 | RLS 레벨 + API 레벨 모두 차단 |

### E2E 검증 (수동)
| 체크 | 방법 |
|------|------|
| 사이드바 로고 표시 | 로고 설정 후 페이지 새로고침 → 이미지 확인 |
| 로딩 애니메이션 로고 | 페이지 이동 시 로딩 화면 확인 |
| 로그인 화면 로고 | 로그아웃 후 로그인 화면 확인 |
| 폴백 동작 | 로고 삭제 후 텍스트 폴백 확인 |
| img 오류 폴백 | img src를 404 URL로 교체 시 텍스트 표시 확인 |

### 보안 검증
- [ ] admin 아닌 계정으로 POST API 직접 호출 → 403
- [ ] Storage에서 다른 사용자 파일 접근 시도 → 차단
- [ ] 파일명에 path traversal 패턴 포함 시 (`../../etc`) → 무해하게 처리
- [ ] SVG XSS: `<svg onload="alert()">` → Storage public URL로 서빙되므로 img 태그로만 표시, script 실행 불가 확인
