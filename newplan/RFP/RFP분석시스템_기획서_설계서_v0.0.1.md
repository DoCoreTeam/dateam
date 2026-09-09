# 제안요청서(RFP) 분석 시스템 기획서 및 설계서 v0.0.1

작성일 2026-09-09
작성 Claude Fable 5.1 (docore 작업지시 프롬프트 v0.0.2 기준)
대상 독자 docore (기획 확정자 겸 구현 주체)
문서 상태 초안, 검토 후 v0.0.2로 갱신 예정

---

## 0 문서 사용 방법

### 0.1 검토 순서

1. 1장 요약에서 핵심 결론 8가지와 권고안 확인
2. 2.2절 기존 사내 모듈 프로젝트와의 관계 권고안을 먼저 승인 여부 결정 (이후 모든 설계의 전제)
3. 6장 결정 필요 질문 목록에 답변 작성 (답변에 따라 설계서 일부 분기)
4. 2장 기획서 나머지 절 검토 (시나리오, 기능 우선순위, 로드맵, 지표, 리스크)
5. 3장 설계서 검토, 특히 3.5 멀티 벤더 연동과 3.7 DB 스키마는 구현 착수 전 확정 필요
6. 4장 무리한 요구사항과 대안, 5장 놓쳤을 만한 고려사항은 반영 여부만 체크
7. 부록의 벤더 정책 요약표와 파서 비교표는 구현 시점에 재검증 (변동이 빠른 항목)

### 0.2 다음 단계

- 이 문서의 검토 의견과 6장 답변을 반영해 v0.0.2 확정
- 확정본을 domangcha 경량 루프의 플랜 문서 입력으로 사용, Phase 0 (인입과 구조화) 구현 착수
- Phase 0 완료 후 실제 RFP 20건 이상으로 파서 품질을 측정한 뒤 Phase 1 착수 여부 판단

### 0.3 표기 규칙

- 확정된 결정은 "확정", 권고는 "권고", 미정은 "결정 필요"로 표기
- ※ 참고 주석, **※** 강조
- 벤더 모델명, 가격, 컨텍스트 크기는 2026년 9월 초 조사 기준이며 설정 시점에 재확인 대상
- 법령 조문 번호는 본문에서 생략하고 법령명과 제도명으로 표기, 구현 시 국가법령정보센터에서 조문 확정

### 0.4 원본 프롬프트에 포함된 참고 메모 처리

- 전달된 프롬프트 문서에 "Fable에게는 전달하지 않는 docore용 메모" 4개 항목이 포함되어 있었음
- 해당 메모는 검증 체크리스트로 활용, 네 항목 모두 본문에 명시적으로 반영 (HWP/HWPX 구분 3.4절, 모드 분기의 파이프라인 및 DB 반영 3.3절과 3.7절, 교차검증 권장 기준과 기본 모드 보완 3.5.6절과 3.5.7절, 민감정보 보안 검토 3.13절)

---

## 1 요약

### 1.1 핵심 결론 8가지

1. 기존 사내 모듈 프로젝트와의 관계: "독립 코어, 사내 모듈 배포" 방식 권고. 별도 저장소와 별도 DB 스키마를 가진 독립 서비스로 코어를 만들되, 첫 배포 형태는 AX사업부 내부 시스템에 SSO로 붙는 모듈. 기존 1단계 범위(인입과 구조화)는 이번 전체 비전의 Phase 0으로 그대로 흡수
2. HWP 파싱: AGPL 라이선스인 pyhwp 대신 MIT 라이선스의 Rust 기반 rhwp(HWP 5.0과 HWPX 동시 지원, Python 바인딩 rhwp-python, WASM npm 패키지 @rhwp/core)를 1순위, HWPX 전용 보조로 hwpxkit, 상용 폴백으로 Upstage Document Parse(HWP/HWPX 직접 업로드 지원) 채택 권고. 배포용(DRM) HWP는 오픈소스로 처리 불가하므로 사용자 PDF 변환 안내로 대응
3. PDF 파싱은 SaaS 전환을 고려해 AGPL인 PyMuPDF를 피하고 MIT/BSD 계열(pypdfium2, pdfplumber, Docling) 조합 권고
4. AI 분석은 기본 모드(단일 벤더)와 교차검증 모드(사용자 선택형)로 분기, 교차검증은 분석 요청 시 사전 선택과 리포트 확인 후 항목별 추가 요청 두 진입점 모두 지원. 결과는 덮어쓰기가 아닌 병기, 리포트는 불변 버전으로 누적
5. 정확도의 1차 방어선은 교차검증이 아니라 "근거 기반 추출(evidence grounding)". 모든 추출 값은 원문 블록 ID를 근거로 가져야 하고, 근거 문자열이 원문에서 확인되지 않으면 신뢰도 강등. 교차검증은 오판 손실이 큰 항목에 선택 적용
6. 이상 조항 탐지는 규칙 기반(법령 최소 요건, 특정 상표 지정, 기간과 예산 정합성), 통계 기반(축적 DB 대비 희귀도), AI 판단 세 층의 혼합. 결과는 "확정"과 "의심" 두 등급으로 구분하고 사람 검토 전제
7. 나라장터 OpenAPI(입찰공고, 사전규격, 낙찰, 계약 정보)를 연동하면 공고 메타데이터(배정예산, 추정가격, 마감일)를 수기 입력 없이 채우고 낙찰 결과를 학습 루프의 정답 데이터로 확보 가능. 원 프롬프트에 없던 항목이나 이 시스템의 데이터 축적 가치를 결정하는 핵심 연동으로 권고
8. 보안은 문서 등급(공개, 조건부 공개, 민간 NDA)에 따라 허용 벤더와 전송 방식을 달리하는 정책 기반 설계. 민감 문서는 gcube GPU 위에 자체 서빙하는 오픈웨이트 모델로 처리하는 내부 벤더 옵션을 두어 데이터얼라이언스 자산과 연결

### 1.2 이번 문서의 범위

- 기획서와 설계서를 전체 비전 기준으로 작성, 구현 순서는 로드맵의 Phase 0부터 4로 구분
- 코드, 프롬프트 전문, 화면 설계는 포함하지 않음. 각각 Phase 착수 시 별도 플랜 문서로 작성
- 벤더 정책과 라이브러리 현황은 2026년 9월 초 웹 조사 결과, 부록에 출처 링크 수록

---

## 2 기획서

### 2.1 서비스 목적과 배경

#### 2.1.1 문제 정의

- 한국 공공 입찰은 제안요청서(RFP)가 필수 제공되며 정보화 사업 기준 본문 100~300페이지, 첨부(과업내용서, 입찰공고문, 계약특수조건, 제안서 작성 안내, 서식)까지 합치면 더 커짐
- 영업 담당자 한 명이 주당 수 건에서 수십 건의 공고를 검토해야 하며, 정독 없이 판단할 경우 자격 요건 미충족, 예산 대비 과업 과다, 특정 업체 특화 조항을 놓쳐 제안 비용을 낭비하는 사례가 반복
- 검토 결과가 개인 머릿속과 개별 파일에 흩어져 있어 조직 차원의 학습이 누적되지 않음

#### 2.1.2 서비스 목적

- RFP 파일 하나를 넣으면 사업성 판단에 필요한 핵심 정보를 원문 근거와 함께 20분 내 리포트로 제공
- 회사 역량 대비 전체 수행, 부분 참여, 부적합을 근거와 함께 판정하고 부족한 요건(갭)을 명시
- 검토한 RFP를 조직 자산으로 축적해 유사 사업 비교와 자연어 질의가 가능한 지식베이스로 발전
- 방대한 분량 속 이상하거나 과도하거나 특정 업체에 유리한 조항을 사람이 놓치지 않도록 하이라이트

#### 2.1.3 배경 제약

- 대상 문서는 공공(나라장터 및 기관 자체 조달)과 민간/대기업 RFP 모두
- 한국 공공 문서는 HWP/HWPX 비중이 높고, 일부는 스캔 PDF 또는 배포용(DRM) HWP로 제공
- 데이터얼라이언스 AX사업부(gcube.ai GPU 클라우드 영업)가 1차 사용자, 이후 파트너사와 외부 고객으로 확장 가능성
- docore의 제품 철학: 사용자 입력 최소화, 데이터는 풍부하게, 어시스턴트가 할 수 있는 것은 최대로 자동화

### 2.2 기존 사내 모듈 프로젝트와의 관계 정리 및 권고안

#### 2.2.1 기존 프로젝트 요약

- 목적: RFP를 넣으면 면밀 검토, 회사 기본정보 설정 후 전체 수행 가능 여부 판단, 제안서 목차와 제안 전략 도출
- 확정 사항: 공공과 민간 모두 대상, 설정형 회사 프로필, 1단계 범위는 인입과 구조화까지, 탑재 형태는 AX사업부 내부 업무 시스템에 모듈로 부착(dacrm 등과 동일 방식), 만들면서 써보는 점진적 진행
- 이번 전체 비전과의 차이: 입력 형식 확대(이미지, HWP, HWPX), 복수 벤더 교차검증, DB 축적과 비교, 이상 조항 탐지, AI 어시스턴트가 추가됨. 제안서 목차와 전략 도출은 이번 요청의 4대 핵심 기능에서 빠져 있음

#### 2.2.2 선택지 비교

| 구분 | A 사내 모듈 안에서 확장 | B 완전 독립 서비스 신규 구축 | C 독립 코어, 사내 모듈 배포 (권고) |
|---|---|---|---|
| 구조 | 내부 시스템 코드베이스와 DB 안에 기능 추가 | 별도 서비스, 별도 인증, 별도 온보딩 | 별도 저장소와 DB 스키마, 배포는 내부 시스템에 SSO 모듈로 부착 |
| 초기 속도 | 가장 빠름 | 가장 느림 (인증, 결제, 온보딩 선행) | 빠름 (인증만 내부 SSO 위임) |
| 사용자 확보 | 즉시 | 별도 영업 필요 | 즉시 |
| 독립 SaaS 전환 | 어려움 (데이터와 코드 결합) | 불필요 | 계획된 전환 (tenant 분리 이미 설계됨) |
| 보안 리스크 | 낮음 | 높음 (외부 고객 NDA 문서) | 낮음에서 시작, 전환 시 재평가 |
| 파서와 AI 워커 | 내부 시스템 언어 제약 | 자유 | 자유 (Python 워커 별도 운영) |
| 기존 1단계 산출물 | 그대로 사용 | 재작성 | 그대로 Phase 0으로 흡수 |

#### 2.2.3 권고안: C 독립 코어, 사내 모듈 배포

- 결정 사항으로 제안하는 원칙 7가지
  1. 저장소 분리: 내부 시스템과 별도 저장소, 별도 배포 파이프라인, 시맨틱 버전 독립 관리
  2. DB 분리: 초기에는 동일 Supabase 프로젝트 안의 별도 스키마(rfp)로 시작, 전환 시 별도 프로젝트로 이관 가능하도록 내부 시스템 테이블에 외래키를 걸지 않음
  3. 모든 테이블에 org_id(테넌트 키) 포함, Row Level Security 정책을 처음부터 적용. 사내 사용 중에는 org 1개
  4. 인증은 어댑터 패턴: 사내 배포에서는 내부 시스템의 NextAuth 세션을 신뢰하는 SSO 어댑터, 독립 배포에서는 자체 로그인 어댑터로 교체
  5. 내부 시스템과의 결합은 세 가지로 한정: 사용자 디렉토리 조회, 메뉴 진입 링크, 알림 채널. 데이터 공유가 필요하면 API로만
  6. 회사 프로필, 벤더 설정, 이상 조항 규칙은 모두 DB 저장과 UI 설정 (env 파일 설정 최소화, docore 선호 반영)
  7. 독립 SaaS 전환 판단 기준을 미리 정의: 축적 RFP 300건 이상, 내부 주간 활성 사용자 5명 이상 4주 연속, 외부 조직 2곳 이상 사용 요청 중 2개 충족 시 전환 검토
- 기존 1단계(인입과 구조화)는 폐기나 재작성 대상이 아니라 이번 로드맵의 Phase 0 그 자체. 다만 구조화 산출물을 3.3절의 RFP-IR(중간 표현) 규격에 맞추도록 조정
- 기존 기능 중 이번 요청에서 빠진 제안서 목차와 제안 전략 도출은 핵심 기능 5(확장)로 로드맵 Phase 3에 배치. 리포트와 적합도 판정 결과를 입력으로 받는 후속 기능이라 순서상 자연스러움
- 서비스명은 미정, 이 문서에서는 가칭 "RFP 분석기"로 표기 (6장 질문)

#### 2.2.4 권고안 채택 시 즉시 결정할 사항

- 내부 시스템의 인증 방식과 세션 공유 방법 (6장 질문 1)
- Python 워커 호스팅 위치 (gcube VM, 별도 컨테이너 호스팅 등, 6장 질문 14)
- Supabase 프로젝트 공유 여부 (권고: 공유하되 스키마 분리)

### 2.3 타겟 사용자와 사용 시나리오

#### 2.3.1 사용자 유형

| 유형 | 설명 | 주요 행동 |
|---|---|---|
| 영업 담당자 (1차) | AX사업부 영업, 주당 다수 공고 검토 | 업로드, 리포트 확인, 참여 판단, 체크리스트 활용 |
| 사업 책임자 | 본부장, 참여 의사결정권자 | 요약 리포트 검토, 교차검증 승인, 결정 기록 |
| 제안 실무자 | 제안서 작성 담당 | 요구사항 목록, 산출물, 평가기준, 제안서 목차(Phase 3) |
| 관리자 | 시스템 운영 (docore) | 벤더 설정, 키 관리, 규칙 관리, 비용 모니터링 |
| 파트너/외부 조직 (확장) | gcube 파트너사, 외부 고객 | 자체 회사 프로필로 적합도 판정 |

#### 2.3.2 시나리오 1: 기본 모드만으로 끝나는 일상 검토

- 상황: 나라장터에 뜬 3억 규모 AI 데이터 구축 용역, 마감 12일 전
- 흐름: HWP 업로드 (또는 공고번호 입력으로 자동 수집) → 5분 내 파싱과 구조화 → 15분 내 단일 벤더 리포트
- 리포트에서 확인: 사업 개요, 산출물, 기간 6개월, 예산 3억(부가세 포함), 자격 요건(소프트웨어사업자 신고, 유사 실적 2건), 준비 체크리스트 12항목
- 적합도 판정: 부분 참여 적합. 이유는 데이터 구축 실적 부재, GPU 인프라 제공 부분은 강점. 컨소시엄 권장 역할 명시
- 이상 조항: 의심 1건 (특정 클라우드 인증 요구가 통상 대비 희귀)
- 결정: 교차검증 없이 컨소시엄 참여 검토로 종료. 근거는 원문 페이지 링크로 확인
- 교차검증을 선택하지 않는 이유: 금액과 자격 요건이 원문 근거로 확인되었고 신뢰도 높음, 사업 규모가 작아 오판 손실이 제한적

#### 2.3.3 시나리오 2: 리포트 확인 후 항목별 교차검증 추가

- 상황: 40억 규모 지자체 AI 플랫폼 구축, 예산 조건이 본문 여러 곳에서 다르게 기재된 것으로 의심
- 흐름: 기본 리포트 생성 → 시스템이 "사업 금액" 항목에 교차검증 권장 배지 표시 (근거: 원문 내 금액 언급 3곳 불일치, 오판 손실 큼)
- 사용자가 "사업 금액", "자격 요건", "이상 조항" 3개 항목만 선택 → 예상 추가 비용 약 2,100원, 소요 3분 안내 → 확인
- 벤더 3곳 병렬 호출 → 금액은 2곳 일치 1곳 불일치(부가세 해석 차이) → 리포트 v2에 병기, 불일치 사유와 각 벤더 근거 표시 → 사용자가 최종값 선택 후 확정 기록
- 이상 조항은 벤더 합집합 5건 중 2곳 이상 발견 2건을 상위 노출

#### 2.3.4 시나리오 3: 분석 요청 시점에 교차검증 사전 선택

- 상황: 100억 이상 대형 사업, 컨소시엄 구성 전 사업 책임자가 리포트 전체 신뢰도를 높이길 원하는 상황
- 흐름: 업로드 시 모드 "교차검증" 선택, 참여 벤더 기본값(관리자 설정) 확인, 예상 비용과 시간 확인 후 실행
- 결과: 리포트 v1이 처음부터 벤더별 결과와 합의 값을 포함한 상태로 생성

#### 2.3.5 시나리오 4: 축적 데이터 질의

- 질의 예: "최근 1년 내 예산 10억에서 30억 사이 GPU 또는 AI 인프라 관련 RFP 중 우리가 부적합 판정받은 건과 그 이유"
- 어시스턴트가 구조화 필드(예산, 기간, 판정)로 1차 필터, 의미 검색으로 2차 매칭, 답변에 각 RFP의 원문 위치와 판정 근거 링크 제시

#### 2.3.6 시나리오 5: 신규 공고 자동 레이더 (Phase 3)

- 관리자가 키워드, 분류, 예산 범위를 설정하면 나라장터 API로 신규 공고를 매일 수집, 자동 파싱 후 적합도 사전 점수로 정렬해 알림
- 사용자는 점수 상위 건만 열어 리포트 확인

### 2.4 핵심 기능 정의와 우선순위

#### 2.4.1 우선순위 원칙

- P0: 없으면 서비스가 성립하지 않는 기능
- P1: 1차 사용자(AX사업부)의 핵심 가치
- P2: 축적 효과가 생기는 시점에 가치가 커지는 기능
- P3: 확장 기능

#### 2.4.2 기능 목록

| 번호 | 기능 | 우선순위 | Phase | 비고 |
|---|---|---|---|---|
| F0 | 인입과 구조화 (PDF, 이미지, HWP, HWPX, ZIP 묶음, OCR, 원문 뷰어) | P0 | 0 | 기존 1단계 범위 |
| F0-1 | 나라장터 공고번호 입력으로 첨부와 메타데이터 자동 수집 | P1 | 1 | 입력 최소화 철학 |
| F1 | 제안요청서 리포트 생성 (개요, 산출물과 범위, 기간, 금액과 예산 조건, 제약 사항, 준비 체크리스트) | P0 | 1 | 근거 블록 필수 |
| F1-1 | 기본 모드 정확도 보완 (규칙 검증, 근거 대조, 자기 검토 패스) | P0 | 1 | 3.5.7절 |
| F5 | 회사 프로필 설정과 적합도 판정 (전체 수행, 부분 참여, 부적합, 갭 목록) | P1 | 1 | 기존 프로젝트 핵심 |
| F3 | 이상 및 특이 조항 탐지 (규칙 층 먼저, 통계와 AI 층 추가) | P1 | 1 규칙, 2 혼합 | 하이라이트 섹션 |
| F6 | 교차검증 모드 (사전 선택, 사후 항목별, 비용과 시간 고지, 병기와 버전) | P1 | 2 | 3.5절 |
| F2 | RFP DB 축적과 유사 사업 비교 | P2 | 2 | 축적 20건 이후 가치 |
| F4 | AI 어시스턴트 검색과 질의 (RAG, 근거 제시) | P2 | 2 | 축적 50건 이후 가치 |
| F7 | 결과 피드백과 학습 루프 (참여 결정, 낙찰 결과, 판정 정확도 보정) | P2 | 3 | 나라장터 낙찰 API |
| F8 | 신규 공고 자동 레이더와 알림 | P2 | 3 | |
| F9 | 제안서 목차와 제안 전략 도출 | P3 | 3 | 기존 프로젝트 기능 흡수 |
| F10 | 민감 문서용 내부 모델 벤더 (gcube 자체 서빙) | P2 | 3 | 민간 NDA 문서 대응 |
| F11 | 정정공고와 질의응답 반영에 따른 RFP 버전 비교 | P3 | 3 | 5장 고려사항 |
| F12 | 독립 SaaS 전환 (멀티테넌트 온보딩, 결제, 파트너 매칭) | P3 | 4 | 2.2.3 전환 기준 |

#### 2.4.3 핵심 기능 1, 리포트 생성 정의

- 입력: 구조화된 RFP-IR, 회사 프로필(선택), 분석 모드와 벤더 설정
- 출력: 리포트 JSON(스키마 3.6절) + 웹 리포트 화면 + 보고용 요약(1~2페이지) + 작업용 상세(근거, 벤더별 결과, 이력 포함)
- 항목별 필수 속성: 값, 근거 블록 목록(문서, 페이지, 블록 ID, 인용 문자열), 신뢰도(0~1), 근거 확인 상태(확인, 미확인), 생성 벤더, 검증 상태(단일, 일치, 다수 일치, 불일치, 사용자 확정)
- 준비 체크리스트는 두 종류로 분리: 제출 서류 체크리스트(원문에서 추출), 자격 요건 충족 체크리스트(회사 프로필 대조 결과 포함)
- 보고용과 작업용 분리는 docore 문서 규약과 동일 (보고용에는 근거와 이력 미포함)

#### 2.4.4 핵심 기능 2, DB 축적과 비교 정의

- 분석 완료 RFP는 원문 파일, IR, 리포트, 판정, 결과 피드백까지 한 단위(rfp_case)로 저장
- 유사 사업 검색: 사업 개요 임베딩, 요구사항 임베딩, 구조화 필드 필터(기관 유형, 사업 분류, 예산 구간, 기간, 지역)를 결합
- 차이점 도출: 구조화 필드 정형 비교(예산, 기간, 자격, 산출물 수) + 요구사항 목록 정렬 비교 + AI 요약 (양쪽 근거 병기)
- 정확도 개선 구조: 판정 결과와 실제 결과(참여 여부, 낙찰 여부, 낙찰가)를 저장, 표본 50건 이상 시 적합도 가중치 보정 (3.10.5절). 필수가 아닌 확장 방향으로 설계

#### 2.4.5 핵심 기능 3, 이상 및 특이 조항 탐지 정의

- 탐지 유형 분류 (초기 8종): 특정 상표 및 제품 규격 한정, 통상적이지 않은 자격 요건, 비현실적 기간, 비현실적 예산, 법령 최소 기준 위반 의심(공고 기간 등), 과도한 지식재산권 귀속 및 무상 요구, 과도한 책임 및 위약 조항, 상충하는 기재(본문 간 불일치)
- 탐지 방식: 규칙 층(결정적), 통계 층(축적 DB 대비 희귀도), AI 층(맥락 판단)의 혼합, 3.8절
- 출력 등급: 확정(규칙 층에서 검증된 사실), 의심(AI 또는 통계 단독 신호), 기각(사용자 판단)
- 리포트 내 별도 하이라이트 섹션과 원문 뷰어 내 색상 표시

#### 2.4.6 핵심 기능 4, AI 어시스턴트 정의

- 대상 데이터: 축적된 RFP 전체(원문 블록, 리포트 필드, 판정, 이상 조항, 결과 피드백)
- 질의 유형: 구조화 조건 검색(기간, 규모, 기관), 의미 검색(유사 조항), 혼합, 특정 문서 내 질의
- 답변 규칙: 모든 사실 진술은 근거 링크(문서, 페이지, 블록) 첨부, 근거 없는 진술은 "추정"으로 표시
- 접근 제어: 사용자 소속 org 데이터만 검색 (RLS)

### 2.5 단계별 로드맵

| Phase | 버전 | 범위 | 완료 기준 | 예상 기간 |
|---|---|---|---|---|
| 0 인입과 구조화 | v0.1.x | F0, 원문 뷰어, 섹션 트리, 전문 검색, 문서 등급 지정 | 실제 RFP 20건 파싱 성공률 95%, HWP 표 추출 정확도 육안 검수 | 2~3주 |
| 1 MVP 리포트 | v0.2.x ~ v0.3.x | F1, F1-1, F5, F3 규칙 층, F0-1, 벤더 설정 UI, 비용 로그 | 20건 리포트 필드 근거 확인율 90% 이상, 담당자 수정률 15% 이하 | 4~6주 |
| 2 축적과 교차검증 | v0.4.x ~ v0.5.x | F6, F2, F4, F3 혼합 층, 리포트 버전 관리 | 교차검증 불일치 표시 정확, 유사 RFP 검색 만족도, 어시스턴트 인용 정확도 90% | 6~8주 |
| 3 학습과 확장 | v0.6.x ~ v0.9.x | F7, F8, F9, F10, F11 | 판정 보정 효과 측정, 자동 레이더 운영 | 8주 이상 |
| 4 독립 SaaS | v1.0.0 | F12 | 2.2.3 전환 기준 충족 후 | 별도 |

- 각 Phase는 이전 Phase의 실사용 데이터로 착수 여부를 판단 (만들면서 써보며 방향을 잡는 기존 결정 유지)
- Phase 1까지는 교차검증 없이 운영하면서 기본 모드 정확도 데이터를 먼저 쌓고, 그 데이터로 Phase 2의 교차검증 권장 임계값 결정

### 2.6 성공 지표

| 영역 | 지표 | 목표 (Phase 1 종료 시) | 목표 (Phase 2 종료 시) |
|---|---|---|---|
| 시간 절감 | RFP 1건 1차 검토 소요 시간 | 4시간 → 30분 | 20분 |
| 정확도 | 리포트 필드 근거 확인율 | 90% | 95% |
| 정확도 | 담당자 수정률 (필드 기준) | 15% 이하 | 10% 이하 |
| 정확도 | 이상 조항 정밀도 / 재현율 (라벨 세트 기준) | 규칙 층 정밀도 90% | 혼합 층 정밀도 70%, 재현율 80% |
| 판정 | 적합도 판정과 실제 참여 결정 일치율 | 측정 시작 | 80% |
| 교차검증 | 교차검증 실행 건 중 불일치 발견율, 사용자 최종값 변경율 | 해당 없음 | 측정, 임계값 보정에 사용 |
| 비용 | 건당 AI 비용 (기본 모드) | 3,000원 이하 | 2,000원 이하 |
| 채택 | 주간 활성 사용자, 주간 분석 건수 | AX사업부 담당자 전원 | 지속 |
| 축적 | DB 누적 RFP 건수 | 50건 | 200건 |
| 어시스턴트 | 답변 내 인용 정확도 (인용 문서와 위치가 실제 근거인 비율) | 해당 없음 | 90% |

### 2.7 리스크와 고려사항

#### 2.7.1 법적 및 보안 리스크 (공공 문서의 외부 AI 전송)

- 문서 등급별 리스크 정리

| 등급 | 예 | 외부 AI 전송 리스크 | 정책 (3.13절) |
|---|---|---|---|
| 공개 | 나라장터 입찰공고 첨부, 사전규격 공개 문서 | 낮음, 이미 공개된 문서. 담당자 개인정보(이름, 연락처)만 마스킹 | 모든 승인 벤더 허용, 개인정보 마스킹 후 전송 |
| 조건부 공개 | 입찰참가 등록자에게만 배포, 보안서약 첨부, 대외비 표기 | 중간, 배포 조건에 제3자 제공 금지가 있을 수 있음 | 학습 미사용 및 보존기간 제한(ZDR 가능) 벤더만 허용, 사용자 확인 필요 |
| 민간 NDA | 대기업 RFP, 비밀유지계약 하 수령 | 높음, NDA상 제3자 제공 위반 가능 | 기본 외부 전송 차단, 내부 모델(F10) 또는 NDA 검토 후 관리자 예외 승인 |

- 개인정보보호법: RFP에는 담당 공무원 성명, 전화, 이메일이 포함되며 업무상 공개 정보라도 개인정보에 해당. 전송 전 마스킹, 저장 시 최소화, 리포트에는 원문 링크로만 접근
- 벤더 약관상 데이터 활용 (2026년 9월 조사, 부록 B)
  - OpenAI API: 기본적으로 학습 미사용, 남용 감시 로그 최대 30일 보관, 승인 시 ZDR 또는 수정된 남용 감시 적용 가능
  - Anthropic API: 상업용 API 입력과 출력은 학습 미사용, 기본 보존 30일, 조직 단위 승인으로 ZDR 가능. 단 Files API 업로드, 명시적 프롬프트 캐시, 일부 배치 호출은 ZDR 예외
  - Google Gemini API: 유료 티어(빌링 연결 프로젝트)만 프롬프트를 제품 개선에 미사용, 무료 티어와 AI Studio는 사람 검토 포함 학습 활용. **※ 무료 키 사용 절대 금지**
  - xAI (Grok) API: 명시적 허락 없이 학습 미사용, 기본 30일 보관, ZDR은 엔터프라이즈 계정 전용이며 파일과 배치 등 저장 의존 기능이 비활성화
  - Groq: 프롬프트와 컨텍스트 미보존, 학습 미사용을 명시. 다만 오픈웨이트 모델 호스팅 사업자이므로 모델 자체의 품질 편차 존재
- 교차검증 시 노출 범위 확대: 동일 문서가 2~4개 벤더로 전송되므로 조건부 공개 문서는 교차검증 벤더 집합을 ZDR 또는 미보존 벤더로 제한하는 정책이 필요. 리포트에 "전송 벤더 목록"을 감사 로그와 함께 남김
- 저작권: 국가와 지방자치단체가 업무상 작성해 공표한 저작물은 저작권법의 공공저작물 자유이용 규정 적용, 공공기관(공공기관운영법) 저작물은 공공누리 유형에 따름. 내부 분석과 요약은 문제 소지가 낮으나, 리포트를 외부 SaaS 고객에게 제공하거나 원문을 재배포하는 경우 공공누리 유형(특히 상업적 이용 금지 유형) 확인 필요. 민간 RFP는 저작권과 영업비밀 보호 대상이므로 원문 재배포 금지
- AI 기본법(2026년 1월 22일 시행): 외부 API로 AI 기능을 붙인 B2B 서비스도 인공지능이용사업자로서 투명성 확보 의무 대상이 될 수 있음. 리포트와 어시스턴트 답변에 "AI 생성 결과, 검토 필요" 고지 표시를 UI와 내보내기 파일 모두에 포함. 계도기간 1년 이상이나 처음부터 반영
- 공공기관 고객으로 확장 시: 국가정보원 국가인공지능안보센터의 공공분야 AI 보안 정책과 보안성 검토 절차 대상이 될 수 있음. SaaS 형태로 공공기관에 제공하려면 CSAP 등 별도 인증 필요 (gcube가 준비 중인 인증과 연계 검토)

#### 2.7.2 정확도 리스크

- LLM 환각: 원문에 없는 금액이나 요건을 생성할 수 있음. 대응: 근거 기반 추출과 근거 대조를 필수화, 미확인 값은 강등 표시
- 긴 문맥 성능 저하: 1M 토큰 컨텍스트라도 중간 부분 정보를 놓치는 현상. 대응: 섹션 라우팅으로 관련 부분만 집중 투입, 전체 문맥 패스는 보조
- 교차검증의 한계: 벤더 간 합의가 정답을 보장하지 않음 (동일한 오해 가능). 합의는 신뢰도 상향 신호일 뿐 최종 판단은 사람
- 파서 오류: HWP 표와 이미지 삽입 텍스트 누락, OCR 오인식. 대응: 파싱 진단 리포트를 문서마다 남기고 품질 점수가 낮으면 사용자에게 경고

#### 2.7.3 운영 및 비용 리스크

- 벤더 모델 교체 주기가 월 단위: 모델 ID를 코드에 고정하지 않고 DB 설정으로 관리, 폐기 예고 시 관리자 알림
- 비용 급증: 교차검증 남용, 대형 문서 반복 분석. 대응: 조직 월 예산 상한, 건당 예상 비용 사전 고지, 프롬프트 캐시 활용
- 오픈소스 파서(rhwp) 성숙도: 2026년 4월 v0.7 수준의 빠르게 진화하는 프로젝트, 버전 고정과 회귀 테스트 세트 유지 필요
- 라이선스: pyhwp와 PyMuPDF는 AGPL이므로 SaaS 제공 시 소스 공개 의무 또는 상용 라이선스 문제. 초기부터 MIT/BSD/Apache 계열로 구성

#### 2.7.4 제품 리스크

- 축적 효과 전 초기 가치 부족: Phase 1의 리포트와 적합도 판정만으로 단독 가치 확보 필요
- 사용자 입력 부담: 회사 프로필 설정이 무거우면 사용 저조. 대응: 문서 업로드로 프로필 자동 초안 생성 후 확인만 받는 방식 (3.10.2절)
- 이상 조항 오탐이 많으면 신뢰 상실. 대응: 규칙 층은 정밀도 우선, AI 층은 "의심" 등급으로만 표시

---

## 3 설계서

### 3.1 설계 원칙

1. 근거 우선: AI가 생성한 모든 사실 값은 원문 블록 ID를 근거로 보유, 근거 없는 값은 리포트 본문에 확정값으로 표시하지 않음
2. 모드 분기 명시: 기본 모드와 교차검증 모드를 파이프라인, 저장 구조, 화면에서 모두 구분
3. 벤더 불가지론: 모델 ID, 가격, 컨텍스트 한도, 기능 지원 여부를 DB의 벤더 능력 프로필로 관리, 코드에 벤더별 분기 최소화
4. 등급 기반 보안: 문서 등급이 허용 벤더와 전송 방식을 결정, 모든 외부 전송은 감사 로그
5. 입력 최소화: 공고번호 하나로 메타데이터 자동 채움, 회사 프로필은 문서로부터 초안 생성
6. 불변 이력: 리포트는 버전 단위로 불변 저장, 교차검증과 사용자 확정은 새 버전으로 병기
7. 라이선스 안전: SaaS 전환을 전제로 AGPL 의존성 배제
8. 단일 문서 원칙: 사용자에게 보이는 결과물은 리포트 하나로 통합, 보고용과 작업용 뷰만 분리

### 3.2 전체 시스템 아키텍처

#### 3.2.1 구성 요소

```
[사용자 브라우저]
   │ HTTPS
[Next.js 15 앱: rfp-web]  ── SSO 어댑터 ──▶ [내부 업무 시스템 세션 / 자체 로그인]
   │ Prisma                 │ REST/SSE
[Supabase Postgres (스키마 rfp, pgvector, pgroonga 또는 pg_trgm, RLS)]
   │ 작업 큐 (analysis_jobs, SKIP LOCKED 폴링)
[Python 서비스: rfp-docpipe (FastAPI + 워커 프로세스)]
   ├─ 파일 처리 모듈 (PDF, 이미지, HWP, HWPX, ZIP, OCR)
   ├─ 구조화 모듈 (RFP-IR 생성, 섹션 분류, 임베딩)
   ├─ AI 게이트웨이 (LiteLLM SDK, 벤더 라우팅, 폴백, 마스킹, 비용 로그)
   ├─ 분석 오케스트레이터 (기본 모드 / 교차검증 모드, 근거 대조, 앙상블)
   ├─ 탐지 엔진 (규칙, 통계, AI 층)
   └─ 어시스턴트 (하이브리드 검색 + 생성, SSE 스트리밍)
[Supabase Storage: 원본 파일, 페이지 렌더링(SVG/PNG), 암호화]
[Upstash Redis: 레이트 리밋, 세션 캐시, 토큰 수 캐시]
[외부] 벤더 API (OpenAI, Anthropic, Google, xAI, Groq), Upstage Document Parse(선택), 나라장터 OpenAPI(공공데이터포털), 내부 모델 서빙(gcube vLLM, Phase 3)
```

#### 3.2.2 Next.js와 Python 분리 이유

- 문서 파싱과 OCR 생태계(rhwp-python, hwpxkit, pypdfium2, pdfplumber, Docling, PaddleOCR)가 Python에 집중
- LLM 호출, 앙상블, 근거 대조, 탐지 규칙은 배치 성격이 강해 웹 요청 수명과 분리하는 것이 안정적
- Next.js는 UI, 설정, 인증, 리포트 조회, 어시스턴트 프록시에 집중
- 대안: 전부 TypeScript로 구성 가능 (HWP는 @rhwp/core WASM, PDF는 pdf.js 계열, OCR은 외부 API만 사용). Phase 0을 최대한 빨리 끝내고 싶고 자체 OCR을 포기해도 된다면 선택 가능하나, 스캔 문서 자체 처리와 Docling 활용을 위해 Python 워커를 권고

#### 3.2.3 통신 방식

- Next.js → Postgres: Prisma로 CRUD, 작업 생성은 analysis_jobs INSERT
- Python 워커 → Postgres: psycopg 직접 접속, `SELECT ... FOR UPDATE SKIP LOCKED`로 작업 선점, 상태와 진행률 갱신
- 진행 상황 표시: Next.js가 job 상태를 폴링(2~5초) 또는 Supabase Realtime 구독
- 어시스턴트 스트리밍: Next.js Route Handler가 FastAPI의 SSE 엔드포인트를 프록시
- 워커 확장: 프로세스 수를 늘리면 수평 확장, 큐 우선순위(사용자 대기 중 작업 > 자동 레이더 배치)

#### 3.2.4 배포 형태

- rfp-web: Vercel 또는 내부 시스템과 같은 호스팅 (SSO 쿠키 도메인 고려, 같은 상위 도메인의 서브도메인 권고)
- rfp-docpipe: Docker 컨테이너, 초기 1대(4 vCPU, 16GB, OCR 자체 처리 시 GPU 옵션). 호스팅 후보는 gcube VM(사내 자산 활용, 민감 문서 처리 시 유리) 또는 Fly.io/Railway 류. 6장 질문 14
- 환경 분리: dev, staging, prod 세 환경, 벤더 키는 환경별 별도

### 3.3 파이프라인 단계별 설계

#### 3.3.1 상태 기계

```
uploaded → classified → parsing → parsed → structuring → structured → indexing → indexed
        → analyzing(base) → reported(v1)
        → [선택] cross_verifying → reported(v2..n)
        → assessing(fit) → assessed
        → comparing → compared
각 단계는 멱등, 실패 시 failed_<stage>와 오류 원인 저장, 재시도는 해당 단계부터
```

#### 3.3.2 단계 1 인입 (Ingest)

- 입력 경로 4가지: 파일 업로드(단일 또는 다중, ZIP), 나라장터 공고번호 입력(F0-1), 이메일 전달(확장), 자동 레이더(F8)
- 케이스 개념: RFP 한 건은 여러 파일로 구성될 수 있으므로 rfp_cases 아래 document_files를 역할(제안요청서 본문, 과업내용서, 입찰공고문, 계약특수조건, 제안서 작성 안내, 서식, 질의응답 답변, 정정공고, 기타)로 분류. 역할 분류는 파일명 규칙과 첫 페이지 텍스트로 자동 추정 후 사용자 확인
- 중복 검출: 파일 SHA-256 해시, 공고번호와 차수로 동일 건 재업로드 방지 및 정정공고 버전 연결
- 문서 등급 지정: 기본값은 인입 경로로 추정 (나라장터 자동 수집은 공개, 수동 업로드는 사용자 선택 필수, 기본 표시값 공개). 등급이 조건부 공개 또는 민간 NDA면 이후 단계에서 벤더 정책 적용
- 바이러스 및 형식 검증: 확장자와 매직 바이트 일치 검사, 크기 상한(파일 200MB, 케이스 500MB), 압축 폭탄 방지(압축 해제 상한)
- 나라장터 연동(F0-1) 상세
  - 공공데이터포털의 조달청 OpenAPI 활용: 입찰공고정보서비스(공고 기본 정보, 첨부파일 URL), 사전규격정보서비스(사전규격등록번호, 배정예산액, 규격서 파일), 낙찰정보서비스와 계약정보서비스(Phase 3 결과 피드백), 누리장터 민간입찰공고서비스(민간 공고 일부)
  - 활용 신청 후 발급되는 서비스 키를 관리자 설정 UI에 저장 (DB 암호화)
  - 공고번호와 차수를 입력하면 공고명, 공고기관, 수요기관, 배정예산, 추정가격, 기초금액, 개찰일, 계약방법, 낙찰방법, 정보화사업 여부, 긴급공고 여부, 첨부파일을 자동 수집해 rfp_sources에 저장, 첨부는 document_files로 인입
  - 나라장터 외 자체 조달 시스템(국방전자조달, 한전 등)은 연계 공고 정보만 제공되므로 첨부는 수동 업로드
  - 첨부 다운로드 URL이 세션 의존적이거나 봇 차단이 있는 경우가 있어 실패 시 수동 업로드로 폴백하고 실패 사유 표시

#### 3.3.3 단계 2 파싱과 구조화 (Parse, Structure)

- 목표 산출물: RFP-IR (중간 표현). 형식별 파서 결과를 하나의 규격으로 통일해 이후 모든 단계가 형식에 의존하지 않도록 통일
- RFP-IR 규격

```
Document
  meta: {file_role, format, page_count, parser, parser_version, quality_score, warnings[]}
  pages[]: {page_no, width, height, render_ref}          # 렌더링 파일 참조 (SVG 또는 PNG)
  sections[]: {section_id, level, title, number, parent_id, page_start, page_end, block_ids[]}
  blocks[]:   {block_id, type(paragraph|heading|table|list_item|figure|caption|footnote|header|footer),
               text, html(표만), page_no, bbox(x0,y0,x1,y1, 좌표계 명시), section_id, order,
               source_ref(형식별 원천 위치: HWP는 section_idx/para_idx, PDF는 char span),
               text_hash, ocr_confidence(OCR 블록만)}
  tables[]:   {table_id, block_id, rows, cols, cells[{r,c,rowspan,colspan,text}], caption}
  figures[]:  {figure_id, block_id, image_ref, extracted_text(이미지 내 텍스트 OCR)}
```

- 섹션 트리 구성: 제목 블록 탐지(HWP 문단 스타일, 번호 패턴 "제1장", "1.", "가.", "1)", PDF 폰트 크기와 굵기), 번호 체계 정규화, 트리 생성. 실패 시 페이지 단위 가상 섹션으로 폴백
- RFP 표준 목차 분류: 각 섹션을 표준 카테고리 14종으로 분류 (사업 개요, 추진 배경과 목적, 사업 범위와 내용, 요구사항 총괄표, 기능 요구사항, 성능 및 품질 요구사항, 보안 요구사항, 제약 사항, 사업 기간과 일정, 예산과 대가 지급, 입찰 및 제안 안내, 참가 자격, 평가 기준과 배점, 계약 조건과 특수조건, 서식과 기타). 분류는 제목 키워드 규칙 우선, 애매하면 저비용 모델(Groq 호스팅 오픈모델 또는 소형 모델)로 분류. 이 분류가 3.6절 섹션 라우팅의 기반
- 요구사항 총괄표 인식: 정보화 사업 RFP에 흔한 요구사항 ID 체계(예: SFR-001, PER-001, SER-001, 요구사항 분류 코드)를 표에서 추출해 requirements 테이블로 정규화. 이후 적합도 판정과 제안서 목차(F9)의 골격
- 품질 점수: 텍스트 추출 비율(페이지당 문자 수 분포), 표 인식 수, OCR 평균 신뢰도, 섹션 트리 깊이, 경고 수를 합산해 0~100 점수. 60 미만이면 사용자에게 "파싱 품질 낮음, 결과 신뢰도 제한" 경고와 함께 재처리 옵션(상용 파서 폴백) 제시
- 렌더링: 원문 위치 하이라이트를 위해 페이지 이미지를 생성 (PDF는 pypdfium2로 PNG, HWP/HWPX는 rhwp의 페이지 SVG 렌더링). HWP는 rhwp 자체 조판 엔진의 페이지 구분이 한컴 뷰어와 다를 수 있어 페이지 번호를 "근사"로 표시하고 문단 위치(section_idx, para_idx)를 정식 참조로 사용

#### 3.3.4 단계 3 인덱싱 (Index)

- 청크 단위: 블록 그대로(문단, 표 행 묶음)를 기본 청크로 하되 짧은 블록은 앞뒤 합쳐 300~800자로 정규화, 표는 행 단위 청크에 표 제목과 헤더를 접두어로 포함
- 임베딩: 다국어 임베딩 모델 1종을 조직 설정으로 고정 (후보: OpenAI text-embedding-3-large, Google gemini-embedding, Upstage solar-embedding 계열, 자체 서빙 BGE-M3). 모델 변경 시 전체 재임베딩이 필요하므로 embedding_model 컬럼과 버전을 함께 저장
- 전문 검색: Postgres 전문 검색은 기본 파서가 한국어 형태소를 처리하지 못하므로 pgroonga 확장(Supabase 제공 확장 목록에 포함 여부를 설정 시 확인) 또는 pg_trgm 기반 유사 검색 사용. 구현 시 둘 중 하나로 확정
- 구조화 필드 인덱스: rfp_sources와 report_fields의 정규화 컬럼(예산, 기간, 기관 유형, 사업 분류)에 B-tree 인덱스

#### 3.3.5 단계 4 AI 분석 (Analyze), 모드 분기 포함

- 입력: RFP-IR, 표준 목차 분류, 분석 요청(모드, 기본 벤더, 교차 벤더 집합, 항목 범위), 문서 등급
- 공통 전처리: 문서 등급별 벤더 허용 검사 → 개인정보 마스킹 → 토큰 수 산정(벤더별 count-tokens API 또는 비율 추정) → 실행 계획 수립(항목별 컨텍스트 조립 전략, 전체 문맥 패스 여부)
- 기본 모드: 지정 벤더 1곳으로 3.6절의 추출 태스크 실행 → 근거 대조 → 규칙 검증 → 자기 검토 패스 → 리포트 v1
- 교차검증 모드(사전 선택): 동일 태스크를 참여 벤더 N곳에 병렬 실행 → 벤더별 결과 저장 → 합의 판정 → 리포트 v1 (벤더별 결과와 합의값 포함)
- 교차검증 모드(사후 항목별): 기존 리포트 v(n)의 선택 항목에 대해 기본 벤더를 제외한 참여 벤더에 동일 태스크 실행(기본 벤더 결과는 재사용) → 합의 판정 → 리포트 v(n+1)
- 폴백: 지정 벤더 장애 시 3.5.5절 규칙으로 대체 벤더 전환, 리포트 메타에 기록
- 산출: analysis_runs(모드, 벤더 집합, 비용, 시간), llm_calls(호출 단위 로그), report_versions, report_fields, field_vendor_results

#### 3.3.6 단계 5 리포트 생성 (Report)

- 리포트 JSON을 스키마 검증(JSON Schema)한 뒤 report_versions에 불변 저장
- 화면 렌더링은 JSON 기반, 보고용 요약은 같은 JSON에서 파생 (별도 생성 호출 없음)
- 내보내기: 작업용 Markdown, 보고용 PDF(Phase 2), HWP 내보내기는 미지원 (수요 확인 후 결정)

#### 3.3.7 단계 6 적합도 판정 (Assess)

- 3.10절, 회사 프로필 버전과 리포트 버전을 함께 참조해 fit_assessments 저장. 프로필이 갱신되면 재판정 가능

#### 3.3.8 단계 7 DB 축적과 비교 (Store, Compare)

- 축적은 파이프라인 전 단계의 부산물이 그대로 DB에 남는 구조이므로 별도 저장 단계는 없음. "축적 완료" 상태는 리포트 v1 생성과 인덱싱 완료를 의미
- 비교: 유사 후보 검색(임베딩 상위 20건 → 구조화 필드 필터 → 상위 5건) → 정형 비교표 생성 → AI 차이점 요약(양쪽 근거 블록 포함) → rfp_comparisons 저장
- 비교는 사용자 요청 시 실행(비용 통제), 자동 레이더는 후보 검색까지만 자동

### 3.4 파일 처리 모듈 설계

#### 3.4.1 형식별 처리 경로 요약

| 입력 | 1순위 처리 | 폴백 | 비고 |
|---|---|---|---|
| HWP (5.0, OLE 복합 문서) | rhwp-python (Rust rhwp 바인딩), 문단과 표 IR 추출, 페이지 SVG 렌더링 | Upstage Document Parse (HWP 직접 업로드), LibreOffice + H2Orestart로 PDF 변환 후 PDF 경로 | 배포용(DRM) 문서는 처리 불가, 사용자 PDF 변환 안내 |
| HWPX (OWPML, ZIP 안의 XML) | rhwp-python 또는 hwpxkit (Markdown/HTML/JSON 변환, 진단 리포트) | Upstage Document Parse | 두 라이브러리 결과를 Phase 0에서 비교해 1순위 확정 |
| PDF (텍스트 레이어 있음) | pypdfium2(렌더링, 문자 위치) + pdfplumber(표) 또는 Docling(레이아웃, 표, 출처 좌표) | Upstage Document Parse | 텍스트 레이어 유무를 페이지 단위로 판정 |
| PDF (스캔) | OCR 경로 | 상용 OCR API | 페이지 이미지 추출 후 OCR |
| 이미지 (PNG, JPG, TIFF, 다중 파일) | 전처리(회전 보정, 기울기 보정, 대비) → OCR | 상용 OCR API | 파일명 순으로 페이지 순서 부여, 사용자 재정렬 UI |
| ZIP | 압축 해제 후 파일별 역할 분류 | | 중첩 ZIP 1단계까지 |
| DOCX, XLSX (첨부 서식) | python-docx, openpyxl | | 요구사항 총괄표가 XLSX인 경우 대응 |
| HWP 3.0, HML, 기타 구형 | 미지원, 안내 메시지 | | 실제 비중 낮음 |

#### 3.4.2 HWP와 HWPX 파서 조사 결과와 선택 근거

- HWP 5.0: OLE2 복합 파일 구조, 스트림 단위로 압축(zlib)된 레코드 트리, 문단 텍스트와 표, 도형이 바이너리 레코드로 표현. 배포용 문서는 추가 암호화
- HWPX: 한컴이 공개한 OWPML 표준 기반, ZIP 컨테이너 안에 Contents/section0.xml 등 XML 파일. 구조가 명시적이라 파싱 난이도가 낮고 표와 스타일 정보 접근이 용이

| 후보 | 지원 형식 | 언어/바인딩 | 라이선스 | 상태 (2026년 9월 조사) | 판단 |
|---|---|---|---|---|---|
| pyhwp (hwp5) | HWP 5.0만 | Python | AGPL v3 | 2016년 이후 사실상 유지보수 중단, Python 2 시절 설계, 느림 | 제외 (AGPL, HWPX 미지원) |
| rhwp | HWP 5.0, HWPX | Rust 코어, Python 바인딩 rhwp-python, npm @rhwp/core(WASM), CLI | MIT | 2026년 4월 v0.7.x, 활발한 개발, 문단/표/이미지/각주 파싱, 페이지네이션과 SVG 렌더링, IR 블록 API와 LangChain 로더 제공, pyhwp 대비 텍스트 추출 60배 이상 빠름 | 1순위 |
| hwpxkit | HWP/HWPX (패키지 설명 기준) | Rust 코어, Python abi3 휠 | 확인 필요 | Markdown/HTML/JSON 변환, 진단 리포트, 신뢰할 수 없는 입력에 대한 자원 제한 내장 | HWPX 보조 후보, 라이선스와 HWP 지원 범위 확인 후 결정 |
| hwplib, hwpxlib (Java) | HWP, HWPX 각각 | Java | Apache 2.0 | 성숙, 공공 SI에서 널리 사용 | JVM 추가 부담, Python 워커에는 비권고. TypeScript 전용 구성 시 대안 아님 |
| LibreOffice + H2Orestart 확장 | HWP, HWPX 가져오기 | 외부 프로세스 | MPL/LGPL 계열 | 렌더링 기반 PDF 변환 용도 | 렌더링 폴백 전용 |
| Upstage Document Parse | HWP, HWPX, PDF, 이미지 | REST API | 상용 | HWP/HWPX 직접 업로드 지원, 레이아웃과 표 인식, 100페이지 1분 내 처리 주장 | 상용 폴백 및 스캔 문서 1순위 후보, 외부 전송이므로 문서 등급 정책 적용 |

- 선택 근거 요약: 라이선스(MIT), 두 형식 동시 지원, Python과 WASM 양쪽 바인딩(향후 TypeScript 전환 여지), IR과 페이지 렌더링 제공(근거 하이라이트에 필수)
- rhwp 사용 시 주의: 버전을 고정하고 표준 RFP 샘플 20건으로 회귀 테스트(문단 수, 표 수, 텍스트 해시)를 CI에 포함. 조판 차이로 페이지 번호가 한컴 뷰어와 다를 수 있으므로 문단 위치를 정식 참조로 사용
- 배포용(DRM) HWP 대응: 파일 헤더 플래그로 배포용 여부를 판별해 "한컴 뷰어 또는 한글에서 PDF로 저장 후 업로드" 안내. 자동 우회 시도는 하지 않음 (기술적 보호조치 무력화 이슈)

#### 3.4.3 PDF 처리 설계

- 페이지별 텍스트 레이어 판정: 추출 문자 수가 페이지 면적 대비 임계값 미만이면 스캔 페이지로 간주해 OCR 경로 (한 문서 안에 혼합 가능)
- 텍스트 PDF: Docling(MIT)으로 레이아웃 분석, 읽기 순서, 표 구조, 페이지와 bbox 출처를 얻는 방식을 1순위로 검토. Docling이 한국어 문서에서 표 인식 품질이 부족하면 pdfplumber 표 추출로 보완
- 라이선스 주의: PyMuPDF는 AGPL이므로 배제. pypdfium2(Apache/BSD, Google pdfium)로 렌더링과 문자 위치, pdfplumber(MIT)로 표
- 좌표계: PDF 포인트 좌표(원점 좌하단)를 IR 표준(원점 좌상단, 픽셀 독립 비율 0~1)으로 변환해 저장, 렌더링 이미지와 하이라이트 좌표 일치

#### 3.4.4 OCR 설계

- 대상: 스캔 PDF, 이미지, HWP/PDF 내 삽입 이미지(도표, 캡처)
- 엔진 선택을 문서 등급과 정책으로 결정
  - 자체 처리(내부 전송 없음): PaddleOCR(Apache 2.0, 한국어 모델 제공) 또는 Tesseract(kor 모델). 정확도는 상용 대비 낮고 표 구조 복원이 약함. GPU 있으면 PaddleOCR 권고
  - 상용 API: Upstage Document Parse(OCR과 레이아웃 통합, HWP도 처리), 네이버 클로바 OCR(국내 리전, 한국어 강점), Google Document AI, Azure Document Intelligence. 공개 등급 문서의 기본값으로 Upstage 또는 클로바 중 하나를 Phase 0 벤치마크로 확정
- 전처리: 회전 감지, 기울기 보정, 이진화, 해상도 300dpi 정규화
- 후처리: OCR 신뢰도를 블록에 저장, 신뢰도 낮은 블록은 리포트 근거로 사용 시 "OCR 신뢰도 낮음" 표시. 숫자(금액, 날짜)는 OCR 오인식 위험이 커 교차검증 권장 항목 판단에 반영
- 비용 통제: OCR은 페이지 단위 과금이므로 케이스당 예상 비용을 인입 시 표시

#### 3.4.5 파싱 진단 리포트

- 문서마다 parser, 버전, 경고 목록, 품질 점수, 누락 의심 구간(빈 페이지, 이미지만 있는 페이지)을 저장하고 화면에 표시
- 사용자가 "재처리" 버튼으로 다른 경로(상용 파서)로 재파싱 가능, 결과는 새 IR 버전으로 저장

### 3.5 멀티 AI 벤더 연동 설계

#### 3.5.1 벤더와 모델 개념 정리

- 벤더(vendor): API 제공 주체. OpenAI, Anthropic, Google, xAI, Groq, 내부(gcube 자체 서빙, Phase 3)
- 모델(model): 벤더가 제공하는 개별 모델 ID. 교차검증의 단위는 "모델 계열이 다른 벤더"이며 같은 벤더의 두 모델은 교차검증 참여 벤더로 인정하지 않음(같은 학습 계보의 편향 공유)
- Grok과 Groq 구분: Grok은 xAI의 모델, Groq는 오픈웨이트 모델(Llama, Qwen, gpt-oss 계열 등)을 고속 추론하는 호스팅 사업자. Groq는 저비용 보조 작업(섹션 분류, 개인정보 탐지, 1차 추출)과 교차검증의 "다른 계보" 참여자로 유용하나, 호스팅 모델의 컨텍스트 한도(대체로 128K~262K)가 프론티어 모델보다 작아 청크 실행 전략 필요
- 2026년 9월 초 기준 프론티어 라인업(설정 시 재확인): Anthropic Claude Fable 5.1과 Opus 5(1M 컨텍스트), OpenAI GPT-5.6 계열(약 1M 컨텍스트), Google Gemini 3.1 Pro와 3.x Flash(1M), xAI Grok 4.6(약 500K). 문서 200페이지는 한국어 기준 대략 15만에서 30만 토큰이므로 프론티어 모델은 전체 문맥 투입이 가능하나 비용과 중간 정보 손실 때문에 섹션 라우팅이 기본

#### 3.5.2 벤더 능력 프로필 (DB 관리)

- ai_models 테이블에 모델별로 저장하고 관리자 UI에서 편집: max_input_tokens, max_output_tokens, supports_json_schema(구조화 출력), supports_pdf_input, supports_image_input, supports_prompt_cache, price_input_per_1m, price_output_per_1m, price_cache_read_per_1m, avg_latency_ms(관측값 자동 갱신), tokens_per_sec(관측값), region, retention_policy(학습 미사용 여부, 기본 보존일, ZDR 가능 여부), allowed_doc_classes(허용 문서 등급), enabled
- 실행 계획은 이 프로필을 읽어 결정: 컨텍스트가 부족하면 청크 실행, 구조화 출력 미지원이면 JSON 복구 파서 적용, 파일 입력 지원 시 표 이미지 첨부 가능

#### 3.5.3 설정 계층

| 계층 | 설정 항목 | 편집 주체 |
|---|---|---|
| 조직 기본값 | 활성 벤더 목록, 기본 벤더와 모델, 교차검증 기본 참여 집합(2~4), 벤더 가중치, 폴백 순서, 월 예산 상한, 문서 등급별 허용 벤더, 교차검증 권장 임계값 | 관리자 |
| 사용자 설정 | 기본 벤더(조직 허용 범위 내), 교차검증 참여 집합, 교차검증 권장 알림 여부 | 사용자 |
| 건별 요청 | 이번 분석의 모드, 벤더, 항목 범위 | 사용자 (요청 시) |
- 우선순위: 건별 > 사용자 > 조직. 단 문서 등급별 허용 벤더와 월 예산 상한은 조직 설정이 항상 우선
- API 키: 조직 단위 저장. AES-256-GCM으로 암호화해 ai_vendor_credentials에 저장, 마스터 키는 환경 비밀(env)로만 보관 (env를 완전히 없앨 수 없는 유일한 항목). Supabase Vault 사용도 가능. 키 상태(정상, 실패, 만료)는 주기 점검으로 갱신. 사용자 개인 키 지원은 Phase 4에서 검토

#### 3.5.4 AI 게이트웨이 모듈

- LiteLLM SDK(라이브러리 모드)를 Python 워커 안에서 사용. 벤더별 SDK 차이를 흡수하고 비용 계산, 재시도, 타임아웃을 통일
- 게이트웨이 책임 7가지: 문서 등급 검사, 개인정보 마스킹과 복원, 토큰 산정, 호출과 재시도, 폴백, 비용과 지연 기록(llm_calls), 프롬프트 캐시 활용
- 구조화 출력: 모든 추출 태스크는 JSON Schema를 요구. 벤더가 스키마 강제를 지원하면 사용, 아니면 응답을 스키마 검증 후 실패 시 1회 재요청("스키마 위반, 수정하라")
- 프롬프트 캐시: 같은 벤더에 같은 문서 컨텍스트를 반복 투입할 때(항목별 교차검증, 재분석) 캐시 읽기 단가가 적용되도록 컨텍스트를 접두 블록으로 고정 배치. Anthropic의 명시적 캐시는 ZDR 예외 사항이므로 조건부 공개 문서에는 캐시 비활성

#### 3.5.5 폴백 규칙

- 장애 판정: HTTP 5xx, 타임아웃(항목별 기본 120초), 레이트 리밋 429가 지수 백오프 3회 후에도 지속, 인증 오류 401/403, 컨텍스트 초과 400
- 기본 모드: 조직 폴백 순서에서 문서 등급 허용 벤더 중 다음 벤더로 전환. 전환 시 리포트 메타에 "요청 벤더 A, 실제 수행 벤더 B, 사유" 기록, 리포트 상단 배너와 완료 알림에 표시, "원래 벤더로 재실행" 버튼 제공
- 교차검증 모드: 장애 벤더는 결과 없음으로 처리. 정상 벤더가 2곳 이상이면 진행하고 결과에 "참여 N곳 중 M곳 응답" 표시, 1곳 이하면 교차검증 실패로 종료하고 기본 결과만 유지, 재실행 제안
- 부분 장애: 항목 단위로 실패한 호출만 재시도, 문서 전체 재실행 금지
- 벤더 상태판: 최근 1시간 성공률과 평균 지연을 표시, 성공률 80% 미만 벤더는 기본 벤더 선택 시 경고

#### 3.5.6 교차검증 모드 설계

- 진입점 A (사전 선택): 분석 요청 화면에서 모드 선택 → 참여 벤더 확인(조직 기본값 표시, 사용자 조정) → 비용과 시간 예측 표시 → 확인 → 실행. 리포트 v1이 벤더별 결과와 합의값을 포함
- 진입점 B (사후 항목별): 리포트 화면에서 항목 카드마다 "교차검증" 버튼, 상단에 "전체 교차검증"과 "권장 항목 일괄 교차검증" 버튼. 권장 항목에는 배지와 사유 표시 → 선택 항목 요약, 비용과 시간 예측 → 확인 → 실행 → 리포트 v(n+1) 생성, 비교 뷰 자동 열림
- 검증 단위: 리포트 스키마의 말단 필드(예: budget.total_amount, budget.vat_included, schedule.duration_months, eligibility.requirements[i], anomalies[]). 사용자 선택 단위는 항목 그룹(사업 금액, 자격 요건 등)이며 내부적으로는 필드 단위로 실행
- 실행: 참여 벤더별로 동일 컨텍스트와 동일 스키마로 병렬 호출(asyncio), 벤더별 결과를 field_vendor_results에 저장. 기본 벤더 결과는 재사용(진입점 B)
- 일치 판정 알고리즘

| 필드 유형 | 정규화 | 일치 기준 |
|---|---|---|
| 금액 | 원 단위 정수, 부가세 포함 여부 별도 필드 | 정수 완전 일치, 부가세 포함 여부 일치 |
| 기간과 날짜 | 개월 수 정수 또는 ISO 날짜 | 완전 일치 |
| 열거형 (계약 방법, 낙찰 방법, 판정 등급) | 코드값 | 완전 일치 |
| 짧은 텍스트 (사업명, 기관명) | 공백과 기호 정규화 | 편집 거리 기반 유사도 0.9 이상 |
| 긴 텍스트 (개요 요약, 조항 해석) | 문장 임베딩 | 코사인 유사도 0.85 이상이면서 판정 모델(저비용)이 "동일 사실 진술"로 판정 |
| 목록 (체크리스트, 자격 요건, 이상 조항) | 항목별 엔티티 정렬(임베딩 + 근거 블록 겹침) | 정렬된 쌍마다 위 기준 적용, 정렬 실패 항목은 "단독 발견" |
- 근거 겹침 신호: 두 벤더가 같은 근거 블록을 인용하면 일치 판정 신뢰도 가산, 서로 다른 블록을 인용하며 값이 다르면 "원문 내 상충 기재" 의심으로 별도 표시 (이상 조항 유형 8과 연결)
- 합의 규칙: 벤더 가중치(기본 1.0, 관리자 조정)로 가중 투표. 동일값 클러스터(합집합 찾기)의 가중치 합 / 전체 가중치 = 합의율. 합의율 1.0 "일치", 0.5 초과 "다수 일치", 그 외 "불일치". 목록 항목은 "발견 벤더 수 / 참여 벤더 수"를 함께 표시
- 목록형 항목의 합집합 정책: 이상 조항과 자격 요건처럼 누락 손실이 큰 목록은 합집합을 유지하되 발견 벤더 수로 정렬, 단독 발견 항목은 "의심" 등급. 금액과 기간처럼 단일값 항목은 합의값 선정
- 불일치 처리: 리포트 표시값은 기본 벤더 값을 유지하고 "불일치" 배지, 클릭 시 벤더별 값과 근거 병기. 사용자가 최종값을 선택하면 field_resolutions에 기록하고 표시값 교체, 검증 상태 "사용자 확정". 해결 결과는 벤더 가중치 보정 데이터로 축적(어느 벤더가 맞았는지)
- 병합 방식 확정: 덮어쓰기 금지, 병기. 새 리포트 버전 = 이전 버전 복사 + 검증 층 갱신. 버전 간 diff 뷰 제공. 보고용 요약에는 합의값 또는 사용자 확정값만 노출하고 벤더별 값은 작업용에만 노출
- 비용과 시간 예측
  - 비용 = Σ(벤더별 (입력 토큰 × 입력 단가 + 예상 출력 토큰 × 출력 단가)), 캐시 적용 시 캐시 단가. 입력 토큰은 벤더별 count-tokens API(제공 벤더) 또는 최근 관측 비율로 산정
  - 시간 = 병렬 실행이므로 참여 벤더 중 최대 예상 지연(관측 평균 × 항목 수 / 동시성)
  - 화면 표시는 "약 2,100원, 약 3분(±30%)" 형태, 실행 후 실제값을 기록해 예측 정확도 보정
  - 월 예산 상한 초과 예상 시 차단하고 관리자 승인 요청
- 교차검증 권장 기준 (비용 대비 효과 관점)
  - 권장 점수 = 오판 손실 등급(항목별 고정: 사업 금액 3, 자격 요건 3, 이상 조항 3, 사업 기간 2, 산출물 범위 2, 개요 1) × 불확실성(0~1: 신뢰도 낮음, 근거 미확인, 원문 내 상충 기재, OCR 기반 근거, 규칙 검증 실패 중 해당 항목 수로 산출)
  - 권장 점수가 조직 임계값(기본 1.5) 이상이면 배지 표시. 임계값은 Phase 1 데이터로 조정
  - 시스템은 제안만, 실행은 사용자 결정. 사업 규모(배정예산)가 조직 설정 기준(예: 10억) 이상이면 모든 고손실 항목에 기본 권장

#### 3.5.7 기본 모드 정확도 보완 (교차검증 미선택 건의 방어선)

1. 근거 대조(grounding check): 추출 값마다 벤더가 인용한 원문 문자열을 IR 텍스트에서 검색. 공백과 기호를 정규화한 뒤 문자 유사도 0.9 이상 위치가 있으면 "근거 확인", 없으면 "근거 미확인"으로 신뢰도 0.5 이하 강등
2. 규칙 검증: 금액은 문서 전체에서 금액 패턴을 모두 수집해 추출값과 대조(추정가격, 배정예산, 기초금액, 부가세 문구 동반 여부), 기간은 착수와 완료 일자와 개월 수의 산술 정합성, 마감일은 공고일 대비 법정 최소 공고 기간, 요구사항 총괄표 개수와 리포트 산출물 개수 정합
3. 자기 검토 패스: 같은 벤더의 저비용 모델 또는 동일 모델에 "리포트와 근거를 대조해 오류 후보를 지적하라"는 검토자 프롬프트 1회 실행. 지적 항목은 신뢰도 하향과 권장 배지 근거로 사용 (비용은 본 분석의 10~20% 수준)
4. 나라장터 메타데이터 대조: rfp_sources의 배정예산, 추정가격, 개찰일, 계약 방법과 리포트 추출값이 다르면 "공고 메타데이터와 불일치" 경고
5. 원문 위치 대조 UI: 모든 값 옆의 근거 링크를 누르면 원문 뷰어가 해당 페이지와 블록을 하이라이트, 사용자가 5초 내 확인 가능한 구조
6. 사용자 수정 기록: 수정된 값은 field_resolutions에 남겨 벤더 품질 통계와 프롬프트 개선에 사용

### 3.6 리포트 생성 설계

#### 3.6.1 리포트 스키마 (요약)

```
report (v1.0 스키마, report_schemas 테이블에 버전 관리)
  overview: {title, agency, demand_agency, purpose, background, summary(3문장), project_type, classification_codes[]}
  scope: {deliverables[{name, description, quantity, evidence[]}], work_items[], out_of_scope[], requirement_summary{total, by_category{}}}
  schedule: {start, end, duration_months, milestones[], proposal_deadline, bid_open_date, qna_deadline, briefing_date}
  budget: {total_amount, currency, vat_included, budget_basis(배정예산|추정가격|기초금액), payment_terms, price_score_method, mentions[{amount, context, evidence}]}
  constraints: {technical[], personnel[], eligibility[], legal[], security[], location[], subcontracting}
  checklist: {documents[{name, required, form_ref, evidence}], eligibility_checks[{requirement, satisfied(yes|no|unknown), profile_basis}], preparation[]}
  evaluation: {method, technical_weight, price_weight, criteria[{name, points, evidence}], presentation_required}
  anomalies: [{id, category, severity, grade(확정|의심), title, rationale, evidence[], rule_id?, found_by[]}]
  fit: {verdict(전체 수행|부분 참여|부적합), score, hard_constraint_results[], strengths[], gaps[], recommended_role, consortium_suggestion}
  comparisons: [{case_id, similarity, diff_summary}]
  meta: {analysis_mode, base_vendor, cross_vendors[], fallback_applied, cost, duration, parser_quality, generated_at, ai_notice}
각 값 노드 공통 속성: value, evidence[{document_file_id, block_id, page_no, quote}], confidence, grounding(확인|미확인), vendor, verification(단일|일치|다수일치|불일치|사용자확정)
```

#### 3.6.2 추출 태스크 분해와 섹션 라우팅

- 리포트를 태스크 9개로 분해: 개요, 범위와 산출물, 일정, 예산, 제약과 자격, 제출 서류, 평가 기준, 이상 조항 후보, 요구사항 정규화
- 태스크별 컨텍스트 조립: 표준 목차 분류 결과에서 관련 카테고리 섹션을 우선 투입(예: 예산 태스크는 예산과 대가 지급, 입찰 안내, 사업 개요), 관련 섹션 합계가 벤더 컨텍스트의 60%를 넘으면 청크 분할 실행 후 병합
- 전체 문맥 보조 패스: 섹션 라우팅으로 값을 찾지 못한 필드에 한해 문서 전체(또는 상위 요약)로 1회 재질의
- 프롬프트 공통 규칙: 원문에 없는 내용 생성 금지, 각 값에 인용 문자열(원문 그대로 40자 이상)과 블록 ID 필수, 확신 없으면 null과 사유, 금액은 숫자와 단위 분리, 날짜는 ISO
- 태스크 출력은 JSON Schema로 강제, 스키마 파일은 저장소에 버전 관리하고 report_schemas에도 등록

#### 3.6.3 리포트 화면 구성

- 상단: 케이스 요약 카드(기관, 예산, 기간, 마감 D-day, 적합도 판정, 파싱 품질, 분석 모드와 벤더, AI 생성 고지)
- 본문: 항목 카드 9개 + 이상 조항 하이라이트 섹션 + 적합도 상세 + 유사 사업 비교
- 각 카드: 값, 근거 링크, 신뢰도 표시, 검증 배지, 교차검증 버튼, 수정 버튼
- 우측: 원문 뷰어(페이지 렌더링 + 하이라이트), 근거 클릭 시 이동
- 보기 전환: 작업용(전체) / 보고용(요약, 근거와 이력 제외) / 버전 비교

### 3.7 데이터 모델과 DB 스키마

#### 3.7.1 설계 방침

- Postgres 스키마 rfp, 모든 업무 테이블에 org_id와 RLS
- 원본 파일은 Storage, DB에는 경로와 해시만
- 리포트는 report_versions에 JSON 원본을 불변 저장하고, 검색과 필터에 필요한 필드만 report_fields와 정규화 컬럼으로 복제
- 분석 모드와 벤더별 결과를 구분 저장: analysis_runs.mode, field_vendor_results.vendor_id

#### 3.7.2 핵심 테이블 DDL (Prisma 스키마로 변환 전제, 타입은 Postgres 기준)

```sql
-- 조직과 사용자
create table rfp.organizations (id uuid primary key, name text not null, plan text default 'internal', settings jsonb default '{}', created_at timestamptz default now());
create table rfp.users (id uuid primary key, org_id uuid references rfp.organizations, external_id text, email text, name text, role text check (role in ('admin','member','viewer')), created_at timestamptz default now());

-- 회사 프로필 (버전 관리)
create table rfp.company_profiles (id uuid primary key, org_id uuid not null, version int not null, status text check (status in ('draft','active','archived')), basic jsonb not null, -- 업종, 규모, 자본금, 매출, 인력, 지역
  created_by uuid, created_at timestamptz default now(), unique (org_id, version));
create table rfp.profile_certifications (id uuid primary key, profile_id uuid references rfp.company_profiles, kind text, name text, issuer text, valid_until date, evidence_file_id uuid);
create table rfp.profile_track_records (id uuid primary key, profile_id uuid references rfp.company_profiles, project_name text, client text, amount bigint, start_date date, end_date date, domain_tags text[], role text, evidence_file_id uuid, embedding vector(1024));
create table rfp.profile_capabilities (id uuid primary key, profile_id uuid references rfp.company_profiles, tag text, level int check (level between 1 and 5), description text, embedding vector(1024));
create table rfp.profile_partners (id uuid primary key, profile_id uuid references rfp.company_profiles, partner_name text, capabilities text[], note text);

-- AI 벤더 설정
create table rfp.ai_vendors (id text primary key, name text, litellm_provider text, retention_policy jsonb, enabled boolean default true);
create table rfp.ai_models (id uuid primary key, vendor_id text references rfp.ai_vendors, model_id text not null, display_name text, max_input_tokens int, max_output_tokens int, supports_json_schema boolean, supports_pdf_input boolean, supports_image_input boolean, supports_prompt_cache boolean, price_input_per_1m numeric, price_output_per_1m numeric, price_cache_read_per_1m numeric, avg_latency_ms int, region text, allowed_doc_classes text[] default '{public}', enabled boolean default true, deprecated_at date, unique (vendor_id, model_id));
create table rfp.ai_vendor_credentials (id uuid primary key, org_id uuid not null, vendor_id text references rfp.ai_vendors, encrypted_key bytea not null, key_iv bytea not null, status text default 'unknown', last_checked_at timestamptz, created_by uuid);
create table rfp.ai_settings (id uuid primary key, org_id uuid not null, scope text check (scope in ('org','user')), user_id uuid, base_model_id uuid references rfp.ai_models, cross_model_ids uuid[], vendor_weights jsonb default '{}', fallback_order uuid[], monthly_budget_krw bigint, recommend_threshold numeric default 1.5, big_project_krw bigint default 1000000000, unique (org_id, scope, user_id));

-- 케이스와 문서
create table rfp.rfp_sources (id uuid primary key, org_id uuid not null, source_system text check (source_system in ('g2b','nuri','agency','manual')), notice_no text, notice_round int, title text, announcing_agency text, demand_agency text, budget_amount bigint, estimated_price bigint, base_price bigint, notice_date date, bid_open_at timestamptz, contract_method text, award_method text, is_it_project boolean, is_urgent boolean, raw jsonb, fetched_at timestamptz, unique (org_id, source_system, notice_no, notice_round));
create table rfp.rfp_cases (id uuid primary key, org_id uuid not null, source_id uuid references rfp.rfp_sources, title text not null, doc_class text not null check (doc_class in ('public','restricted','nda')), status text not null, sector text, project_type text, budget_amount bigint, duration_months int, proposal_deadline timestamptz, supersedes_case_id uuid, created_by uuid, created_at timestamptz default now(), updated_at timestamptz);
create table rfp.document_files (id uuid primary key, case_id uuid references rfp.rfp_cases, org_id uuid not null, role text, original_name text, storage_path text, mime text, format text, size_bytes bigint, sha256 text, page_count int, is_drm boolean default false, uploaded_by uuid, created_at timestamptz default now());
create table rfp.document_ir (id uuid primary key, file_id uuid references rfp.document_files, version int, parser text, parser_version text, quality_score int, warnings jsonb, ir_storage_path text, created_at timestamptz default now(), unique (file_id, version));
create table rfp.doc_sections (id uuid primary key, ir_id uuid references rfp.document_ir, org_id uuid not null, section_key text, level int, title text, number text, parent_id uuid, category text, page_start int, page_end int, order_no int);
create table rfp.doc_blocks (id uuid primary key, ir_id uuid references rfp.document_ir, org_id uuid not null, block_key text, section_id uuid references rfp.doc_sections, type text, text text, html text, page_no int, bbox real[], source_ref jsonb, order_no int, text_hash text, ocr_confidence real);
create table rfp.block_chunks (id uuid primary key, org_id uuid not null, case_id uuid, file_id uuid, block_ids uuid[], text text, tsv tsvector, embedding vector(1024), embedding_model text, created_at timestamptz default now());
create index on rfp.block_chunks using hnsw (embedding vector_cosine_ops);
create table rfp.requirements (id uuid primary key, case_id uuid, org_id uuid not null, req_code text, category text, title text, description text, priority text, evidence_block_ids uuid[], embedding vector(1024));

-- 작업 큐와 실행 기록
create table rfp.analysis_jobs (id uuid primary key, org_id uuid not null, case_id uuid, job_type text, payload jsonb, priority int default 5, status text default 'queued', attempts int default 0, locked_by text, locked_at timestamptz, progress jsonb, error text, created_at timestamptz default now(), finished_at timestamptz);
create index on rfp.analysis_jobs (status, priority, created_at);
create table rfp.analysis_runs (id uuid primary key, org_id uuid not null, case_id uuid, job_id uuid, mode text check (mode in ('base','cross_pre','cross_post')), base_model_id uuid, cross_model_ids uuid[], target_fields text[], requested_by uuid, fallback_applied jsonb, cost_krw numeric, duration_ms int, status text, started_at timestamptz, finished_at timestamptz);
create table rfp.llm_calls (id uuid primary key, run_id uuid references rfp.analysis_runs, org_id uuid not null, model_id uuid, purpose text, input_tokens int, output_tokens int, cache_read_tokens int, cost_krw numeric, latency_ms int, status text, error text, request_hash text, redaction_applied boolean, doc_class text, created_at timestamptz default now());

-- 리포트
create table rfp.report_schemas (id uuid primary key, version text unique, json_schema jsonb, field_defs jsonb, active boolean);
create table rfp.report_versions (id uuid primary key, case_id uuid, org_id uuid not null, version int, schema_version text, run_id uuid, report jsonb not null, summary jsonb, created_at timestamptz default now(), unique (case_id, version));
create table rfp.report_fields (id uuid primary key, report_version_id uuid references rfp.report_versions, org_id uuid not null, field_path text, value jsonb, value_num numeric, value_text text, confidence real, grounding text, verification text, display_vendor_id text, evidence jsonb);
create index on rfp.report_fields (org_id, field_path, value_num);
create table rfp.field_vendor_results (id uuid primary key, report_version_id uuid, org_id uuid not null, field_path text, model_id uuid, value jsonb, evidence jsonb, confidence real, grounding text, agreed boolean, cluster_id int, created_at timestamptz default now());
create table rfp.field_resolutions (id uuid primary key, case_id uuid, org_id uuid not null, field_path text, resolved_value jsonb, source text check (source in ('user','consensus')), chosen_model_id uuid, resolved_by uuid, note text, created_at timestamptz default now());

-- 이상 조항
create table rfp.anomaly_rules (id text primary key, org_id uuid, category text, name text, description text, rule_type text check (rule_type in ('regex','numeric','stat','llm')), definition jsonb, severity_default text, enabled boolean default true, updated_at timestamptz);
create table rfp.anomalies (id uuid primary key, case_id uuid, org_id uuid not null, report_version_id uuid, category text, severity text, grade text check (grade in ('confirmed','suspect','dismissed')), title text, rationale text, evidence jsonb, rule_id text, found_by_model_ids uuid[], user_status text, reviewed_by uuid, created_at timestamptz default now());

-- 적합도와 비교와 결과
create table rfp.fit_assessments (id uuid primary key, case_id uuid, org_id uuid not null, profile_id uuid, report_version_id uuid, verdict text, score real, hard_constraints jsonb, soft_scores jsonb, gaps jsonb, rationale text, model_id uuid, created_at timestamptz default now());
create table rfp.rfp_comparisons (id uuid primary key, case_id uuid, similar_case_id uuid, org_id uuid not null, similarity real, structured_diff jsonb, ai_summary jsonb, created_at timestamptz default now());
create table rfp.outcomes (id uuid primary key, case_id uuid unique, org_id uuid not null, decision text check (decision in ('go','partial','no_go','undecided')), decision_reason text, submitted boolean, result text, awarded_to text, awarded_amount bigint, our_rank int, source text, recorded_by uuid, recorded_at timestamptz);

-- 어시스턴트와 감사
create table rfp.assistant_threads (id uuid primary key, org_id uuid not null, user_id uuid, case_id uuid, title text, created_at timestamptz default now());
create table rfp.assistant_messages (id uuid primary key, thread_id uuid, role text, content text, citations jsonb, model_id uuid, tokens int, created_at timestamptz default now());
create table rfp.audit_logs (id bigserial primary key, org_id uuid not null, user_id uuid, action text, target_type text, target_id uuid, detail jsonb, created_at timestamptz default now());
create table rfp.external_transfers (id bigserial primary key, org_id uuid not null, case_id uuid, file_id uuid, vendor_id text, model_id uuid, purpose text, doc_class text, token_count int, redaction_applied boolean, created_at timestamptz default now());
```

#### 3.7.3 저장 규칙

- 모드 구분: analysis_runs.mode가 base, cross_pre(사전 선택), cross_post(사후 항목별)를 구분. cross_post의 target_fields에 대상 필드 경로 저장
- 벤더별 결과 구분: field_vendor_results에 (report_version_id, field_path, model_id) 단위로 저장. 기본 모드 결과도 같은 테이블에 model_id와 함께 저장해 이후 교차검증 시 재사용
- 리포트 표시값: report_fields가 화면 표시의 단일 출처. verification과 display_vendor_id로 어느 벤더 값이 표시되는지 명시
- 버전 정책: 기본 분석 완료 v1, 교차검증마다 +1, 사용자 확정은 필드 단위 field_resolutions 기록 후 리포트 버전 +1 (일괄 확정 시 한 번)
- 삭제 정책: 케이스 삭제 시 파일과 IR, 청크, 리포트 모두 소프트 삭제 후 30일 뒤 물리 삭제. 감사 로그와 external_transfers는 보존

#### 3.7.4 RLS 정책 요약

- 모든 테이블: org_id = 현재 사용자 org (JWT 클레임 또는 세션 컨텍스트)
- viewer는 읽기만, member는 케이스 생성과 분석 요청, admin은 설정과 규칙과 삭제
- Python 워커는 service role로 접속하되 org_id를 명시적으로 필터링하는 저장소 레이어를 통해서만 접근

### 3.8 이상 및 특이 조항 탐지 로직 설계

#### 3.8.1 세 층 혼합 구조

```
규칙 층 (결정적, 정밀도 우선)  ──┐
통계 층 (축적 DB 대비 희귀도)    ──┼─▶ 후보 병합 → 등급 부여 → 근거 검증 → 하이라이트 섹션
AI 층 (맥락 판단, 재현율 우선)   ──┘
```

#### 3.8.2 규칙 층 (anomaly_rules, rule_type regex/numeric)

- 규칙은 DB에 저장하고 관리자 UI에서 편집, 규칙 ID로 anomalies에 연결
- 초기 규칙 세트 (12개, 구현 시 법령 확인 후 수치 확정)

| 규칙 ID | 유형 | 내용 | 산출 |
|---|---|---|---|
| R01 특정 상표 명시 | regex + 사전 | 제품명, 브랜드명, 모델명(사전 유지: 상용 SW, 하드웨어, 클라우드 서비스명) 언급이 있으면서 같은 문장 또는 인접 문장에 "동등 이상", "또는 동등", "이상의 성능" 문구가 없는 경우 | 확정 후보 (근거 문장) |
| R02 고유 규격 수치 | regex | 특정 제품에서만 나오는 수치 조합(예: 특정 GPU 메모리 용량과 인터커넥트 규격을 정확히 일치 요구) | 의심 |
| R03 법정 공고 기간 | numeric | 공고일과 제안서 제출 마감일 간격이 계약 방법별 법정 최소 기간(국가계약법령의 입찰공고 시기 규정, 긴급공고 특례 포함) 미만 | 확정 (근거: 두 날짜) |
| R04 실적 요건 과다 | numeric | 유사 실적 요구 건수 또는 금액이 사업 규모 대비 조직 설정 배수(기본 예산의 100% 초과 단일 실적, 3건 초과) 이상 | 의심 |
| R05 자본금과 매출 요건 | numeric | 요구 자본금 또는 매출이 배정예산의 배수 기준 초과 | 의심 |
| R06 인력 요건 대비 예산 | numeric | 요구 투입 인력(등급별 인원 × 개월)에 SW 노임단가(KOSA 공표 기준, 관리자가 연도별 입력)를 곱한 추정 인건비가 예산의 조직 설정 비율(기본 110%) 초과 | 확정 후보 (계산 근거 표시) |
| R07 기간 대비 산출물 | numeric | 요구사항 총괄표 건수 또는 산출물 수를 사업 개월 수로 나눈 값이 축적 DB 중앙값의 2배 초과 (DB 없으면 고정 임계값) | 의심 |
| R08 지식재산권 귀속 | regex | 산출물 저작권 전부 발주기관 귀속, 소스코드 무상 제공, 향후 무상 유지보수, 무제한 수정 요구 등 문구 | 의심 (SW 사업 계약 지침의 권리 귀속 원칙과 대조) |
| R09 손해배상과 지체상금 | regex + numeric | 지체상금률과 계약보증금률이 표준 계약 조건 기준을 초과, 무한 책임 문구 | 의심 |
| R10 상충 기재 | numeric | 금액, 기간, 마감일이 문서 내 또는 첨부 간에 서로 다른 값 | 확정 (근거: 상충 위치 모두) |
| R11 특정 인증 요구 | 사전 | 특정 인증(예: 특정 클라우드 인증, 특정 벤더 파트너 등급)을 참가 자격으로 요구 | 의심 |
| R12 하도급과 공동수급 제한 | regex | 공동수급 금지, 하도급 전면 금지, 특정 지역 업체 의무 비율 과다 | 의심 |

#### 3.8.3 통계 층 (rule_type stat, Phase 2)

- 축적 DB의 유사 사업(같은 사업 분류, 예산 구간 ±50%) 분포 대비 이 문서의 값이 얼마나 벗어나는지 계산
- 지표: 예산 대비 기간, 예산 대비 요구사항 수, 자격 요건별 출현 빈도(희귀 요건 = 유사 사업 중 5% 미만 출현), 평가 배점 구조(가격 점수 비중 이례적)
- 결과는 z-score 또는 백분위와 함께 "유사 사업 N건 중 M건에서만 관찰"로 표시. 표본이 20건 미만이면 통계 층 비활성

#### 3.8.4 AI 층 (rule_type llm)

- 입력: 탐지 유형 8종 정의와 각 유형의 예시 3개(퓨샷), 관련 섹션(제약 사항, 참가 자격, 요구사항, 계약 조건, 특수조건)
- 출력 스키마: [{category, title, rationale, quote(원문 인용), block_ids, severity, confidence}]
- 프롬프트 지침: 원문 인용 없는 항목 금지, 통상 관행 대비 무엇이 다른지 한 문장으로 설명, 확실하지 않으면 confidence 낮게
- 근거 대조 통과 항목만 후보로 인정
- 교차검증 모드에서는 벤더별 후보를 정렬 병합해 발견 벤더 수 표시 (3.5.6절)

#### 3.8.5 병합과 등급

- 같은 근거 블록을 인용하거나 제목 유사도가 높은 후보를 하나로 병합, 출처(rule_id, model_ids)를 모두 보존
- 등급: 규칙 층 "확정" 산출 → 확정, 규칙 층 "의심"과 AI 층이 함께 발견 → 확정에 준함(표시는 "규칙과 AI 동시 탐지"), AI 층 단독 → 의심, 통계 층 단독 → 참고
- 심각도: 참여 불가 수준(자격 미충족 유발), 수익성 위협(예산과 기간), 계약 리스크(권리와 책임), 경쟁 제한 의심(특정 업체 유리)의 4단계
- 사용자 처리: 확인, 기각(사유 입력), 메모. 기각 데이터는 규칙 임계값 조정에 사용
- "특정 업체에 유리" 판단은 리포트 안에서 "경쟁 제한 의심"으로만 표기하고 특정 업체명을 단정하는 문장은 생성하지 않음 (명예훼손과 허위사실 리스크). Phase 3에서 나라장터 낙찰 데이터로 같은 유형의 조항이 있던 과거 사업의 낙찰 업체 반복 여부를 통계로 제시하는 것까지만

### 3.9 AI 어시스턴트 검색 기능 설계

#### 3.9.1 검색 대상과 계층

- 계층 1 구조화 데이터: rfp_cases, rfp_sources, report_fields, fit_assessments, anomalies, outcomes (SQL 필터)
- 계층 2 의미 검색: block_chunks(원문), requirements, 리포트 요약 임베딩 (pgvector)
- 계층 3 키워드 검색: block_chunks.tsv (pgroonga 또는 pg_trgm)
- 모든 계층에 org_id 필터가 강제되며 RLS와 이중 적용

#### 3.9.2 질의 처리 흐름

1. 의도 분류(저비용 모델): 구조화 조건 검색, 의미 검색, 특정 문서 내 질의, 비교 요청, 일반 대화 중 하나 또는 조합
2. 구조화 조건 추출: 기간("최근 1년"), 예산 구간, 기관 유형, 사업 분류, 판정 결과를 JSON으로 추출 → 허용 컬럼만 사용하는 파라미터화 쿼리 빌더로 SQL 생성 (자유 형식 text-to-SQL 금지, 읽기 전용 뷰 rfp.v_case_search만 조회)
3. 후보 검색: 구조화 필터로 케이스 집합을 좁힌 뒤 의미 검색(상위 30)과 키워드 검색(상위 30)을 RRF(Reciprocal Rank Fusion)로 결합 → 재순위(크로스 인코더 리랭커, 상용 리랭크 API 또는 자체 서빙) → 상위 8~12 청크
4. 답변 생성: 청크와 케이스 메타를 컨텍스트로 투입, 인용 태그 필수([케이스명, 파일 역할, 페이지, 블록]) 규칙, 근거 없는 진술은 "추정" 접두
5. 인용 검증: 답변의 인용 태그가 실제 컨텍스트 청크와 매칭되는지 확인, 매칭 실패 인용은 제거하고 사용자에게 표시
6. 스트리밍: FastAPI SSE → Next.js 프록시 → 화면. 인용 클릭 시 원문 뷰어 이동

#### 3.9.3 예시 질의별 경로

| 질의 | 경로 |
|---|---|
| "최근 6개월 예산 5억 이상 유사 규모 RFP" | 구조화(기간, 예산) + 의미(현재 케이스 개요와 유사) |
| "이 조항과 비슷한 과거 사례" | 의미 검색(선택 블록 임베딩) + 키워드 |
| "우리가 부적합 판정받은 이유 유형별 정리" | 구조화(verdict) + fit_assessments.gaps 집계 |
| "이 RFP에서 보안 요구사항만 뽑아줘" | 특정 문서 내 질의, 섹션 카테고리 필터 |

#### 3.9.4 어시스턴트의 벤더 정책

- 어시스턴트 호출도 게이트웨이를 경유, 조직 기본 벤더 사용. 컨텍스트에 조건부 공개 또는 NDA 문서 청크가 포함되면 해당 등급 허용 벤더로 자동 전환, 불가하면 해당 청크 제외하고 고지

### 3.10 회사 프로필 설정과 적합도 판단 로직 설계

#### 3.10.1 프로필 스키마

- basic: 회사명, 사업자 유형, 업종 코드, 설립일, 자본금, 최근 3년 매출, 상시 인력(등급별 SW 기술자 수), 소재지, 중소기업 여부, 여성기업 등 가점 요소
- certifications: 소프트웨어사업자 신고, 정보통신공사업, 직접생산확인, ISO 27001, ISMS, CSAP, GS인증, 벤처기업, 이노비즈 등 (유효기간 포함)
- track_records: 사업명, 발주처, 금액, 기간, 역할(주관, 참여, 하도급), 도메인 태그, 증빙 파일
- capabilities: 역량 태그(예: GPU 클라우드, 분산 학습 인프라, LLM 서빙, 데이터 구축, 공공 SI, DID)와 수준 1~5, 보유 제품(gcube, gcube EDGE, MACC 등)
- partners: 컨소시엄 가능 파트너와 그들의 역량 태그(적합도 판정에서 "부분 참여" 조합 제안에 사용)
- preferences: 선호 사업 규모 범위, 지역, 참여 형태, 리스크 허용 수준

#### 3.10.2 입력 최소화 (자동 초안)

- 회사소개서, 사업자등록증, 실적증명서, 인증서 PDF를 업로드하면 파싱과 추출 파이프라인을 그대로 재사용해 프로필 초안 생성, 사용자는 확인과 수정만
- 나라장터 업체 정보(사용자정보서비스 API)로 기본 정보 보완 가능 여부를 구현 시 확인
- 프로필은 버전 관리, 적합도 판정은 사용한 프로필 버전을 기록

#### 3.10.3 적합도 판단 2단계

- 1단계 하드 제약 (결정적): 리포트 constraints.eligibility와 checklist.eligibility_checks의 각 요건을 프로필 항목에 매핑(요건 유형 사전: 사업자 신고, 실적 건수와 금액, 자본금, 인증, 지역, 인력 등급별 인원). 결과는 요건별 충족, 미충족, 확인 불가. 하나라도 미충족이면 단독 수행 불가 → 부분 참여 또는 부적합 후보. 매핑되지 않는 요건은 AI가 판정하되 "확인 불가"로 남기고 사용자 확인 요청
- 2단계 소프트 점수 (0~100): 역량 적합(요구사항 임베딩과 역량 태그 매칭, 가중 40), 실적 유사도(track_records 임베딩과 사업 개요 유사도, 가중 25), 규모 적정성(예산과 기간이 선호 범위와 과거 수행 규모 분포 안에 있는지, 가중 15), 리스크(이상 조항 심각도 합, 가중 -20), 경쟁 환경(Phase 3, 유사 사업 낙찰 이력, 가중 10)
- 판정 규칙: 하드 제약 전부 충족이면서 점수 70 이상 → 전체 수행 가능. 하드 제약 미충족이 있으나 미충족 요건을 파트너 역량으로 채울 수 있고 점수 50 이상 → 부분 참여 적합(권장 역할과 파트너 후보 제시). 그 외 → 부적합. 확인 불가 요건이 있으면 판정에 "조건부" 꼬리표
- 출력: verdict, score, 요건별 결과표, strengths, gaps(무엇을 채우면 판정이 바뀌는지), recommended_role, consortium_suggestion
- AI 역할: 요건 매핑이 안 되는 자연어 요건 해석, 근거와 함께 gaps 서술. 점수 계산 자체는 코드로 수행해 재현성 확보

#### 3.10.4 화면

- 판정 카드: 판정, 점수, 하드 제약 요약(충족 n / 미충족 m / 확인 불가 k)
- 요건 표: 요건 원문(근거 링크), 매핑된 프로필 항목, 결과, 사용자 수정
- 갭 목록: 요건, 필요 조치, 파트너 후보

#### 3.10.5 정확도 개선 구조 (확장, Phase 3)

- outcomes에 참여 결정과 결과(제출 여부, 순위, 낙찰 여부, 낙찰 업체와 금액: 나라장터 낙찰정보 API로 자동 채움)를 축적
- 표본 50건 이상 시 소프트 점수 가중치를 로지스틱 회귀로 보정(입력: 항목별 점수, 출력: 실제 참여 결정 또는 수주 여부). 보정 전후 판정 일치율을 비교해 채택 여부 결정
- 사용자 수정 이력(요건 매핑 정정)은 매핑 사전을 갱신하는 데 사용

### 3.11 기술 스택 제안과 근거

| 영역 | 선택 | 근거 |
|---|---|---|
| 웹 앱 | Next.js 15, TypeScript, Tailwind CSS, shadcn/ui | docore 표준 스택, 디자인 시스템 preset 상속 |
| 인증 | NextAuth v5 + SSO 어댑터 | 사내 배포는 내부 시스템 세션 위임, 독립 배포 시 교체 |
| DB | Supabase Postgres + Prisma, 확장 pgvector, pgroonga(가능 시) 또는 pg_trgm | 표준 스택, 벡터와 전문 검색을 한 DB에서 처리 |
| 파일 저장 | Supabase Storage (서버 측 암호화, 서명 URL) | 표준 스택 |
| 캐시와 제한 | Upstash Redis | 표준 스택, 레이트 리밋과 토큰 수 캐시 |
| 작업 큐 | Postgres 테이블 + SKIP LOCKED 폴링 | 추가 인프라 없이 신뢰성 확보, 규모 커지면 QStash 또는 별도 큐로 교체 |
| 문서 워커 | Python 3.12, FastAPI, asyncio 워커 | 파서와 OCR 생태계 |
| HWP/HWPX | rhwp-python (MIT), 보조 hwpxkit | 3.4.2절 |
| PDF | pypdfium2, pdfplumber, Docling(MIT) | AGPL 회피, 레이아웃과 출처 좌표 |
| OCR | PaddleOCR(자체) + 상용 API(Upstage 또는 클로바) 병행 | 문서 등급별 정책 |
| LLM 연동 | LiteLLM SDK | 표준 스택, 5개 벤더와 내부 vLLM 엔드포인트 동일 인터페이스 |
| 구조화 출력 검증 | pydantic + jsonschema | 스키마 강제 |
| 임베딩 | 조직 설정으로 1종 고정 (후보 3.3.4절) | 재임베딩 비용 고려 |
| 리랭커 | 상용 리랭크 API 또는 자체 서빙 bge-reranker 계열 | Phase 2 |
| 내부 모델 (Phase 3) | gcube GPU 위 vLLM, 오픈웨이트 모델(한국어 성능 우수 모델을 벤치마크로 선정) | 민감 문서 처리, 사내 자산 활용 |
| 관측 | OpenTelemetry + 로그 수집, llm_calls 기반 비용 대시보드 | 비용과 품질 추적 |
| 배포 | Vercel(web) + Docker(worker, gcube VM 또는 컨테이너 호스팅) | 3.2.4절 |
| 개발 루프 | domangcha 경량 루프, 플랜 문서 기반, v0.0.0 시맨틱 버전과 동일 버전 커밋 메시지 | docore 규약 |

- 모델 ID와 가격은 코드가 아닌 ai_models 테이블에 저장. 초기 시드 데이터는 부록 B 기준으로 넣고 관리자 UI에서 갱신

### 3.12 운영, 비용, 관측

#### 3.12.1 비용 구조 (기본 모드, 200페이지 문서 1건 기준 추정)

- 토큰: 한국어 200페이지 원문 약 20만 자, 벤더 토크나이저에 따라 15만~30만 토큰. 섹션 라우팅으로 태스크 9개에 투입되는 합계는 원문의 1.5~2배(중복 투입 포함), 전체 문맥 보조 패스 1회
- 프론티어 모델 기준 입력 100만 토큰당 2~5달러 수준 가정 시 기본 모드 1건 1~3달러 내외, 자기 검토 패스 포함 시 +15%. 저비용 모델(Flash 또는 Groq 호스팅)을 섹션 분류와 개인정보 탐지에 쓰면 그 부분은 무시할 수준
- 교차검증은 참여 벤더 수 배수, 항목별 실행 시 해당 항목 컨텍스트만 투입되므로 전체 대비 20~40%
- OCR: 상용 API 페이지당 과금, 스캔 200페이지면 별도 수천 원에서 수만 원 (벤더별 상이)
- 관리자 대시보드: 월 누적 비용, 벤더별 비용과 성공률, 건당 평균 비용, 예산 대비 소진율

#### 3.12.2 성능 목표

- 파싱과 구조화: 200페이지 HWP 2분 이내, 스캔 PDF는 OCR 처리량에 따라 5~15분
- 기본 모드 리포트: 10~15분 이내 (태스크 병렬 실행, 벤더 동시성 4)
- 교차검증 항목별: 3~5분
- 어시스턴트 첫 토큰: 3초 이내

#### 3.12.3 품질 관측

- 골든 세트: 라벨링된 RFP 20건(Phase 1) → 50건(Phase 2)에 대해 리포트 필드 정답, 이상 조항 정답, 판정 정답을 유지하고 프롬프트나 모델 변경 시 회귀 평가 실행
- 지표 자동 집계: 근거 확인율, 수정률, 교차검증 불일치율, 벤더별 정답률(사용자 확정 대비)
- 프롬프트 버전 관리: 프롬프트 파일을 저장소에서 버전 관리하고 llm_calls에 프롬프트 버전 기록

### 3.13 보안 및 데이터 처리 방침

#### 3.13.1 문서 등급 정책 매트릭스

| 항목 | 공개 | 조건부 공개 | 민간 NDA |
|---|---|---|---|
| 외부 벤더 전송 | 허용 (승인 벤더) | 학습 미사용이면서 ZDR 계약 또는 미보존 정책 벤더만 | 기본 차단, 관리자 예외 승인 시 ZDR 벤더만 |
| 교차검증 | 허용 | 허용 벤더 집합 내에서만 | 내부 모델 간 또는 차단 |
| 상용 파서와 OCR | 허용 | 계약 조건 확인 후 허용 | 차단, 자체 처리만 |
| 프롬프트 캐시 | 허용 | 비활성 | 비활성 |
| 개인정보 마스킹 | 필수 | 필수 | 필수 |
| 보존 | 케이스 삭제 시까지 | 케이스 삭제 시까지, 원본은 90일 후 자동 삭제 옵션 | 원본 30일 후 자동 삭제 기본 |
| 감사 로그 | 전송 로그 | 전송 로그 + 승인자 기록 | 전송 로그 + 승인자 + 사유 |

#### 3.13.2 개인정보 마스킹

- 대상: 성명(담당자 표기 패턴), 전화번호, 이메일, 주민등록번호와 사업자등록번호(발주기관 것은 유지 가능), 계좌번호, 주소 상세
- 방식: 정규식 1차 + 한국어 개체명 인식 2차(자체 모델 또는 저비용 모델 호출은 마스킹 대상 텍스트 자체를 외부로 보내는 모순이 있으므로 자체 처리 원칙). 치환 토큰(PERSON_1, PHONE_1)과 매핑은 실행 메모리에만 두고 응답 복원 후 폐기
- 리포트 표시: 담당자 정보는 원문 링크로만 접근, 리포트 본문에는 부서와 직위까지만

#### 3.13.3 저장과 접근 통제

- 저장 시 암호화(Storage 서버 측 암호화), 전송 시 TLS, API 키 필드 암호화(AES-256-GCM)
- Storage 접근은 짧은 만료의 서명 URL, 직접 공개 URL 금지
- RLS와 역할 기반 권한, 관리자 작업(설정 변경, 삭제, 예외 승인)은 감사 로그 필수
- 워커는 원본 파일을 처리 중에만 임시 디렉토리에 두고 완료 즉시 삭제

#### 3.13.4 외부 전송 통제

- 게이트웨이 외 경로로 외부 API 호출 금지(코드 리뷰 규칙, 아웃바운드 허용 목록)
- external_transfers에 건별 기록: 무엇을(파일, 청크 범위), 어디로(벤더, 모델, 리전), 얼마나(토큰), 마스킹 여부
- 관리자 화면에서 케이스별 "이 문서가 전송된 벤더 목록" 조회 가능
- 벤더 계정 설정 시 유료 티어 확인 절차(Gemini 무료 키 차단: 프로젝트 빌링 연결 확인), ZDR 계약 여부를 ai_vendors.retention_policy에 기록하고 정책 매트릭스와 연동

#### 3.13.5 법적 대응 체크리스트

- 민간 NDA 문서: 업로드 시 "NDA 조항상 제3자 처리 허용 여부 확인" 체크 필수, 미확인 시 내부 모델만
- 조건부 공개 문서: 배포 조건문(보안서약서) 원문을 케이스에 첨부하도록 유도
- AI 생성 고지: 리포트, 어시스턴트, 내보내기 파일 상단 고정 문구
- 저작권: 원문 파일의 외부 공유 기능은 제공하지 않음(조직 내부 열람만), 외부 SaaS 전환 시 공공누리 유형 확인 절차 추가
- 개인정보 처리방침: 독립 SaaS 전환 시 처리 위탁(벤더) 고지 항목 작성

---

## 4 기술적으로 무리하거나 주의가 필요한 요구사항과 대안

| 번호 | 요구사항 | 문제 | 대안 (이 문서의 반영) |
|---|---|---|---|
| 1 | HWP를 오픈소스로 완전 파싱 | 배포용(DRM) HWP는 오픈소스로 열 수 없고, 복잡한 표와 도형 안 텍스트는 파서마다 누락 가능. rhwp는 빠르게 발전 중이나 v0.7대 | rhwp 1순위 + 상용 파서 폴백 + 배포용 문서 PDF 변환 안내 + 파싱 품질 점수와 진단 리포트 + 회귀 테스트 |
| 2 | 200페이지 이상을 한 번에 정확히 분석 | 1M 컨텍스트라도 중간 정보 손실과 비용 문제 | 표준 목차 분류 기반 섹션 라우팅, 전체 문맥은 보조 패스, 근거 대조 필수 |
| 3 | 복수 벤더 앙상블로 정확도 보장 | 합의가 정답을 보장하지 않음(공통 오해), 비용 배수 | 교차검증은 선택형, 근거 대조가 1차 방어선, 합의는 신뢰도 신호로만 표시, 사용자 최종 확정 |
| 4 | 특정 업체에 유리한 조항 자동 탐지 | 정답 라벨이 없고 판단이 주관적, 단정 표현은 법적 리스크 | 경쟁 제한 "의심" 신호로만 표기, 규칙 층 정밀도 우선, 사람 검토 전제, 업체명 단정 금지 |
| 5 | 축적할수록 정확도가 저절로 개선 | 정답 데이터(결과 피드백) 없이는 개선 불가, 초기에는 표본 부족 | outcomes 축적과 나라장터 낙찰 API 연동, 표본 50건 이후 가중치 보정, 그 전에는 규칙과 근거 대조로 정확도 확보 |
| 6 | 모든 벤더를 동일하게 취급 | 컨텍스트 한도, 구조화 출력, 파일 입력, 캐시, 보존 정책이 벤더마다 다름 | 벤더 능력 프로필(DB)로 실행 계획 분기, Groq는 청크 실행 |
| 7 | 교차검증 비용과 시간을 사전에 정확히 제시 | 출력 길이와 벤더 지연은 변동 | 관측 기반 예측에 ±30% 표시, 실행 후 실제값 기록으로 보정, 예산 상한 차단 |
| 8 | 스캔 문서 200페이지 자체 OCR | 자체 OCR은 느리고 표 복원이 약함, GPU 없으면 수십 분 | 공개 문서는 상용 OCR, 민감 문서만 자체 OCR, 인입 시 예상 시간 고지 |
| 9 | 한국어 전문 검색을 Postgres 기본 기능으로 | 기본 파서가 한국어 형태소를 다루지 못함 | pgroonga 확장 또는 pg_trgm, 의미 검색과 결합 |
| 10 | env 없이 모든 설정을 DB로 | API 키 암호화의 마스터 키는 DB 밖에 있어야 함 | 마스터 키 1개만 환경 비밀, 나머지는 DB와 UI |
| 11 | HWP 페이지 번호로 원문 위치 표시 | 오픈소스 조판 엔진의 페이지 구분이 한컴과 다를 수 있음 | 문단 위치를 정식 참조, 페이지는 근사 표시, 렌더링 이미지에 하이라이트 |
| 12 | 상용 파서로 HWP 처리 | 편리하나 외부 전송이며 문서 등급 정책과 충돌 가능 | 공개 문서 한정 허용, 계약 조건(보존과 학습) 확인 |

## 5 놓쳤을 만한 고려사항

1. 나라장터 OpenAPI 연동: 공고 메타데이터 자동 채움, 낙찰과 계약 정보로 정답 데이터 확보, 사전규격 단계 문서까지 선제 분석 가능. 이 시스템의 데이터 가치를 좌우하는 항목
2. RFP는 파일 하나가 아니라 묶음: 과업내용서, 입찰공고문, 계약특수조건, 질의응답 답변, 정정공고를 케이스 단위로 관리해야 상충 기재 탐지와 정정 반영이 가능
3. 정정공고와 질의응답 반영: 마감 직전 요구사항이 바뀌는 경우가 흔함. 같은 공고번호의 차수 연결과 버전 diff(F11)
4. 사전규격 단계 대응: 규격 공개 단계에서 의견 제출로 특정 업체 유리 조항을 정정 요청할 수 있음. 이상 조항 탐지 결과를 의견서 초안으로 연결하는 기능은 확장 후보
5. 라이선스: pyhwp와 PyMuPDF의 AGPL은 SaaS 전환 시 문제. 초기부터 배제
6. 벤더 무료 티어 위험: Gemini 무료 키는 사람 검토를 포함한 학습 활용 대상. 키 등록 시 유료 확인 절차
7. ZDR의 예외: Anthropic Files API와 명시적 캐시, xAI ZDR 시 파일과 배치 비활성 등 벤더별 예외가 있어 조건부 공개 문서에서는 기능 제한 감수 필요
8. AI 기본법 투명성 의무: 외부 API 기반 B2B 서비스도 대상이 될 수 있어 AI 생성 고지 표시를 처음부터 포함
9. 개인정보: 담당 공무원 연락처는 공개 정보라도 개인정보. 마스킹과 최소 저장
10. 저작권과 공공누리: 내부 분석은 문제 소지 낮음, 외부 제공 시 유형 확인. 민간 RFP 원문 재배포 금지
11. 국정원 공공분야 AI 보안 정책: 공공기관을 고객으로 삼는 순간 보안성 검토와 인증 요구가 따름. gcube의 CSAP 준비와 연계
12. 골든 세트와 회귀 평가: 모델 교체 주기가 짧아 평가 세트 없이는 품질 관리 불가
13. HWP 배포용 문서와 이미지 삽입 텍스트: 파싱 불가 사례를 사용자에게 명확히 안내하는 UX 필요
14. 부가세 포함 여부와 예산 기준(배정예산, 추정가격, 기초금액)의 혼용: 금액 필드를 단일값이 아닌 기준별 언급 목록으로 저장
15. 요구사항 총괄표의 XLSX 첨부: 정보화 사업 RFP는 요구사항을 별도 엑셀로 주는 경우가 있어 XLSX 인입 필요
16. 사용자 수정 데이터의 가치: 수정 이력이 프롬프트 개선과 벤더 가중치 보정의 원천. 수정 UX를 쉽게
17. 파트너 매칭의 프라이버시: 독립 SaaS에서 여러 조직의 프로필로 컨소시엄을 매칭하려면 프로필 공개 범위 동의 설계가 선행
18. 보고용 산출물: 사업 책임자 보고용 1~2페이지 요약은 작업용과 같은 JSON에서 파생시켜 이중 생성을 피함

## 6 결정 필요 질문 목록

| 번호 | 질문 | 영향 범위 | 기본 가정 (답변 없을 시) |
|---|---|---|---|
| 1 | 내부 업무 시스템의 인증 방식과 세션 공유 방법 (NextAuth 세션 공유, 서브도메인, 사용자 디렉토리 API) | 2.2.3 SSO 어댑터 | 같은 상위 도메인의 서브도메인, NextAuth 세션 쿠키 공유 |
| 2 | 초기 사용자 수와 월 예상 분석 건수 | 비용 산정, 워커 규모 | 사용자 5명, 월 40건 |
| 3 | 민간 NDA 문서 처리 정책: 외부 AI 전송 전면 금지인지, NDA 검토 후 예외 허용인지, 내부 모델(gcube 서빙)을 언제 준비할지 | 3.13절, F10 | Phase 2까지 NDA 문서는 파싱과 검색만, AI 분석은 Phase 3 내부 모델 이후 |
| 4 | 상용 파서와 OCR(Upstage, 클로바) 사용 허용 여부와 예산 | 3.4절 | 공개 문서에 한해 허용 |
| 5 | 벤더 계정 형태: 조직 단일 키 사용, ZDR 계약 추진 여부와 대상 벤더 | 3.5.3절, 3.13절 | 조직 키, ZDR은 Phase 2에서 1개 벤더부터 |
| 6 | 회사 프로필 초기 자료 (회사소개서, 실적표, 인증서) 제공 가능 여부 | 3.10.2절 | 회사소개서와 실적표로 초안 생성 |
| 7 | 자동 레이더 수집 범위 (키워드, 사업 분류, 예산 하한)와 알림 채널 | F8 | Phase 3 결정 |
| 8 | 리포트 내보내기 형식 (Markdown, PDF, HWP) | 3.3.6절 | Markdown과 PDF, HWP 미지원 |
| 9 | 이상 조항 규칙 초기 검수 담당과 골든 세트 라벨링 담당 | 3.8절, 3.12.3절 | docore 직접, Phase 1에서 20건 |
| 10 | 원본 파일 보존 기간 | 3.13.1절 | 공개는 케이스 삭제 시까지, 조건부 90일, NDA 30일 |
| 11 | 제안서 목차와 전략 도출(F9)의 우선순위를 Phase 3에 두는 것에 동의하는지 | 로드맵 | Phase 3 |
| 12 | 서비스명 또는 코드명 (do 접두 제품군과의 일관성 여부) | 전체 | 가칭 RFP 분석기 |
| 13 | 월 LLM 비용 상한 | 3.5.3절 | 30만 원 |
| 14 | Python 워커 호스팅 위치 (gcube VM, 외부 컨테이너 호스팅) | 3.2.4절 | gcube VM |
| 15 | 배포용(DRM) HWP는 사용자 변환 안내로 충분한지 | 3.4.2절 | 안내로 충분 |
| 16 | 임베딩 모델 선택 (상용 vs 자체 서빙) | 3.3.4절 | 상용 1종, Phase 3에서 자체 서빙 검토 |
| 17 | 2.2.3의 독립 SaaS 전환 판단 기준 수치 동의 여부 | 로드맵 Phase 4 | 제시값 유지 |

## 7 부록

### 부록 A 파서와 라이브러리 조사 출처 (2026년 9월 9일 확인)

- rhwp (MIT, Rust, HWP 5.0과 HWPX, WASM, VS Code 확장): https://github.com/edwardkim/rhwp
- rhwp-python (PyO3 바인딩, IR 블록, LangChain 로더): https://github.com/DanMeon/rhwp-python , https://pypi.org/project/rhwp-python
- hwpxkit (Rust 기반 Python 휠, Markdown/HTML/JSON 변환): https://pypi.org/project/hwpxkit/
- pyhwp (AGPL v3, HWP 5.0 전용): https://github.com/mete0r/pyhwp , https://pyhwp.readthedocs.io/en/latest/intro.html
- Upstage Document Parse (HWP/HWPX 업로드 지원 공지): https://upstage.ai/blog/en/upstage-document-parse-now-supports-rotated-docs-multi-page-tables-and-long-image-processing
- 조달청 나라장터 사전규격정보서비스 (공공데이터포털): https://www.data.go.kr/data/15129437/openapi.do
- 조달청 OpenAPI 전체 서비스 목록 참고 (입찰공고, 사전규격, 낙찰, 계약, 발주계획, 누리장터): https://glama.ai/mcp/servers/ChangooLee/mcp-kr-g2b

### 부록 B 벤더 데이터 정책 요약 (2026년 9월 9일 확인, 설정 시 재확인 필수)

| 벤더 | 학습 사용 | 기본 보존 | ZDR | 비고 | 출처 |
|---|---|---|---|---|---|
| OpenAI API | 기본 미사용(옵트인 시만) | 남용 감시 로그 최대 30일 | 승인 시 ZDR 또는 수정된 남용 감시 | store 파라미터 강제 false 등 엔드포인트 동작 변경 | https://developers.openai.com/api/docs/guides/your-data |
| Anthropic API | 상업용 미사용 | 30일 | 조직 단위 승인 | Files API, 명시적 캐시, 일부 배치는 ZDR 예외 | https://platform.claude.com/docs/en/manage-claude/api-and-data-retention.md , https://support.anthropic.com/en/articles/8956058-i-have-a-zero-data-retention-agreement-with-anthropic-what-products-does-it-apply-to |
| Google Gemini API | 유료 티어 미사용, 무료 티어와 AI Studio는 사용(사람 검토 포함) | 유료: 제한 기간 남용 감시 로그 | 별도 확인 | 빌링 연결 프로젝트만 유료 취급, 데이터가 임의 국가에 임시 저장 가능 | https://ai.google.dev/gemini-api/terms |
| xAI (Grok) API | 명시적 허락 없이 미사용 | 30일 | 엔터프라이즈 전용, 파일과 배치 등 비활성 | | https://docs.x.ai/developers/faq/security |
| Groq | 미사용 | 프롬프트와 컨텍스트 미보존 명시 | 해당 없음 | 오픈웨이트 모델 호스팅 | https://groq.com/privacy |

### 부록 C 프론티어 모델 현황 메모 (2026년 9월 초, 시드 데이터용, 재확인 필수)

- Anthropic: Claude Fable 5.1(2026-09-01 출시, 1M 컨텍스트), Claude Opus 5(1M, 출력 최대 128K), Claude Sonnet 5
- OpenAI: GPT-5.6 계열(Sol, Terra, Luna, 약 1.05M 컨텍스트, 출력 128K)
- Google: Gemini 3.1 Pro(1M, 200K 초과 시 단가 상승 구간 있음), Gemini 3.x Flash 계열(1M, 저비용)
- xAI: Grok 4.6(약 500K)
- Groq 호스팅 오픈웨이트 모델: 모델 목록과 컨텍스트는 콘솔에서 설정 시 확인
- ※ 출처는 웹 비교 기사 다수이며 상충하는 정보가 있어 공식 문서로 재확인 후 ai_models 시드에 반영

### 부록 D 용어

- RFP-IR: 형식 무관 중간 표현, 블록과 섹션과 페이지 좌표를 포함
- 근거 대조(grounding check): 추출 값의 인용 문자열이 원문에 실제로 존재하는지 확인하는 절차
- 기본 모드: 단일 벤더 분석. 교차검증 모드: 복수 벤더 병렬 분석과 합의 판정
- 케이스: RFP 한 건을 구성하는 파일 묶음과 분석 결과의 단위
- 문서 등급: 공개, 조건부 공개, 민간 NDA
- 골든 세트: 정답 라벨이 있는 평가용 RFP 집합

## 변경 이력

- v0.0.1 (2026-09-09) 최초 작성, docore 작업지시 프롬프트 v0.0.2 기준 기획서와 설계서 통합 초안
