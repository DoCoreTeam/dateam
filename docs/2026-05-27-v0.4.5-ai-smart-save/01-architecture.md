# AI 스마트 저장 — 아키텍처 설계

## 전체 흐름

```
[사용자 입력]
     │
     ▼ debounce 800ms
[실시간 분석 API] ──→ 힌트 표시 ("N개 항목 감지")
     │
     ▼ AI 저장 클릭
[AI 처리 API] ──→ 스트리밍 응답
     │
     ▼
[결과 확인 패널]
  ├─ 직접 편집
  ├─ 재처리
  └─ 확정 저장 클릭
         │
         ▼
  [연동 체크박스 확인]
  ├─ 캘린더 등록
  ├─ 주간보고 포함
  └─ 루틴 연결
         │
         ▼
  [DB 저장 (다중 항목)]
```

## API 엔드포인트 설계 (개념)

### POST /api/ai/analyze-work
- 입력: `{ text: string, date: string, userId: string }`
- 출력 (스트리밍): `WorkItem[]` 배열
- 역할: 텍스트 → 구조화된 업무 항목 변환

### WorkItem 스키마 (개념)
```
{
  title: string           // 업무 제목 (AI 추출)
  status: 완료|진행중|예정|블로커|메모
  scheduledAt?: datetime  // 날짜·시간 (없으면 null)
  priority: 긴급|높음|보통|낮음
  relatedContactId?: uuid // 매칭된 담당자
  relatedAccountId?: uuid // 매칭된 거래처
  originalText: string    // 원본 텍스트 (감사 추적용)
  confidence: number      // AI 확신도 0~1
}
```

## AI 프롬프트 설계 (개념)

### 시스템 프롬프트 구조
```
당신은 업무 로그 파서입니다.
사용자의 자유형 텍스트에서 업무 항목을 추출하세요.

추출 규칙:
1. 하나의 텍스트에서 여러 업무가 있으면 분리
2. 상태 판단: 과거형/완료 → 완료, 현재 진행 → 진행중, 미래/예정 → 예정
3. 날짜: 상대표현("내일","다음주") → 절대 날짜로 변환 (기준날짜: {today})
4. 긴급/중요/빠른 → 우선순위 높음
5. 거래처/담당자 목록: {existingAccounts}, {existingContacts}와 매칭

출력: JSON 배열 (스트리밍)
```

### 컨텍스트 주입
- 오늘 날짜
- 기존 거래처 목록 (이름 + ID)
- 기존 담당자 목록 (이름 + ID)
- 사용자 최근 업무 패턴 (옵션 — 개인화)

## 스트리밍 구현 방식 (개념)

```
Next.js API Route → ReadableStream
└─ AI SDK의 streamText 또는 동등한 스트리밍 API 사용
└─ 클라이언트: EventSource 또는 fetch + ReadableStream reader
└─ 각 WorkItem이 완성될 때마다 카드 하나씩 표시
```

## 폴백 전략

| 상황 | 처리 방식 |
|------|----------|
| AI API 응답 없음 | 일반 저장으로 자동 폴백 + 토스트 알림 |
| 파싱 실패 | 전체 텍스트를 메모로 저장 |
| 네트워크 오류 | 로컬 draft 저장 후 재시도 안내 |
| 거래처 매칭 없음 | 태깅 없이 저장, 수동 연결 제안 |

## 데이터 모델 변경 (개념)

기존 `daily_work_logs` 테이블에 컬럼 추가 필요:
- `ai_processed: boolean` — AI 처리 여부
- `ai_confidence: float` — AI 확신도
- `original_input: text` — 원본 입력 텍스트 (다중 분리 시 공통)
- `priority: enum` — 긴급/높음/보통/낮음
- `scheduled_at: timestamptz` — AI 추출 날짜·시간
- `linked_account_id: uuid` — 연결 거래처
- `linked_contact_id: uuid` — 연결 담당자
