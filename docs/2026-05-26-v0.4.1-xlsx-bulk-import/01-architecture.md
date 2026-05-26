# 01 — 아키텍처 설계
프로젝트: newAX — 리드 인테이크 XLSX 대량 임포트
버전: v0.4.1
작성일: 2026-05-26

---

## 1. 전체 데이터 흐름

```
[사용자] 파일 업로드
    │
    ▼
POST /api/leads/parse  (multipart/form-data)
    │
    ├─ SINGLE_MODE (기존) ─────────────────────────────→ 기존 처리 유지
    │
    └─ BULK_MODE (신규)
         │
         ▼
    detectBulkMode(headerRow) → 컬럼 인덱스 맵 생성
         │
         ▼
    SSE 응답 시작 (Content-Type: text/event-stream)
         │
         ├─ 청크 1 (row 1~10) → buildChunkPrompt() → Gemini API → 파싱 결과
         ├─ 청크 2 (row 11~20) → ...
         │  ...
         └─ 청크 N (row 371~378)
              │
              ▼
         각 청크 결과 → lead_intakes bulk INSERT (status='completed'|'failed')
              │
              ▼
         SSE: {"processed": N, "total": 378, "success": M, "failed": K}
              │
              ▼
    SSE 종료: {"done": true, "summary": {...}}
         │
         ▼
[프론트엔드] 결과 카드 표시 + "CRM에 등록" 버튼
```

---

## 2. 파일 수정 목록

### 수정 파일 (기존)
| 파일 | 변경 내용 |
|------|-----------|
| `apps/web/lib/gemini-lead.ts` | `BULK_LEAD_PARSE_PROMPT` 추가, `parseBulkLeadChunk()` 함수 추가, `ParsedLeadData` 인터페이스 확장 |
| `apps/web/app/api/leads/parse/route.ts` | `detectBulkMode()` 추가, BULK_MODE 분기, SSE 응답 처리 |
| `apps/web/app/(member)/lead-intake/page.tsx` | 진행률 UI 컴포넌트, 결과 요약 카드, "CRM 등록" 버튼 |

### 신규 파일
| 파일 | 역할 |
|------|------|
| `apps/web/app/(member)/lead-intake/BulkImportProgress.tsx` | SSE 수신 + 진행률 표시 클라이언트 컴포넌트 |
| `apps/web/app/api/leads/bulk-confirm/route.ts` | 선택된 lead_intakes → accounts/contacts/deals 확정 생성 |

### DB 마이그레이션
| 파일 | 내용 |
|------|------|
| `supabase/migrations/013_lead_bulk_fields.sql` | `lead_intakes.source` 에 'xlsx_bulk' 허용, parsed_data에 신규 필드 문서화 (스키마 변경 아님 — JSONB라 무료) |

---

## 3. 핵심 함수 시그니처

### `detectBulkMode(headers: string[]): ColumnIndexMap | null`
```typescript
type ColumnIndexMap = {
  companyName: number
  gpuDemand?: number
  tier?: number
  businessJudge?: number
  region?: number
  contactName?: number
  contactTitle?: number
  contactPhone?: number
  contactEmail?: number
  productRecommendation?: number
  dealValueBillion?: number
  fitScore?: number
  notes?: number
}
// 회사명 컬럼 없으면 null (SINGLE_MODE)
```

### `parseBulkLeadChunk(rows: string[][], colMap: ColumnIndexMap, apiKey: string, model: string): Promise<ParsedLeadData[]>`
```typescript
// 10행 입력 → Gemini 1회 호출 → ParsedLeadData[] 반환
// Gemini 역할: 값 정규화만 (segment 영문화, fit_score 숫자화, 빈 필드 추론)
```

### `ParsedLeadData` 확장 필드
```typescript
interface ParsedLeadData {
  // 기존 필드 유지...
  
  // 신규 필드
  gpu_demand_intensity?: 'High' | 'Medium' | 'Low' | null
  deal_value_billion?: number | null
  product_recommendation?: string | null
  contact_name?: string | null
  contact_title?: string | null
  contact_phone?: string | null
  contact_email?: string | null
  bulk_import_row?: number  // 원본 행 번호
}
```

---

## 4. BULK_LEAD_PARSE_PROMPT 구조

```
당신은 CRM 데이터 정규화 전문가입니다.
아래는 고객 데이터베이스에서 추출한 10개 행의 구조화된 데이터입니다.
각 행을 JSON 객체로 변환하여 배열로 반환하세요.

[필드 매핑 규칙]
- 회사명 → company_name (필수)
- GPU수요강도 → gpu_demand_intensity: "High"/"Medium"/"Low" (한글이면 영문 변환)
- Tier → segment: "Enterprise"/"Mid-Market"/"SMB" (T1→Enterprise, T2→Mid-Market, T3→SMB)
- 소재지 → region (시/도 단위로 정규화)
- 담당자 → contact_name
- 직책 → contact_title
- 연락처 → contact_phone (하이픈 정규화)
- 이메일 → contact_email (소문자 정규화)
- 추천제안 → product_recommendation
- 예상딜밸류(억) → deal_value_billion (숫자만, 단위 제거)
- 적합도 → fit_score (0~100 숫자, 없으면 null)
- 비고 → notes

[데이터]
{rows_json}

[출력 형식]
반드시 JSON 배열만 반환. 마크다운 없음. 설명 없음.
[{"company_name": "...", "gpu_demand_intensity": "...", ...}, ...]
```

---

## 5. SSE 이벤트 프로토콜

```
data: {"type":"start","total":378}

data: {"type":"progress","processed":10,"total":378,"success":9,"failed":1}
data: {"type":"progress","processed":20,"total":378,"success":19,"failed":1}
...
data: {"type":"done","processed":378,"success":371,"failed":7,"intakeIds":[...]}
```

---

## 6. 2단계 저장 흐름

### 1단계 (자동): lead_intakes 저장
```sql
INSERT INTO lead_intakes (user_id, source, raw_input, status, parsed_data, fit_score)
VALUES (userId, 'xlsx_bulk', 원본행텍스트, 'completed', parsedJson, fitScore)
```

### 2단계 (사용자 확정): /api/leads/bulk-confirm
```typescript
// 요청: { intakeIds: string[], selectedIds: string[] }
// 처리:
//   1. lead_intakes에서 parsed_data 읽기
//   2. accounts UPSERT (회사명 중복 체크)
//   3. contacts UPSERT (이메일 중복 체크)
//   4. deals INSERT (연결된 account_id, contact_id 포함)
//   5. lead_intakes.status = 'crm_registered' 업데이트
```

---

## 7. 기존 SINGLE_MODE와의 공존

`/api/leads/parse` 라우트 내 분기:
```
Content-Type: multipart/form-data
    │
    ├─ XLSX/XLS 파일 && detectBulkMode() !== null
    │   → BULK_MODE (SSE 응답)
    │
    └─ 그 외 모든 경우
        → SINGLE_MODE (기존 JSON 응답, 변경 없음)
```

SINGLE_MODE는 기존 코드를 **전혀 건드리지 않는다**.
