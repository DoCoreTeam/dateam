# AI 채팅 (Claude 클론) — 심층기획 · 요구사항

- 접수일: 2026-07-13 / 성격: **기획 전용 (구현 절대 금지)**
- 기획: 🟦 DC-ANA(내부 인프라 매핑) + CEO(claude-api 스킬 기반 Claude 기능 셋)

## 1. 목표 (한 줄)
dateam 내부에 **Claude.ai 채팅을 클론**한 "AI 채팅" 기능을 신설한다. 좌측 메뉴에 "AI채팅" + 페이지 내 대화 목록 사이드바·"새 대화" 버튼(FAB 미도입 확정 — 세션1 §7-2·§7-3 결정). **어드민에 설정된 AI 서비스 API를 사용**하며, 여러 개 설정 시 프로바이더/모델을 선택해 사용한다.

## 2. 핵심 제약 (사용자 명시)
- **어드민 전용**: 화면·메뉴·FAB·API·데이터 모두 admin만 접근. (RLS default-deny admin-only)
- **어드민 설정 AI API 재사용**: 별도 하드코딩 키 금지. 현재는 Gemini 단일 → **멀티 프로바이더로 확장** 필요.
- **여러 AI 서비스 대응**: admin이 2개 이상 프로바이더(예: Gemini + Claude)를 설정하면 대화별로 골라 쓸 수 있어야 함.
- **정확한 클론**: Claude.ai 채팅 UX/기능을 기준으로 구현.

## 3. 현황 (DC-ANA 확인)
| 항목 | 현재 상태 | 클론 도입 시 갭 |
|------|-----------|------------------|
| AI 프로바이더 | **Gemini 단일** (`org_content` META: `gemini_api_key`, `gemini_model`) | Claude/기타 키·모델 필드 + provider 추상화 부재 |
| AI 호출 | `lib/gemini-*.ts` 각자 `fetch(generativelanguage…)` 반복, 공용 클라이언트 없음 | 프로바이더 추상 레이어 신설 |
| 스트리밍 | `api/pricing/gpu/db-chat/route.ts` = Gemini `streamGenerateContent` SSE, `DbChatTab`가 client 파싱 | 패턴 재사용 가능(훅 미분리) |
| 토큰 로깅 | `lib/token-logger.ts` {userId, feature(enum), model, tokens} — **provider 컬럼 없음** | provider 컬럼 + `ai-chat` feature enum 추가 |
| 마크다운/코드 | `RichText`는 `code/pre` 미허용 → 코드블록 렌더 불가 | 마크다운+코드블록 렌더러 도입 |
| 좌측 메뉴 | `admin/layout.tsx` `ADMIN_NAV_GROUPS` (자동 admin 게이팅) | 항목 1개 추가 |
| FAB | `lib/fab-actions.ts` `fabActionsForPath(pathname, isAdmin)` | **확정: FAB 미도입**(세션1 §7-3 — admin 화면 QuickAddFab null 가드 유지). 진입점은 사이드바 "새 대화" 버튼 |
| RLS 패턴 | `org_weekly_reports` admin-only 서브쿼리 표준 | 그대로 복용 |

## 4. Claude 채팅 기능 셋 — 완성 설계(전체 확정) · 의존성 순서 구현 배치 1/2/3

### 배치 1 — 기반 + 핵심 채팅 (테이블·프로바이더 추상화가 전체 스펙의 의존성 뿌리)
- [ ] 새 대화 생성 (사이드바 "새 대화" 버튼 + 좌측 "AI채팅" 메뉴 — FAB 미도입 확정)
- [ ] **대화 저장/관리 (기본, 확정 포함)**: DB 영속 · 목록(최신순) · 이름변경(수동+자동제목) · **소프트삭제** · 고정(pin) · 새로고침/재방문 시 대화+메시지 복원 · `?c=<id>` URL 동기화
- [ ] 멀티턴 대화 (전체 히스토리 컨텍스트 전송)
- [ ] **스트리밍 응답** (SSE, 토큰 점진 렌더 + 커서)
- [ ] **마크다운 + 코드블록** 렌더 (코드 복사 버튼, 기본 하이라이트)
- [ ] **프로바이더/모델 선택** (대화별 — admin 설정된 프로바이더 목록에서)
- [ ] 생성 중단 (Stop) · 메시지 복사 · 로딩/빈/에러 3종 상태

### 배치 2a — 파일업로드 · 멀티모달 (배치 1의 테이블·프로바이더 추상화에 의존)
- [ ] **파일/이미지 업로드**: 이미지(png/jpg/webp) · PDF · 문서(txt/csv/md/json + docx/xlsx/pptx — 서버측 텍스트 추출(officeparser) 확정) 첨부 UI(드래그·붙여넣기·버튼)
- [ ] **멀티모달 입력**: 첨부를 프로바이더별 형식으로 전달 (Claude image/document 블록·Files API / Gemini inline_data·Files / OpenAI image_url·file) — **프로바이더 capability 지원 시에만 활성**
- [ ] **첨부 저장/관리**: Supabase Storage(admin 전용 버킷) 영속 + 대화 복원 시 첨부 재표시 + 삭제 시 정리
- [ ] 비전 미지원 프로바이더 선택 시 첨부 버튼 비활성 + 안내

### 배치 2b — 완성도 (배치 1 UI·스트림의 확장)
- [ ] 재생성 (Regenerate)
- [ ] 사용자 메시지 편집 후 재전송 (분기/재실행)
- [ ] 대화 검색 (제목/본문)
- [ ] 대화 고정(pin)
- [ ] 대화별 시스템 프롬프트 설정
- [ ] 이미지/파일 첨부 (프로바이더 vision 지원 시)
- [ ] thinking(추론) 표시 (지원 모델 — 예: Claude adaptive thinking summarized. 영속 저장은 배치 1, 표시 UI는 배치 2)
- [ ] 응답 피드백(👍/👎)

### 배치 3 — 고급 (배치 1·2 산출에 의존)
- [ ] Artifacts(문서/코드 프리뷰 패널)
- [ ] 프로젝트(대화 그룹 + 지식)
- [ ] 웹 검색/도구 사용(server tool)
- [ ] 편집분기 브랜치 네비게이션(`‹ k/n ›` 전환 · 과거 분기 열람)
- [ ] 공유(admin 경계 내 옵트인 — 확정) / 내보내기(.md)
- [ ] LaTeX 수식 렌더 · 토큰/비용 대시보드(`/admin/ai-usage` 확장)

> 위 전 항목은 **확정 완성 스펙**이다(발견형 MVP 아님 — 클론은 완성 스펙이 이미 확정된 대상). 배치 분할 근거는 **오직 의존성**: 테이블·프로바이더 추상화(배치 1) → 첨부·UI 완성도(배치 2) → 고급(배치 3). 각 배치 완료기준은 세션 문서 §완료기준(완성 스펙 100%)에 박제.

## 5. 완료 판단 기준 (배치 1 기준)
- admin이 `/admin/ai-chat`에서 새 대화 → 질문 → 스트리밍 응답(마크다운·코드블록) 수신 → 새로고침 후 대화·메시지 DB에서 복원.
- admin에 Gemini 외 프로바이더(예: Claude) 키 설정 시, 대화에서 해당 프로바이더/모델 선택·사용 가능.
- 비admin은 메뉴·FAB·URL·API 전부 차단(RLS+라우트 이중).
- 토큰 사용이 provider 구분되어 로깅됨.

## 6. 제외 (클론 범위 밖 — 확정 설계 결정)
- 음성/실시간. 외부 공개(비admin) 노출 — 공개 인터넷 공유 포함. 모바일 앱. MCP/외부 커넥터.
