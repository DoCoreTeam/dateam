# 00-requirements — 회의노트 릴레이션 허브 (v0.7.205)

## 배경
회의노트(`meeting_notes`)는 "회의에 참석해서 생긴" 기록이다. 따라서 회의노트는 **조직원 ↔ 캘린더 ↔ 업무**와 양방향으로 연결되어, 사용자가 회의 → 실행(업무) → 일정(캘린더)을 끊김 없이 순회할 수 있어야 한다. 현재는 DB 골격(FK 일부)만 있고 화면 순회는 거의 없다.

## 사용자 요구 (원문 기반)
1. 참석자 입력칸을 없애고 **AI가 본문에서 추출**, 나중에 **수정 가능**.
2. 참석자는 **외부인 + 내부인** 모두 존재 → 내부인은 **조직원과 매칭**, 외부인은 텍스트로 유지.
3. 회의노트는 **캘린더에 자동 기록**(제목+회의일시 기준, AI 무관).
4. 캘린더의 **회의 일정 클릭 → 업무로 직접 진입**.
5. **업무에서 연결된 회의노트를 바로 확인**.
6. 구현 후 **Playwright로 UI 단위 점검 + 변칙(엣지) 테스트**.

## 기능 요구사항 (FR)
- **FR-1 참석자 AI 추출 + 조직원 매칭**
  - MeetingEditor의 자유텍스트 참석자 입력칸 제거.
  - AI 추출 패널이 본문에서 참석자 후보를 추출(추출형 패턴 — 후보 체크리스트).
  - 추출 이름을 조직원(`profiles.name`/`org_nodes`)과 매칭: 내부=`attendee_user_ids(uuid[])`, 미매칭=`attendees(text[])` 텍스트 유지.
  - 사용자가 칩 UI로 조직원 추가(드롭다운)/외부인 텍스트 추가/삭제. **자동 확정 금지** — 사용자가 확정.
  - 추출 실패 시 비워둠(사용자 수동 입력).
- **FR-2 meeting → calendar 멱등 자동기록**
  - 회의노트 생성/수정 시 제목+`meeting_at` 기준 `calendar_events(link_kind='meeting', link_id=meeting_note_id)` **upsert**(중복 금지).
  - `meeting_at` 미입력 시 작성 순간 기준. 소프트삭제 시 연결 캘린더 이벤트도 정리.
- **FR-3 calendar → task 진입**
  - DayDetailPanel에서 `link_kind='meeting'` 일정 클릭 → 해당 회의에서 파생된 업무로 이동. 파생 업무 없으면 회의노트로 폴백.
- **FR-4 task → meeting 역참조**
  - 일일/부서 업무(`daily_logs.meeting_note_id`)에 회의노트 연결 시 "회의노트 출처" 링크 노출.
- **FR-5 부서 선택 UI**
  - `meeting_notes.department_id`를 폼에서 선택 가능(현재 NULL만 저장).
- **FR-6 매칭 SSOT**
  - `lib/meeting/match-attendees.ts` — 이름 문자열 × 조직원 대조 공용 유틸. 모든 호출처 재사용.

## 비기능 요구사항 (NFR)
- RLS 기존 정책 승계(본인 OR admin). 추가 컬럼은 additive(기존 데이터 변형 0).
- 디자인: input-field/label/NbButton/칩 토큰 사용, 인라인 하드코딩 금지.
- 멱등성: 캘린더 자동기록은 반드시 upsert(중복 차단).
- AI 결과 UX: 추출형(후보 체크리스트) 패턴(§5-3) 강제.

## 범위 외 (Out of scope)
- 음성 입력(Phase2), 외부 캘린더 동기화, 알림/리마인더, 참석자 권한 기반 공유.

## 사업 판정 (🟦 DC-BIZ)
CONDITIONAL GO — 조건: (1) 캘린더 멱등 upsert, (2) 참석자 자동확정 금지·미매칭 텍스트 폴백. 우선순위 E→B→C/D→A.
