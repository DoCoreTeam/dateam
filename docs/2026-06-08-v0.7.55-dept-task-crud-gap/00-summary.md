# 부서업무 CRUD/진행률 결함 분석 + 개선 기획 (분석 전용, 구현 안 함)

생성: 2026-06-08 · 기준 버전: v0.7.55 · 상태: **기획(미구현)**

## 0. 한 줄 요약
부서업무는 **생성(C)·삭제(D)는 완전하나, 수정(U)이 "진행상태 전용"으로만 구현**되어 제목·마감일·우선순위·부서를 고칠 수 없고, **진행률이 체크리스트와 무관한 수동 슬라이더**라 신뢰도가 없다. 모두 **앱 레이어 누락**이며 RLS/스키마는 이미 일반 수정을 허용 → 마이그레이션 없이 서버액션+편집 UI만 추가하면 해소된다.

---

## 1. 사용자 지적 4건 → 코드 근거

| # | 지적 | 근거(파일:라인) | 진단 |
|---|------|----------------|------|
| 1 | 마감일·제목 수정 불가 | `actions.ts:110` `updateDeptTaskProgress`는 `status/progress/checklist`만 갱신. `content`·`target_date`·`priority`·`department_id` 갱신 함수 **부재** | 일반 필드 수정 서버액션이 없음 |
| 2 | 수정이 일부만 / 삭제버튼만 | `DeptTaskDetail.tsx:74` 제목은 `<h2>{task.content}>`(읽기전용), `:80` 마감일은 `<p>`(읽기전용), priority는 **표시조차 없음**. 가변 UI는 상태버튼·진행률·체크박스·담당자뿐, 하단에 `삭제`만(`:153`) | 편집 진입점(✏️) 자체가 없음 |
| 3 | 진행률을 직접 판단? 의미 없음 | `DeptTaskDetail.tsx:98` `<input type=range>` 수동값 → `:55 saveProgress`. 체크리스트 토글(`:56 toggleCheck`)은 `checklist`만 갱신, **progress 자동 재계산 안 함**. `dept-task-utils.ts`에 진행률 산출 함수 없음 | 진행률·체크리스트가 분리되어 수동 추정값에 불과 |
| 4 | (편집 모달이 있는데 왜?) | `DeptTaskFormModal.tsx`는 **생성 전용**(`createDeptTask`, "새 부서 업무", `taskId`/initial props 없음). 모든 필드 입력칸은 **생성 때만** 존재 | 생성폼=완전, 편집폼=없음의 비대칭 |

### 핵심 비대칭
- **생성 시 입력 가능**: 내용·부서·우선순위·마감일·담당자·체크리스트 (FormModal 풀세트)
- **생성 후 수정 가능**: 상태·진행률·체크리스트 done·담당자만 (DeptTaskDetail)
- **영구 고정**: 제목·우선순위·마감일·부서 ← 한 번 만들면 못 고침

## 2. 실현 가능성 (왜 쉬운가)
- `075` RLS `daily_logs_update` 정책은 **행 단위**만 통제(작성자 OR 담당자 OR 부서장 OR admin) — **컬럼 제한 없음**. 즉 DB는 이미 제목·마감일 수정 허용.
- 막는 건 오직 앱 레이어(서버액션이 3개 컬럼만 set, UI에 편집칸 없음).
- → **마이그레이션 0건**. 서버액션 1개 + 편집 UI + 진행률 산출 유틸이면 끝.

---

## 3. 개선 기획안

### 3-A. 일반 필드 수정 (이슈 1·2·4)
1. **`updateDeptTask(id, patch)` 서버액션 신설** (`actions.ts`)
   - patch: `content?`·`priority?`·`targetDate?`·`departmentId?`·`assigneeUserId?`·`checklist?` 부분 갱신
   - 권한: RLS가 행 쓰기 강제. 단 **부서이동(departmentId 변경)·담당자 타인지정**은 기존 `ensureEditable`(부서장/admin) 재사용.
   - 검증: content 공백 거부, priority enum, targetDate ISO. (기존 createDeptTask 검증 재사용 — SSOT)
2. **`DeptTaskFormModal`을 생성/편집 겸용으로 확장** (재사용·SSOT)
   - props에 `mode: 'create'|'edit'` + `initial?: DailyLog` 추가. 편집 시 `updateDeptTask` 호출, 제목="부서 업무 수정".
   - 대안(비권장): DeptTaskDetail 인라인 편집 → 폼 로직 중복 → 재사용 정책 위반.
3. **DeptTaskDetail 헤더에 "수정" 버튼** → 편집모드 FormModal 오픈. 노출 조건=작성자/담당자/부서장.
   - priority도 상세에 **표시**(현재 누락) — 뱃지로.

### 3-B. 진행률 모델 정상화 (이슈 3) — ★제품 결정 필요
**문제**: 진행률이 손으로 끄는 슬라이더라 체크리스트 완료와 따로 논다.

| 옵션 | 동작 | 장점 | 단점 |
|------|------|------|------|
| A. 체크리스트 자동 | progress = round(done/total×100), 슬라이더 제거 | 객관적·근거명확 | 체크리스트 없는 업무는 0 고정 |
| B. 상태 기반 자동 | planned 0·doing 50·blocker 50·done 100 | 단순 | 중간진행 표현 불가 |
| **C. 하이브리드(권장)** | 체크리스트 있으면 done비율 자동 + status=done이면 100강제. 없으면 수동 슬라이더 유지 | 두 경우 모두 합리적, 기존 데이터 무회귀 | 로직 약간 복잡 |

- 권장 **C**: `lib/dept-task-utils.ts`에 `computeProgress(checklist, status, manual?)` SSOT 추가.
  - 체크리스트 toggle 시 progress 자동 반영(별도 저장버튼 불필요). status='done'이면 100, 'planned'이면(체크리스트 없을 때) 0.
  - UI: 체크리스트 존재 → 진행률 read-only 표시(자동), 없을 때만 슬라이더.

## 4. 영향 범위 / 리스크
- 수정 파일(예상): `actions.ts`(+updateDeptTask), `DeptTaskFormModal.tsx`(편집모드), `DeptTaskDetail.tsx`(수정버튼·진행률 자동), `dept-task-utils.ts`(+computeProgress), 테스트.
- 마이그레이션: **없음**. RLS·트리거(076 담당자 무결성) 그대로 적용됨.
- 회귀 포인트: 부서이동 시 담당자 부서소속 트리거(076) 위반 가능 → 부서 변경 시 담당자 초기화 처리 필요.
- 진행률 자동화는 기존 수동 progress 값을 덮어쓸 수 있음 → 마이그레이션 없이 "체크리스트 있는 건만 자동" 적용으로 무회귀.

## 5. 결정 및 구현 (v0.7.56 — 완료)
사용자 결정: **1. 진행률=C(하이브리드) · 2. 부서변경=부서장만(원·대상 부서장+담당자초기화) · 3. 권장 권한(작성자·부서장=코어필드 전체, 담당자=상태·진행률·체크리스트만)**

구현 내역:
- `lib/dept-task-utils.ts`: `computeProgress(checklist,status,manual)` + `isProgressAuto()` SSOT. (done→100 / 체크리스트 있으면 done비율 / 없으면 수동)
- `actions.ts`: `updateDeptTask(id,patch)` 신설(content·priority·targetDate·departmentId·checklist, 권한=작성자 OR 부서장; 부서변경은 원·대상 부서장 모두+담당자 null). `updateDeptTaskProgress` 재작성(현재행 조회→computeProgress로 진행률 자동 산출).
- `DeptTaskFormModal`: 생성/편집 겸용(편집 시 담당자칸 숨김·부서변경 안내).
- `DeptTaskDetail`: 수정버튼·우선순위 뱃지·진행률 자동(read-only 바)/수동(슬라이더) 분기.
- `DeptTasksClient`: 편집모달 배선, canEdit=작성자 OR 부서장.
- 테스트 9 pass, tsc 0, design 0. Playwright: 제목·우선순위·마감일 편집 영속, 체크리스트 1/2→진행률 50% 자동, 생성/삭제 확인. DC-REV 81→(H1 수정).
