# 00 — 요구사항 명세
프로젝트: newAX — 리드 인테이크 XLSX 대량 임포트
버전: v0.4.1
작성일: 2026-05-26

---

## 1. 배경 및 문제

### 현재 실패 원인
`gcube_고객전수평가_378_v1.0.xlsx`를 업로드하면 "파일에서 회사명 등 리드 정보를 추출하지 못했습니다" 에러 발생.

근본 원인: 단건(명함/미팅메모) 파싱 프롬프트에 378행짜리 CRM DB를 통째로 전달 → Gemini가 company_name 반환 불가 → 422.

### 대상 파일 컬럼 구조 (gcube 고객전수평가)
| 컬럼명 | 매핑 대상 |
|--------|-----------|
| 회사명 | accounts.name |
| GPU수요강도 | deals.gpu_demand_intensity (신규 필드) |
| Tier | accounts.segment |
| 사업(판단) | deals.description |
| 소재지 | accounts.region |
| 담당자 | contacts.name |
| 직책 | contacts.title |
| 연락처 | contacts.phone |
| 이메일 | contacts.email |
| 추천제안 | deals.product_recommendation (신규 필드) |
| 예상딜밸류(억) | deals.value (단위: 억원) |
| 적합도 | accounts.fit_score (0~100) |
| 비고 | accounts.notes |

---

## 2. 기능 요구사항

### FR-01: 파일 유형 자동 감지
- BULK_MODE: 첫 행이 CRM 헤더 (`회사명` 컬럼 존재) → 대량 임포트 경로
- SINGLE_MODE: 기존 동작 유지 (명함, 미팅메모, 단건 텍스트 문서)
- 판별 로직: 파싱된 헤더 중 `회사명` 포함 여부

### FR-02: 행별 구조화 파싱
- 각 행을 컬럼 인덱스 기반으로 직접 값 추출 (Gemini 의존 최소화)
- Gemini 역할: 추출된 값의 **정규화/보완**만 수행 (한글→영문 segment 변환, 빈 필드 추론 등)
- 10행씩 청크 처리 → Gemini에 JSON 배열로 반환 요청

### FR-03: 거래처(Account) + 담당자(Contact) + 영업기회(Deal) 동시 생성
- 각 행 처리 결과: `lead_intakes` 레코드 1개 (source='xlsx_bulk')
- accounts, contacts, deals 테이블에는 **최종 사용자 확인 후** 저장 (2단계 저장)
- 1단계: lead_intakes에 파싱 결과 저장
- 2단계: 사용자가 결과 검토 후 "CRM에 등록" 버튼으로 확정

### FR-04: 진행률 실시간 표시
- SSE(Server-Sent Events) 스트리밍으로 진행률 전송
- UI: 프로그레스 바 + "378개 중 N개 처리 중..." 텍스트
- 처리 완료 후: 성공/실패 요약 카드

### FR-05: 오류 행 별도 표시
- 파싱 실패 행: 별도 목록으로 표시 (회사명 없음, Gemini 오류 등)
- 실패 행도 lead_intakes에 status='failed'로 저장
- 사용자가 실패 행을 수동 편집하여 재시도 가능

### FR-06: 중복 방지
- 동일 회사명이 이미 accounts에 존재 → 새 Account 생성 대신 기존 연결
- 이메일 중복 → Contact 병합 처리

---

## 3. 비기능 요구사항

### NFR-01: 성능
- 378행 처리 목표 시간: 3분 이내
- 청크 사이즈: 10행 (Gemini 토큰 한도 고려)
- 병렬 처리: 청크를 순차 처리 (Rate Limit 준수, 1초 간격)

### NFR-02: 안정성
- 개별 행 실패가 전체 중단으로 이어지지 않음
- 재시도 불가 행은 failed 상태로 저장 후 계속 진행

### NFR-03: 보안
- RLS: lead_intakes INSERT는 인증된 사용자 본인만
- 파일 사이즈 제한: 기존 20MB 유지
- Gemini API 키: 기존 META 설정값 사용

### NFR-04: UX
- 업로드 즉시 처리 시작 (별도 확인 없음)
- 처리 중 다른 페이지 이동 가능 (백그라운드 처리)
- 결과는 lead-intake 목록에서 확인
