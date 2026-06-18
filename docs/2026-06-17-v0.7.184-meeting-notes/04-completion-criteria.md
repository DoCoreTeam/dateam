# 04 — 완료 기준 (회의노트)

> 구현 단계에서 이 체크리스트 전 항목 ✅ 후에만 "완료" 선언 가능(EXEC-001). 본 기획 단계에서는 체크하지 않음.

## A. Feature Defaults — 신규 엔티티(meeting_notes) 자동 전개
- [ ] CRUD 전체 (Create / Read / Update / Delete, **소프트삭제** `deleted_at`, 각 연산 권한)
- [ ] List 화면/조회 + **행 수준 RLS**(본인 + admin, default-deny, deleted 제외)
- [ ] 검색(`q`, 서버 sanitization) · 정렬(`sort`, 화이트리스트) · 필터(`filter[]`, 화이트리스트)
- [ ] 성능 로딩 = **서버 페이지네이션**(`page/limit`) + 메타
- [ ] 검색/정렬/필터/페이지 상태 **URL 동기화** + 로딩/빈/에러 3종 UI

## B. 입력 — 텍스트 (MVP)
- [ ] TiptapEditor 재사용 본문 작성, 메타(제목/일시/참석자/태그)
- [ ] body_html 저장 + body_plain(htmlToPlain) 캐시

## C. AI 정제·추출 (MVP)
- [ ] 요약·결정사항 생성(생성형) — 미리보기/편집/저장
- [ ] 할일/일정/주요내용 후보 추출(추출형) — `제목+신뢰도+근거(plain)+체크박스`
- [ ] **자동 등록 금지** — 사용자 체크 후에만 일괄 반영 (CLAUDE.md §5-3)
- [ ] 할일→daily_logs(`source_type='ai_derived'`, `meeting_note_id`), 일정→calendar_events(`createCalendarEvent` 재사용), 주요내용→주간보고 소재
- [ ] AI 입력 전 `htmlToPlain` 통과 (HTML 잔존 0)
- [ ] 모든 AI 호출 `logTokenUsage` 기록(신규 AiFeature)

## D. 음성 (Phase 2 — 정책 확정 시)
- [ ] MediaRecorder 녹음: 시작/일시정지/재개/정지
- [ ] 경과 시간 + 총 녹음 시간 표시
- [ ] STT(Groq whisper-large-v3) → 본문 삽입
- [ ] (정책) 음성 보존: 구글드라이브 저장(`uploadFile` 재사용, audio MIME) 또는 폐기 토글
- [ ] Safari mp4 / Chrome·FF webm MIME 분기
- [ ] GROQ_API_KEY 서버 전용(클라 노출 0), 음성파일 IDOR=meeting_notes 검증

## E. 비기능
- [ ] RLS 실제 동작 검증(타인 접근 차단)
- [ ] `pnpm design:check` 통과, 폼/모달 표준 클래스 적용
- [ ] `tsc --noEmit` 0 + **실제 next build 성공**(메모리 react18_build_verify)
- [ ] 반응형 320/768/1024/1440 오버플로우 0, table-card
- [ ] 음성권한 `Permissions-Policy: microphone` 확인(HTTPS)
- [ ] 단위/통합/E2E 통과, lib 커버리지 80%+

## F. 데이터 무결성 / 사이드이펙트
- [ ] daily_logs·calendar CHECK 제약 확장이 기존 데이터 영향 0 (ADD only, 롤백 가능)
- [ ] 회의 파생 daily_logs 이중 집계 방지(daily→weekly/dept_tasks 필터 정책)
- [ ] 회의노트 삭제 시 링크된 daily_logs/calendar 처리 정책 명시(cascade 또는 링크 해제)

## G. 문서/버전
- [ ] CLAUDE.md `## 버전` + 루트/apps/web package.json + AGENTS.md 동기화
- [ ] README 기능 반영
- [ ] 마이그레이션 113 적용 + `schema_migrations` 기록

## H. 결정 선행 항목 (구현 착수 전 확정 필요)
- [ ] 데이터모델 안 ⓑ(신규 테이블) 승인
- [ ] MVP/Phase2 분리 vs 일괄 구현 최종 확정
- [ ] 음성 보존정책 + 화자분리 필요 여부
