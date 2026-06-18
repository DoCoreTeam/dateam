# 02 — 태스크 분해 (회의노트)

> 사용자 요청 = **일괄 구현**. 단 🟦 DC-BIZ는 음성/STT를 Phase 2로 권고(프라이버시·비용). 아래는 **일괄 구현용 전체 분해**이며, Phase 태그로 MVP/2 구분만 표시(분리 여부는 사용자 확정).
> 본 문서는 분해만 — 실제 구현은 수행하지 않음.

---

## Phase 0 — 기반 (DB·의존성)
| # | 태스크 | 담당 | 산출물 |
|---|---|---|---|
| T-01 | 마이그레이션 `113_meeting_notes.sql` — 테이블+RLS, `daily_logs.meeting_note_id`, `entry_type`/`link_kind` CHECK 확장 | 🟩 DC-DEV-DB | SQL(롤백 포함) |
| T-02 | `groq-sdk` 의존성 추가 + `GROQ_API_KEY` `.env.example` | 🟩 DC-DEV-OPS | package.json / env |

## Phase 1 — 백엔드/AI (MVP 핵심)
| # | 태스크 | 담당 | 산출물 |
|---|---|---|---|
| T-03 | `lib/meeting-notes.ts` — 조회/매핑 헬퍼, org-scope 적용 | 🟩 DC-DEV-BE | lib |
| T-04 | `actions.ts` — CRUD Server Actions(소프트삭제·권한·입력검증) | 🟩 DC-DEV-BE | Server Action |
| T-05 | `lib/gemini-meeting.ts` — 요약(생성형)+추출(추출형, source_quote 강제) | 🟩 DC-DEV-BE | lib + token-logger |
| T-06 | `api/ai/meeting-summarize`, `api/ai/meeting-extract` route | 🟩 DC-DEV-BE | Route Handler |
| T-07 | 추출 후보 → daily_logs/calendar 일괄 반영 액션(`createCalendarEvent` 재사용) | 🟩 DC-DEV-BE | Server Action |

## Phase 2 — 음성/STT (🟦 DC-BIZ: 정책 확정 후)
| # | 태스크 | 담당 | 산출물 |
|---|---|---|---|
| T-08 | `lib/groq-stt.ts` — Groq whisper 커넥터(서버 전용)+token-logger | 🟩 DC-DEV-INT | lib |
| T-09 | `api/meeting-notes/stt` route — FormData 음성→텍스트, 청크 병합 | 🟩 DC-DEV-INT | Route |
| T-10 | `api/files/drive/meeting` — `uploadFile` 재사용(audio MIME 허용), IDOR=meeting_notes 검증 | 🟩 DC-DEV-INT | Route |
| T-11 | `MeetingRecorder.tsx` — MediaRecorder, 경과/총시간 타이머, pause/resume, MIME 분기(Safari mp4) | 🟩 DC-DEV-FE | client comp |

## Phase 3 — 프론트엔드 (MVP)
| # | 태스크 | 담당 | 산출물 |
|---|---|---|---|
| T-12 | `meeting-notes/page.tsx` List — 검색/정렬/필터/페이지·URL상태·`table-card`·3종 UI | 🟩 DC-DEV-FE | page |
| T-13 | `MeetingEditor.tsx` — TiptapEditor 래핑 + 메타 폼(`input-field`/`label`) | 🟩 DC-DEV-FE | client comp |
| T-14 | `[id]/page.tsx`, `new/page.tsx` — 상세/편집/신규 | 🟩 DC-DEV-FE | page |
| T-15 | `MeetingAiPanel.tsx` — 요약 미리보기/편집 + 추출 후보 체크리스트(DeptTaskSuggestPanel 패턴) | 🟩 DC-DEV-FE | client comp |
| T-16 | 사이드바/네비 메뉴 "회의노트" 추가 + 권한 게이트 | 🟩 DC-DEV-FE | nav |

## Phase 4 — 검증/문서
| # | 태스크 | 담당 | 산출물 |
|---|---|---|---|
| T-17 | 단위 테스트(추출 매핑·htmlToPlain·권한) + node:test 파일목록 등록 | 🟥 DC-QA | *.test.ts |
| T-18 | E2E(Playwright): 작성→AI추출→일괄반영→daily_logs 확인 | 🟥 DC-QA | e2e |
| T-19 | 보안 리뷰(RLS·GROQ키·IDOR·음성권한) | 🟥 DC-SEC | 리포트 |
| T-20 | 코드 리뷰 + design:check | 🟥 DC-REV | 리포트 |
| T-21 | README/CLAUDE.md 버전·기능 반영 | 🟩 DC-DOC | docs |

---

## 의존 관계
```
T-01,T-02 → T-03,T-04,T-05 → T-06,T-07 → T-12~T-16
                 T-05 ─────────────────→ T-15
T-08,T-09,T-10 → T-11 (Phase 2)
모두 → T-17~T-21
```

## 병렬 가능 그룹
- 그룹A(Phase1 백엔드): T-03/T-04/T-05 동시
- 그룹B(Phase3 FE): T-12/T-13 동시, T-14/T-15는 T-06/T-07 후
- 그룹C(Phase2): T-08~T-11 독립 트랙

## 파일 규모 가드
- 모든 신규 파일 800줄 이내(권장 300~400). List/AiPanel은 컴포넌트 분리.
