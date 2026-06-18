# 01 — 아키텍처 설계 (회의노트)

> 근거: 🟦 DC-ANA 코드 실사. 모든 경로는 newAX 기존 구조와 SSOT 재사용을 전제로 함.

---

## 1. 전체 구조도

```
app/(member)/meeting-notes/
  page.tsx                 List(검색/정렬/필터/페이지·URL상태) — 서버 컴포넌트
  [id]/page.tsx            상세/편집 (Tiptap + AI 패널)
  new/page.tsx             신규 작성
  actions.ts               Server Actions: CRUD (calendar/actions.ts 패턴)
  MeetingEditor.tsx        'use client' — TiptapEditor 래핑 + 메타 폼
  MeetingRecorder.tsx      'use client' — MediaRecorder (Phase 2)
  MeetingAiPanel.tsx       'use client' — 요약/추출 후보 체크리스트 (DeptTaskSuggestPanel 패턴)

app/api/
  ai/meeting-summarize/route.ts   본문→요약·결정사항 (Gemini)
  ai/meeting-extract/route.ts     본문→할일/일정/주요내용 후보 (Gemini)
  meeting-notes/stt/route.ts      음성파일→텍스트 (Groq whisper) [Phase 2]
  files/drive/meeting/route.ts    음성 업로드 (google-drive.uploadFile 재사용) [Phase 2]

lib/
  groq-stt.ts              [신규] Groq STT 커넥터 (서버 전용) + token-logger
  gemini-meeting.ts        [신규] 회의 요약·추출 (gemini-suggest-tasks 패턴 복제)
  meeting-notes.ts         [신규] 조회/매핑 헬퍼 (org-scope 재사용)

supabase/migrations/
  113_meeting_notes.sql    [신규] 테이블 + RLS + entry_type 확장
```

---

## 2. 데이터모델 — 2안 비교 및 추천 (Q&A 답변: "기획서에서 비교 후 추천")

### 안 ⓐ — daily_logs 재사용 (`entry_type='meeting'`)
- 방법: `daily_logs.entry_type` CHECK 제약에 `'meeting'` 추가, 회의 고유 필드는 기존 nullable 컬럼 활용.
- ➕ 기존 AI 파이프라인(daily→weekly, daily→dept_tasks, daily→calendar)이 daily_logs를 SSOT로 봄 → **연계 무상**.
- ➖ 회의 고유 속성(참석자, 안건, 음성파일 ID, 녹취 원문, 요약, 결정사항)을 담으려면 nullable 컬럼 대거 추가 → daily_logs 비대·오염 위험(🟦 DC-BIZ 경고).
- ➖ content는 plain text SSOT인데 회의 본문은 리치텍스트 → 충돌.

### 안 ⓑ — 신규 `meeting_notes` 테이블 + daily_logs 소프트링크 ✅ **추천**
- 방법: 회의 고유 데이터는 `meeting_notes`에 정규화. 추출된 할일은 **사용자 확인 시** `daily_logs`에 `source_type='ai_derived'` + `meeting_note_id` 링크로 *복사 생성*. 일정은 `calendar_events(link_kind='meeting', link_id=meeting_note_id)`.
- ➕ daily_logs 오염 0. 회의 고유 스키마 자유. 기존 AI 파이프라인은 생성된 daily_logs 행을 그대로 소비(추가 작업 0).
- ➕ 음성/요약/원문 분리 보관 → 정규화·RLS 명확.
- ➖ 테이블 1개·마이그레이션 1개 추가. 링크 정합성 관리 필요(삭제 시 cascade 정책).

> **추천: 안 ⓑ.** daily_logs는 "확정된 업무"의 SSOT로 유지하고, 회의노트는 그 *공급원*으로 분리. 추출 결과만 표준 경로(daily_logs/calendar_events)로 흘려보내 기존 파이프라인을 100% 재사용한다.

### `meeting_notes` 스키마(안 ⓑ)
| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | uuid PK (gen_random_uuid) | |
| user_id | uuid FK→profiles NOT NULL | 작성자 |
| department_id | uuid FK→org_nodes NULL | org-scope 표시·필터용 |
| title | text NOT NULL | 회의 제목 |
| meeting_at | timestamptz | 회의 일시 |
| attendees | text[] 또는 jsonb | 참석자(자유텍스트/멤버ID) |
| body_html | text | Tiptap 리치텍스트 본문 |
| body_plain | text | htmlToPlain 캐시(AI 입력·검색용) |
| summary | text NULL | AI 요약 |
| decisions | text NULL | AI 결정사항 |
| transcript | text NULL | STT 원문 (Phase 2) |
| audio_drive_id | text NULL | 구글드라이브 파일 ID (Phase 2) |
| audio_duration_sec | int NULL | 총 녹음 시간 (Phase 2) |
| tags | text[] NULL | 안건/태그 |
| status | text CHECK IN ('draft','final','archived') | |
| deleted_at | timestamptz NULL | **소프트삭제** |
| created_at / updated_at | timestamptz | |

링크 보강:
- `daily_logs`에 `meeting_note_id uuid NULL`(추출 출처 추적) — 이미 `promoted_from_log_id` 선례 있어 패턴 동일.
- `calendar_events.link_kind` CHECK에 `'meeting'` 추가(또는 `'daily'`로 우회 가능 — 추출 일정은 daily_logs 경유 생성 시 자동 `'daily'`).

### RLS (010_daily_logs.sql 정책 차용)
- SELECT: `user_id = auth.uid()` OR admin OR (org-scope hierarchy 옵션). `deleted_at IS NULL`.
- INSERT/UPDATE/DELETE: 본인만(소프트삭제=UPDATE deleted_at).

---

## 3. AI 파이프라인

### 3.1 요약/결정사항 (생성형) — `lib/gemini-meeting.ts` + `api/ai/meeting-summarize`
- 입력: `body_plain`(htmlToPlain 통과). 출력: `{ summary, decisions }`.
- 패턴: `gemini-daily-to-weekly.ts`(생성형) 차용. 미리보기/편집/저장.

### 3.2 후보 추출 (추출형) — `lib/gemini-meeting.ts` + `api/ai/meeting-extract`
- 입력: `body_plain`. 출력: `{ tasks[], events[], highlights[] }`, 각 항목 `{ title, confidence, source_quote(plain), ...(date for events) }`.
- 패턴: `gemini-suggest-tasks.ts`(추출형, `source_quote` 강제) 정확히 복제. `DeptTaskCandidate`와 동형 타입.
- UI: `DeptTaskSuggestPanel.tsx` 패턴 — 체크박스 + `existing_match` 기본 비체크 + 일괄 등록.

### 3.3 STT (Phase 2) — `lib/groq-stt.ts` + `api/meeting-notes/stt`
- 입력: 음성 Blob(webm/mp4) FormData. Groq `audio.transcriptions.create({ model:'whisper-large-v3' })`.
- 출력: transcript(text). 본문 에디터에 삽입.
- 파일 한도: Groq Dev 100MB. 긴 회의는 청크 분할(클라이언트 `timeslice`) 후 순차 전사·병합.
- 토큰/사용량: `logTokenUsage({ feature:'meeting_stt', ... })`.

---

## 4. 재사용 매핑 (SSOT — 신규 작성 금지, import만)

| 필요 처리 | 재사용 대상 | 경로 |
|---|---|---|
| 리치텍스트 편집 | `TiptapEditor` | `components/ui/TiptapEditor.tsx` |
| HTML 렌더 | `RichText` | `components/ui/RichText.tsx` |
| HTML→plain | `htmlToPlain` | `lib/html-to-plain.ts` |
| AI 후보 체크리스트 UI | `DeptTaskSuggestPanel` 패턴 | `app/(member)/dept-tasks/DeptTaskSuggestPanel.tsx` |
| 토큰 로깅 | `logTokenUsage` | `lib/token-logger.ts` |
| 권한 스코프 | `resolveOrgScope` | `lib/org-scope.ts` |
| 일정 생성 | `createCalendarEvent` | `app/(member)/calendar/actions.ts` |
| 음성 파일 저장 | `uploadFile`/`ensureFolder`/`streamFile` | `lib/google-drive.ts` |
| 모달/폼 표준 | `useEscClose`, `input-field`, `label`, `tape-title` | globals.css / lib |
| 레이아웃 | `MobileShell`, `page-inner` | 상속 |

신규 작성 한정: `lib/groq-stt.ts`, `lib/gemini-meeting.ts`, `lib/meeting-notes.ts`, `meeting-notes/*` 화면, 마이그레이션 113.

---

## 5. 신규 의존성 / 환경변수

- 의존성: `groq-sdk` (Apache-2.0, **서버 라우트 전용** import).
- env: `GROQ_API_KEY`(서버). `.env.example`에 키 이름만 추가.
- 구글드라이브: 기존 `GOOGLE_*` 재사용 — 신규 env 없음.

---

## 6. 실제 렌더 경로 / 사이드이펙트 경계

- 회의노트는 신규 라우트 → 기존 화면 분기 없음(공존 경로 리스크 낮음).
- ⚠️ `daily_logs.entry_type`/`calendar_events.link_kind` CHECK 제약 변경은 **기존 데이터 영향 없음**(ADD only). DROP·재생성은 트랜잭션 내 1마이그레이션.
- ⚠️ daily→weekly·daily→dept_tasks가 회의 파생 daily_logs를 소비 → 이중 집계 방지 위해 `source_type='ai_derived'` + 출처 필터 정책 명시(`03-test-strategy.md`에서 검증).
