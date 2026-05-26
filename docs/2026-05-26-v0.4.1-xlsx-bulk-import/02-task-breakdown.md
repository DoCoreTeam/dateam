# 02 — 태스크 분해
프로젝트: newAX — 리드 인테이크 XLSX 대량 임포트
버전: v0.4.1
작성일: 2026-05-26

---

## Phase 1: 백엔드 코어 (🟩 DC-DEV-BE)

### T1-1: ParsedLeadData 인터페이스 확장
- 파일: `apps/web/lib/gemini-lead.ts`
- 작업: `gpu_demand_intensity`, `deal_value_billion`, `product_recommendation`, `contact_name`, `contact_title`, `contact_phone`, `contact_email`, `bulk_import_row` 필드 추가
- 영향: 기존 코드 호환성 유지 (모두 optional)

### T1-2: BULK_LEAD_PARSE_PROMPT 작성
- 파일: `apps/web/lib/gemini-lead.ts`
- 작업: 10행 입력 → JSON 배열 출력 프롬프트 상수 추가
- 주의: 마크다운 없음, JSON만 반환하도록 강제 지시 포함

### T1-3: parseBulkLeadChunk() 함수 구현
- 파일: `apps/web/lib/gemini-lead.ts`
- 시그니처: `async function parseBulkLeadChunk(rows: string[][], colMap: ColumnIndexMap, apiKey: string, model: string, userId?: string): Promise<ParsedLeadData[]>`
- 처리: 행 데이터를 `{컬럼명: 값}` 형태로 직렬화 → 프롬프트에 삽입 → Gemini 호출 → JSON 파싱
- 오류 처리: 개별 행 파싱 실패 시 해당 행만 null로 반환, 나머지 계속

### T1-4: detectBulkMode() 함수 구현
- 파일: `apps/web/app/api/leads/parse/route.ts` (또는 lib/lead-bulk.ts로 분리)
- 시그니처: `function detectBulkMode(headers: string[]): ColumnIndexMap | null`
- 로직: `headers.findIndex()` 로 각 컬럼 위치 파악, `회사명` 없으면 null

### T1-5: BULK_MODE SSE 라우트 처리
- 파일: `apps/web/app/api/leads/parse/route.ts`
- 작업: `detectBulkMode()` → SSE `ReadableStream` 생성 → 청크 루프 → `lead_intakes` INSERT
- SSE 이벤트: start / progress / done
- 주의: `MAX_TEXT_BYTES` 우회 (BULK_MODE는 행별 처리라 필요 없음)

### T1-6: bulk-confirm API 라우트 생성
- 파일: `apps/web/app/api/leads/bulk-confirm/route.ts` (신규)
- 처리: intakeIds 받아 accounts/contacts/deals 생성
- 중복 처리: `upsert` with onConflict 처리

---

## Phase 2: 프론트엔드 (🟩 DC-DEV-FE)

### T2-1: BulkImportProgress 컴포넌트
- 파일: `apps/web/app/(member)/lead-intake/BulkImportProgress.tsx` (신규)
- 기능: SSE 수신, 프로그레스 바, 성공/실패 카운터, 완료 시 결과 카드
- Props: `{ file: File, onComplete: (result: BulkResult) => void }`
- SSE 처리: `EventSource` API 사용 (fetch + ReadableStream 방식)

### T2-2: lead-intake 페이지 수정
- 파일: `apps/web/app/(member)/lead-intake/page.tsx`
- 추가: XLSX 대량 파일 감지 시 `BulkImportProgress` 렌더링
- 추가: 처리 완료 후 결과 요약 (성공 N건, 실패 M건)
- 추가: "선택 항목 CRM 등록" 버튼 (체크박스로 행 선택)

### T2-3: 결과 테이블 컴포넌트
- 파일: `apps/web/app/(member)/lead-intake/BulkResultTable.tsx` (신규)
- 기능: 파싱된 lead_intakes 목록, 체크박스 선택, 인라인 편집 (회사명/담당자)
- .table-card 클래스 적용 (모바일 카드 레이아웃)

---

## Phase 3: DB 마이그레이션 (🟩 DC-DEV-DB)

### T3-1: 마이그레이션 파일 작성
- 파일: `supabase/migrations/013_lead_bulk_fields.sql`
- 내용:
  - `lead_intakes.source` CHECK 제약에 'xlsx_bulk' 추가 (또는 제약 제거)
  - 인덱스: `lead_intakes(user_id, source)` 추가 (bulk 결과 조회 최적화)
  - accounts/contacts/deals 의 UPSERT를 위한 unique 인덱스 확인

### T3-2: accounts 중복 처리 정책 확인
- accounts.name 유니크 제약 존재 여부 확인
- 없으면: `ON CONFLICT (name, user_id)` 처리 방식 결정

---

## Phase 4: CSS/UX (🟩 DC-DEV-FE)

### T4-1: globals.css 추가
- `.bulk-progress-bar`: 프로그레스 바 애니메이션
- `.bulk-result-summary`: 성공/실패 요약 카드
- `.bulk-result-table`: 결과 테이블 (table-card 상속)

---

## 구현 순서 (의존성 기반)

```
T1-1 (타입 확장)
  ↓
T1-2 (프롬프트) + T1-4 (감지 함수)  [병렬]
  ↓
T1-3 (파싱 함수)
  ↓
T1-5 (라우트 SSE) + T3-1 (마이그레이션)  [병렬]
  ↓
T1-6 (confirm 라우트) + T2-1 (프로그레스 컴포넌트)  [병렬]
  ↓
T2-2 + T2-3 (페이지/테이블)  [병렬]
  ↓
T4-1 (CSS)
  ↓
통합 테스트
```

---

## 예상 작업량
| Phase | 파일 수 | 예상 라인 | 복잡도 |
|-------|--------|-----------|--------|
| Phase 1 | 2개 수정 + 1개 신규 | ~250줄 | HIGH |
| Phase 2 | 1개 수정 + 2개 신규 | ~300줄 | MEDIUM |
| Phase 3 | 1개 신규 | ~30줄 | LOW |
| Phase 4 | 1개 수정 | ~40줄 | LOW |
| **합계** | **7개** | **~620줄** | **LARGE** |
