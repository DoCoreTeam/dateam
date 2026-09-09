# PLAN newAX: RFP 분석 시스템 전 범위
플랜 ID: P0001
플랜 버전: v0.4.2
상태: 진행중
지시: ins_0006
목표 버전: v0.8.0
작성: 2026-09-09
시작 커밋: 98674a0d

## 목표
- RFP 파일(HWP HWPX PDF 이미지 오피스 ZIP)을 넣으면 원문 근거가 붙은 리포트와 적합도 판정과 이상 조항이 나오는 화면을 newAX 안에 신설
- 검토한 RFP 가 케이스 단위로 축적되어 유사 사업 비교와 자연어 질의와 결과 피드백 학습이 되는 상태
- 설계서 F0 부터 F12 까지 전 기능을 구현하되, GPU 와 외부 계약이 있어야 켜지는 것은 어댑터와 설정 자리까지 만들어 두는 상태

## 범위 밖
- gcube GPU 위 vLLM 실서빙 구축 자체. F10 은 OpenAI 호환 엔드포인트 어댑터와 관리자 등록 UI 까지 만들고, 주소와 키가 등록되면 켜지는 구조로 둠
- 상용 파서와 상용 리랭커의 유료 계약과 키 발급. 어댑터와 설정 UI 는 만들되 키 없으면 비활성
- 별도 OCR 엔진(PaddleOCR Tesseract 클로바) 자체 구축. 이미지 텍스트화는 멀티모달 모델이 기본 경로이고, 등급 제한 폴백 자리만 어댑터로 둠
- 실제 결제 대행사(PG) 연동. F12 는 조직 생성과 초대와 역할과 사용량 집계와 요금제 정의까지, 청구는 사용량 내보내기까지
- 별도 저장소 분리와 별도 Supabase 프로젝트 이관. 이관 가능성만 보존(호스트 테이블 외래키 0건)
- Python 워커(rfp-docpipe) 신설. 설계서 3.2.2 의 대안인 전체 TypeScript 구성을 택함

## 완료 정의
- pnpm tsc --noEmit, pnpm lint, pnpm test, pnpm build 전부 통과
- rfp 신규 테이블 전부 org_id 보유 + RLS 활성 + 호스트 테이블로 나가는 외래키 없음
- 리포트의 모든 사실 값이 근거 블록 ID 를 갖고, 근거 미확인 값은 화면에서 강등 표시됨
- 문서 등급이 허용하지 않는 벤더로는 외부 전송이 코드 경로에서 차단되고 전송 기록이 남음
- 사용자 노출 문자열은 lib/rfp/terms 를 거치고 화면에 한글 리터럴 직접 표기 없음
- 신규 테스트가 apps/web/package.json 의 test 스크립트에 등재되어 실제로 실행됨
- 설정값은 env 추가 없이 DB 저장 + 관리자 UI 관리(예외는 벤더 키 암호화 마스터 키 하나)
- 설계서 2.4.2 기능표 F0 부터 F12 까지 각 기능이 어느 항목에서 구현됐는지 대조표가 종합 감사에 기록됨

## 참조
- newplan/RFP/RFP분석시스템_기획서_설계서_v0.0.1.md (전 항목이 따르는 원본 설계서)
- docs/ui-system/INVENTORY.md (화면 항목은 여기 있는 부품을 먼저 쓴다)
- docs/ui-system/GLOSSARY.md, apps/web/lib/terms (말의 SSOT)
- LOOP.md 6절 문체 규약
- 기존 재사용 대상: apps/web/lib/ai/gemini-call.ts, apps/web/lib/ai-chat/document-extract.ts, apps/web/lib/ci/jobs, apps/web/lib/supabase/server.ts, apps/web/lib/auth, apps/web/lib/doc/page-fit.ts

## 전제
- 스키마 분리: 설계서 3.7.1 은 Postgres 스키마 rfp 를 권고하나 호스트는 PostgREST 로 public 만 노출한다. 같은 뜻을 지키되 방법을 바꿔 public 스키마에 rfp_ 접두 테이블로 두고, 호스트 테이블로 나가는 외래키를 만들지 않아 이관 가능성을 보존
- 조직 키: 사내 사용 중 org 는 1개. rfp_orgs 1행 시드 + rfp_org_members 로 RLS 판정, F12 에서 다조직으로 확장
- 6장 결정 필요 질문 17개는 기본 가정값을 그대로 채택하고 전부 DB 설정으로 두어 나중에 UI 에서 바꿀 수 있게 함
- GPU 의존 기능 4종(F10 내부모델, 자체 OCR, 자체 리랭커, 자체 임베딩)은 전부 DB 에 등록하는 OpenAI 호환 엔드포인트로 추상화해 GPU 없이 구현하고 등록 시점에 켜짐

## 항목

### I01 도메인 상수와 용어 SSOT
상태: 통과
모드: 경량
범위: 신규 apps/web/lib/rfp/terms.ts, 신규 apps/web/lib/rfp/domain/doc-class.ts, 신규 apps/web/lib/rfp/domain/status.ts, 신규 apps/web/lib/rfp/domain/domain.test.ts
감사 기준:
- node --test 로 domain.test.ts 통과
- 문서 등급 3종(public restricted nda)과 파이프라인 상태 전이표가 설계서 3.3.1 과 1:1 대응하는 단정 존재
- 화면 노출 문자열이 terms.ts 한 곳에만 있고 다른 rfp 파일에 한글 리터럴이 없음을 검사하는 단정 존재
의존: 없음

### I01a 선행 실패 가드 3건 정리
상태: 통과
모드: 경량
범위: apps/web/lib/policy/policy-sync.test.ts, apps/web/lib/crm/services/first-run.test.ts
감사 기준:
- pnpm test 실패 건수가 3에서 0으로 줄어든 것을 실행 결과로 확인
- policy-sync 가 CLAUDE.md 대신 loop-kit 개편으로 옮겨간 .claude/heavy/CEO.md 를 보는지 확인
- first-run 가드가 배너 합성(error ?? restoreError)을 받아들이되 이중 표시 금지는 그대로 잠그는지 확인
- 두 가드를 일부러 깨뜨려 실패하는 것을 확인한 뒤 되돌림
의존: I01

### I02 DB 마이그레이션 246 케이스와 문서
상태: 통과
모드: 중량
범위: 신규 supabase/migrations/246_rfp_core.sql
감사 기준:
- psql 로 적용 성공, rfp_orgs rfp_org_members rfp_sources rfp_cases rfp_document_files rfp_document_ir rfp_doc_sections rfp_doc_blocks rfp_block_chunks rfp_requirements 생성 확인
- 생성 테이블 전부 rowsecurity = true 이고 org_id 컬럼 보유를 pg_catalog 질의로 확인
- 호스트 테이블을 참조하는 외래키가 rfp_ 테이블에 0건임을 질의로 확인
의존: I01

### I03 DB 마이그레이션 247 분석과 리포트와 설정
상태: 통과
모드: 중량
범위: 신규 supabase/migrations/247_rfp_analysis.sql
감사 기준:
- psql 로 적용 성공, rfp_analysis_jobs rfp_analysis_runs rfp_llm_calls rfp_report_schemas rfp_report_versions rfp_report_fields rfp_field_vendor_results rfp_field_resolutions rfp_anomaly_rules rfp_anomalies rfp_company_profiles rfp_profile_certifications rfp_profile_track_records rfp_profile_capabilities rfp_profile_partners rfp_fit_assessments rfp_comparisons rfp_ai_vendors rfp_ai_models rfp_ai_vendor_credentials rfp_ai_settings rfp_external_transfers rfp_audit_logs 생성 확인
- 생성 테이블 전부 RLS 활성 확인
- rfp_ai_vendors 와 rfp_ai_models 초기 시드가 부록 C 기준으로 들어가고 allowed_doc_classes 기본값이 public 임을 질의로 확인
의존: I02

### I04 DB 마이그레이션 248 학습과 확장과 테넌트
상태: 통과
모드: 중량
범위: 신규 supabase/migrations/248_rfp_growth.sql
감사 기준:
- psql 로 적용 성공, rfp_outcomes rfp_radar_rules rfp_radar_hits rfp_notifications rfp_proposals rfp_case_revisions rfp_revision_diffs rfp_usage_ledger rfp_plans rfp_invites 생성 확인
- 생성 테이블 전부 RLS 활성 + org_id 보유 확인
- rfp_plans 기본 요금제 3종 시드 확인
의존: I03

### I05 RFP-IR 규격
상태: 통과
모드: 경량
범위: 신규 apps/web/lib/rfp/ir/types.ts, 신규 apps/web/lib/rfp/ir/build.ts, 신규 apps/web/lib/rfp/ir/ir.test.ts
감사 기준:
- node --test 로 ir.test.ts 통과
- 설계서 3.3.3 의 Document meta pages sections blocks tables figures 필드가 타입에 전부 존재하는 단정
- 좌표계 정규화(원점 좌상단 0~1 비율)와 text_hash 생성이 순수 함수로 검증됨
의존: I01

### I06 HWP HWPX 파서 어댑터
상태: 통과
모드: 경량
범위: 신규 apps/web/lib/rfp/parse/hwp.ts, 신규 apps/web/lib/rfp/parse/hwp.test.ts, apps/web/package.json
감사 기준:
- @rhwp/core 설치 후 node --test 로 hwp.test.ts 통과
- createEmpty 로 만든 합성 HWP 를 파싱해 문단 수와 표 수와 텍스트 해시가 기대값과 일치
- 배포용(DRM) 문서 판별 시 파싱을 시도하지 않고 안내 사유를 반환하는 단정
- source_ref 에 section_idx 와 para_idx 가 실려 페이지 번호는 근사 표기로 분리되는 단정
의존: I05

### I07 PDF 와 오피스 파서 어댑터
상태: 통과
모드: 경량
범위: 신규 apps/web/lib/rfp/parse/office.ts, 신규 apps/web/lib/rfp/parse/office.test.ts
감사 기준:
- node --test 로 office.test.ts 통과
- officeparser AST 노드(heading paragraph table list page)가 IR 블록 타입으로 사상되는 단정
- 페이지별 텍스트 레이어 판정이 문자 밀도 임계값으로 동작하고 스캔 페이지를 OCR 경로로 넘기는 단정
의존: I05

### I08 이미지 블록 텍스트화
상태: 대기
모드: 경량
범위: 신규 apps/web/lib/rfp/parse/image-text.ts, 신규 apps/web/lib/rfp/parse/image-text.test.ts
감사 기준:
- node --test 로 image-text.test.ts 통과
- 텍스트 레이어가 없는 페이지와 문서 안에 박힌 그림 블록만 대상이 되고, 텍스트가 이미 있는 페이지는 모델을 부르지 않는 단정
- 기본 경로가 멀티모달 모델이고 별도 OCR 엔진은 등급 제한으로 외부 전송이 막힐 때만 쓰는 폴백인 단정
- 결과 블록에 출처 표시(모델 이름 또는 엔진 이름)와 신뢰도가 실리고 임계값 미만이면 근거 사용 시 경고 플래그가 서는 단정
- 페이지당 예상 비용이 인입 시점에 산출되는 단정
의존: I07

### I09 ZIP 해제와 파일 역할 분류
상태: 대기
모드: 경량
범위: 신규 apps/web/lib/rfp/parse/bundle.ts, 신규 apps/web/lib/rfp/parse/role.ts, 신규 apps/web/lib/rfp/parse/bundle.test.ts
감사 기준:
- node --test 로 bundle.test.ts 통과
- 중첩 ZIP 1단계까지만 풀고 압축 폭탄 상한(해제 총량과 파일 수)을 넘기면 거부하는 단정
- 파일명 규칙으로 역할 9종(본문 과업내용서 공고문 특수조건 작성안내 서식 질의응답 정정공고 기타)을 추정하는 단정
의존: I05

### I10 파서 라우터와 품질 점수
상태: 대기
모드: 경량
범위: 신규 apps/web/lib/rfp/parse/index.ts, 신규 apps/web/lib/rfp/parse/quality.ts, 신규 apps/web/lib/rfp/parse/quality.test.ts
감사 기준:
- node --test 로 quality.test.ts 통과
- 확장자와 매직 바이트 불일치 시 거부하는 단정
- 품질 점수 0~100 산식(텍스트 추출 비율 표 수 OCR 신뢰도 섹션 깊이 경고 수)과 60 미만 경고 플래그 단정
- 1순위 파서 실패 시 폴백 파서로 넘어가고 사용한 파서와 버전이 IR meta 에 남는 단정
의존: I06, I07, I08, I09

### I11 섹션 트리와 표준 목차 14분류
상태: 대기
모드: 경량
범위: 신규 apps/web/lib/rfp/structure/sections.ts, 신규 apps/web/lib/rfp/structure/categories.ts, 신규 apps/web/lib/rfp/structure/sections.test.ts
감사 기준:
- node --test 로 sections.test.ts 통과
- 번호 패턴(제1장 1. 가. 1))과 제목 스타일로 트리를 만들고 실패 시 페이지 단위 가상 섹션으로 폴백하는 단정
- 표준 카테고리 14종 분류가 키워드 규칙만으로 동작하고 애매한 것만 미분류로 남는 단정
의존: I10

### I12 요구사항 총괄표 정규화
상태: 대기
모드: 경량
범위: 신규 apps/web/lib/rfp/structure/requirements.ts, 신규 apps/web/lib/rfp/structure/requirements.test.ts
감사 기준:
- node --test 로 requirements.test.ts 통과
- 표에서 요구사항 ID 체계(SFR PER SER 등)를 뽑아 코드 분류 제목 설명 근거 블록으로 정규화하는 단정
- XLSX 별첨 형태의 총괄표도 같은 결과로 정규화되는 단정
의존: I11

### I13 케이스 인입 API 와 저장
상태: 대기
모드: 중량
범위: 신규 apps/web/app/api/rfp/cases/route.ts, 신규 apps/web/app/api/rfp/cases/[id]/files/route.ts, 신규 apps/web/lib/rfp/db/cases.ts, 신규 apps/web/lib/rfp/db/files.ts
감사 기준:
- 미인증 요청이 401 이고 다른 org 케이스 조회가 0건인 것을 실호출로 확인
- 같은 SHA-256 파일 재업로드가 중복으로 차단되고 기존 파일에 연결되는 것을 실호출로 확인
- 파일 200MB 케이스 500MB 상한 초과가 거부되는 것을 실호출로 확인
- 문서 등급 미지정 업로드가 거부되는 것을 실호출로 확인
의존: I04, I10

### I14 파이프라인 상태기계와 작업 큐
상태: 대기
모드: 경량
범위: 신규 apps/web/lib/rfp/jobs/queue.ts, 신규 apps/web/lib/rfp/jobs/stages.ts, 신규 apps/web/lib/rfp/jobs/queue.test.ts, 신규 apps/web/app/api/rfp/worker/tick/route.ts
감사 기준:
- node --test 로 queue.test.ts 통과
- SKIP LOCKED 선점과 재시도 상한과 단계별 실패 상태 저장이 단정으로 검증됨
- 단계가 멱등이라 같은 단계를 두 번 돌려도 결과가 같은 단정
- tick 엔드포인트가 워커 토큰 없이는 401 인 것을 실호출로 확인
의존: I13

### I15 인덱싱 청크와 임베딩과 검색
상태: 대기
모드: 경량
범위: 신규 apps/web/lib/rfp/index/chunk.ts, 신규 apps/web/lib/rfp/index/embed.ts, 신규 apps/web/lib/rfp/index/search.ts, 신규 apps/web/lib/rfp/index/chunk.test.ts
감사 기준:
- node --test 로 chunk.test.ts 통과
- 300~800자 정규화와 표 행 청크에 표 제목 접두어가 붙는 단정
- embedding_model 값이 청크와 함께 저장되어 모델 교체 시 재임베딩 대상을 가릴 수 있는 단정
- 키워드 검색과 벡터 검색을 RRF 로 합치는 순수 함수 단정
의존: I14

### I16 AI 게이트웨이
상태: 대기
모드: 중량
범위: 신규 apps/web/lib/rfp/ai/gateway.ts, 신규 apps/web/lib/rfp/ai/models.ts, 신규 apps/web/lib/rfp/ai/mask.ts, 신규 apps/web/lib/rfp/ai/gateway.test.ts
감사 기준:
- node --test 로 gateway.test.ts 통과
- 문서 등급이 허용하지 않는 모델로 호출하면 예외가 나고 rfp_external_transfers 에 기록이 남지 않는 단정
- 개인정보 마스킹과 복원이 왕복에서 원문을 잃지 않는 단정
- 호출마다 rfp_llm_calls 에 토큰과 비용과 지연이 기록되는 단정
- 장애 시 조직 폴백 순서로 전환되고 전환 사실이 결과 메타에 남는 단정
의존: I03

### I17 내부 모델과 자체 서빙 엔드포인트 어댑터
상태: 대기
모드: 중량
범위: 신규 apps/web/lib/rfp/ai/self-hosted.ts, 신규 apps/web/lib/rfp/ai/rerank.ts, 신규 apps/web/lib/rfp/ai/self-hosted.test.ts
감사 기준:
- node --test 로 self-hosted.test.ts 통과
- 내부 벤더가 OpenAI 호환 엔드포인트 하나(주소 키 모델명)만으로 등록되고 등록 전에는 후보에서 빠지는 단정
- 내부 벤더의 allowed_doc_classes 기본값이 public restricted nda 셋 다이고 외부 전송 기록에 internal 로 남는 단정
- 리랭커와 임베딩도 같은 방식으로 상용과 자체를 바꿔 끼울 수 있는 단정
의존: I16

### I18 리포트 스키마와 추출 태스크 9종
상태: 대기
모드: 경량
범위: 신규 apps/web/lib/rfp/report/schema.ts, 신규 apps/web/lib/rfp/report/tasks.ts, 신규 apps/web/lib/rfp/report/routing.ts, 신규 apps/web/lib/rfp/report/report.test.ts
감사 기준:
- node --test 로 report.test.ts 통과
- 설계서 3.6.1 의 최상위 키 11종과 값 노드 공통 속성 6종이 스키마에 존재하는 단정
- 섹션 라우팅이 태스크별 관련 카테고리를 골라 넣고 컨텍스트 60% 초과 시 청크 분할로 떨어지는 단정
의존: I11, I16

### I19 근거 대조와 규칙 검증과 자기 검토
상태: 대기
모드: 경량
범위: 신규 apps/web/lib/rfp/report/grounding.ts, 신규 apps/web/lib/rfp/report/rule-verify.ts, 신규 apps/web/lib/rfp/report/self-review.ts, 신규 apps/web/lib/rfp/report/grounding.test.ts
감사 기준:
- node --test 로 grounding.test.ts 통과
- 인용 문자열이 원문에서 유사도 0.9 로 확인되지 않으면 신뢰도가 0.5 이하로 강등되는 단정
- 금액과 기간과 법정 공고 기간 산술 정합 검사가 불일치를 잡아내는 단정
- 나라장터 메타데이터와 추출값 불일치 시 경고가 붙는 단정
의존: I18

### I20 이상 조항 규칙 층
상태: 대기
모드: 경량
범위: 신규 apps/web/lib/rfp/anomaly/rules.ts, 신규 apps/web/lib/rfp/anomaly/engine.ts, 신규 apps/web/lib/rfp/anomaly/anomaly.test.ts
감사 기준:
- node --test 로 anomaly.test.ts 통과
- R01~R12 규칙 12개가 전부 정의되고 각 규칙마다 양성 1건 음성 1건 단정 존재
- 규칙 정의가 DB(rfp_anomaly_rules)에서 오고 코드는 실행기만인 단정
의존: I18

### I21 이상 조항 통계 층과 AI 층과 병합
상태: 대기
모드: 경량
범위: 신규 apps/web/lib/rfp/anomaly/stat.ts, 신규 apps/web/lib/rfp/anomaly/llm.ts, 신규 apps/web/lib/rfp/anomaly/merge.ts, 신규 apps/web/lib/rfp/anomaly/merge.test.ts
감사 기준:
- node --test 로 merge.test.ts 통과
- 표본 20건 미만이면 통계 층이 비활성이 되는 단정
- 등급 판정(규칙 확정, 규칙과 AI 동시, AI 단독 의심, 통계 단독 참고)이 설계서 3.8.5 와 같은 단정
- 특정 업체명을 단정하는 문장을 만들지 않는 것을 검사하는 단정
의존: I20

### I22 회사 프로필과 적합도 판정
상태: 대기
모드: 경량
범위: 신규 apps/web/lib/rfp/fit/profile.ts, 신규 apps/web/lib/rfp/fit/assess.ts, 신규 apps/web/lib/rfp/fit/assess.test.ts, 신규 apps/web/app/api/rfp/profile/route.ts
감사 기준:
- node --test 로 assess.test.ts 통과
- 하드 제약 결과 3값(충족 미충족 확인불가)과 소프트 점수 가중치(40 25 15 -20 10)가 코드로 계산되고 재현되는 단정
- 판정 규칙 3분기(전체 수행 부분 참여 부적합)와 조건부 꼬리표가 단정으로 검증됨
- 프로필 버전과 리포트 버전이 판정 결과에 함께 기록되는 단정
의존: I18

### I23 프로필 자동 초안
상태: 대기
모드: 경량
범위: 신규 apps/web/lib/rfp/fit/draft.ts, 신규 apps/web/lib/rfp/fit/draft.test.ts, 신규 apps/web/app/api/rfp/profile/draft/route.ts
감사 기준:
- node --test 로 draft.test.ts 통과
- 회사소개서와 실적표를 인입 파이프라인에 그대로 태워 프로필 초안이 나오는 단정
- 초안은 draft 상태로만 저장되고 사용자 확정 전에는 판정에 쓰이지 않는 단정
의존: I22

### I24 기본 모드 분석 실행
상태: 대기
모드: 경량
범위: 신규 apps/web/lib/rfp/analyze/run-base.ts, 신규 apps/web/lib/rfp/analyze/persist.ts, 신규 apps/web/lib/rfp/analyze/run-base.test.ts, 신규 apps/web/app/api/rfp/cases/[id]/analyze/route.ts
감사 기준:
- node --test 로 run-base.test.ts 통과
- 태스크 9개 결과가 하나의 리포트 JSON 으로 합쳐져 report_versions v1 으로 불변 저장되고 report_fields 가 파생되는 단정
- 분석 요청이 member 권한부터 가능하고 viewer 는 403 인 것을 실호출로 확인
의존: I19, I21, I22

### I25 교차검증 모드
상태: 대기
모드: 경량
범위: 신규 apps/web/lib/rfp/cross/consensus.ts, 신규 apps/web/lib/rfp/cross/run-cross.ts, 신규 apps/web/lib/rfp/cross/estimate.ts, 신규 apps/web/lib/rfp/cross/consensus.test.ts, 신규 apps/web/app/api/rfp/cases/[id]/cross/route.ts
감사 기준:
- node --test 로 consensus.test.ts 통과
- 필드 유형 6종별 일치 판정 규칙(금액 기간 열거형 짧은텍스트 긴텍스트 목록)이 단정으로 검증됨
- 합의율 1.0 일치, 0.5 초과 다수일치, 그 외 불일치 삼분과 목록형 합집합 유지가 단정으로 검증됨
- 사후 항목별 실행이 기본 벤더 결과를 재사용하고 새 버전을 만들되 이전 버전을 덮어쓰지 않는 단정
- 권장 점수(오판 손실 등급 곱하기 불확실성)와 임계값 배지 산출 단정
의존: I24

### I26 유사 사업 비교
상태: 대기
모드: 경량
범위: 신규 apps/web/lib/rfp/compare/similar.ts, 신규 apps/web/lib/rfp/compare/diff.ts, 신규 apps/web/lib/rfp/compare/compare.test.ts, 신규 apps/web/app/api/rfp/cases/[id]/compare/route.ts
감사 기준:
- node --test 로 compare.test.ts 통과
- 임베딩 상위 20건에서 구조화 필터를 거쳐 상위 5건으로 좁히는 단정
- 정형 비교표(예산 기간 자격 산출물 수)가 양쪽 근거를 함께 실어 나오는 단정
의존: I24

### I27 어시스턴트 질의
상태: 대기
모드: 경량
범위: 신규 apps/web/lib/rfp/assistant/intent.ts, 신규 apps/web/lib/rfp/assistant/retrieve.ts, 신규 apps/web/lib/rfp/assistant/answer.ts, 신규 apps/web/lib/rfp/assistant/assistant.test.ts, 신규 apps/web/app/api/rfp/assistant/route.ts
감사 기준:
- node --test 로 assistant.test.ts 통과
- 자유 형식 text-to-SQL 을 만들지 않고 허용 컬럼 화이트리스트 질의 빌더만 쓰는 단정
- 답변 인용 태그가 실제 컨텍스트 청크와 매칭되지 않으면 제거되는 단정
- 컨텍스트에 상위 등급 문서가 섞이면 허용 벤더로 전환하거나 해당 청크를 빼는 단정
의존: I15, I24

### I28 나라장터 공고 연동
상태: 대기
모드: 중량
범위: 신규 apps/web/lib/rfp/g2b/client.ts, 신규 apps/web/lib/rfp/g2b/map.ts, 신규 apps/web/lib/rfp/g2b/g2b.test.ts, 신규 apps/web/app/api/rfp/g2b/route.ts
감사 기준:
- node --test 로 g2b.test.ts 통과
- 공고번호와 차수로 조회한 응답이 rfp_sources 컬럼으로 사상되는 단정
- 서비스 키가 env 가 아니라 DB 설정에서 읽히는 단정
- 첨부 다운로드 실패 시 수동 업로드 폴백 사유가 사용자에게 전달되는 단정
의존: I13

### I29 나라장터 낙찰과 계약 연동
상태: 대기
모드: 중량
범위: 신규 apps/web/lib/rfp/g2b/award.ts, 신규 apps/web/lib/rfp/g2b/award.test.ts, 신규 apps/web/app/api/rfp/g2b/award/route.ts
감사 기준:
- node --test 로 award.test.ts 통과
- 낙찰과 계약 응답이 rfp_outcomes 로 사상되고 우리 참여 여부와 순위가 구분되는 단정
- 같은 공고를 두 번 수집해도 결과가 한 행인 단정
의존: I28

### I30 결과 피드백과 학습 루프
상태: 대기
모드: 경량
범위: 신규 apps/web/lib/rfp/learn/outcomes.ts, 신규 apps/web/lib/rfp/learn/calibrate.ts, 신규 apps/web/lib/rfp/learn/calibrate.test.ts, 신규 apps/web/app/api/rfp/cases/[id]/outcome/route.ts
감사 기준:
- node --test 로 calibrate.test.ts 통과
- 표본 50건 미만이면 가중치 보정을 적용하지 않고 기본 가중치를 쓰는 단정
- 보정 전후 판정 일치율을 비교해 개선이 없으면 채택하지 않는 단정
- 사용자 수정 이력이 벤더 가중치와 매핑 사전 갱신에 반영되는 단정
의존: I25, I29

### I31 신규 공고 자동 레이더
상태: 대기
모드: 경량
범위: 신규 apps/web/lib/rfp/radar/rules.ts, 신규 apps/web/lib/rfp/radar/sweep.ts, 신규 apps/web/lib/rfp/radar/sweep.test.ts, 신규 apps/web/app/api/rfp/radar/route.ts
감사 기준:
- node --test 로 sweep.test.ts 통과
- 키워드와 분류와 예산 범위 규칙이 DB 에서 오고 같은 공고를 두 번 담지 않는 단정
- 사전 점수 상위 정렬과 자동 파싱은 후보 검색까지만 자동인 단정
의존: I29

### I32 알림 채널
상태: 대기
모드: 경량
범위: 신규 apps/web/lib/rfp/notify/notify.ts, 신규 apps/web/lib/rfp/notify/notify.test.ts, 신규 apps/web/app/api/rfp/notifications/route.ts
감사 기준:
- node --test 로 notify.test.ts 통과
- 분석 완료와 레이더 적중과 예산 상한 임박이 알림으로 나가고 사용자별 켜고 끄기가 되는 단정
- 알림 발송 실패가 본 작업을 막지 않는 단정
의존: I31

### I33 제안서 목차와 제안 전략
상태: 대기
모드: 경량
범위: 신규 apps/web/lib/rfp/proposal/outline.ts, 신규 apps/web/lib/rfp/proposal/strategy.ts, 신규 apps/web/lib/rfp/proposal/outline.test.ts, 신규 apps/web/app/api/rfp/cases/[id]/proposal/route.ts
감사 기준:
- node --test 로 outline.test.ts 통과
- 목차가 평가 기준 배점과 요구사항 총괄표에서 파생되고 각 목차 항목이 근거 요구사항 ID 를 갖는 단정
- 전략이 적합도 판정의 강점과 갭을 입력으로 받는 단정
의존: I24, I22

### I34 정정공고와 질의응답 반영
상태: 대기
모드: 경량
범위: 신규 apps/web/lib/rfp/revision/link.ts, 신규 apps/web/lib/rfp/revision/diff.ts, 신규 apps/web/lib/rfp/revision/diff.test.ts, 신규 apps/web/app/api/rfp/cases/[id]/revisions/route.ts
감사 기준:
- node --test 로 diff.test.ts 통과
- 같은 공고번호의 차수가 supersedes 로 연결되고 이전 케이스가 사라지지 않는 단정
- 리포트 필드 단위 diff 가 변경된 값과 근거를 함께 내는 단정
의존: I25, I28

### I35 리포트 내보내기
상태: 대기
모드: 경량
범위: 신규 apps/web/lib/rfp/export/markdown.ts, 신규 apps/web/lib/rfp/export/pdf.ts, 신규 apps/web/lib/rfp/export/export.test.ts, 신규 apps/web/app/api/rfp/cases/[id]/export/route.ts
감사 기준:
- node --test 로 export.test.ts 통과
- 작업용과 보고용이 같은 JSON 에서 파생되고 보고용에 근거와 벤더별 값이 없는 단정
- 내보내기 파일 상단에 AI 생성 고지 문구가 반드시 들어가는 단정
의존: I24

### I36 멀티테넌트 온보딩과 사용량
상태: 대기
모드: 중량
범위: 신규 apps/web/lib/rfp/tenant/org.ts, 신규 apps/web/lib/rfp/tenant/invite.ts, 신규 apps/web/lib/rfp/tenant/usage.ts, 신규 apps/web/lib/rfp/tenant/tenant.test.ts, 신규 apps/web/app/api/rfp/orgs/route.ts
감사 기준:
- node --test 로 tenant.test.ts 통과
- 조직 생성과 초대와 역할 3종(admin member viewer)이 동작하고 다른 조직 데이터가 0건인 것을 실호출로 확인
- 사용량 원장이 llm_calls 와 OCR 페이지 수를 조직별로 집계하고 요금제 상한 초과 시 차단하는 단정
의존: I16, I04

### I37 화면 셸과 케이스 목록과 인입
상태: 대기
모드: 경량
범위: 신규 apps/web/app/(rfp)/rfp/page.tsx, 신규 apps/web/app/(rfp)/rfp/layout.tsx, 신규 apps/web/app/(rfp)/rfp/CaseListClient.tsx, 신규 apps/web/app/(rfp)/rfp/new/page.tsx, 신규 apps/web/components/rfp/UploadPanel.tsx
감사 기준:
- 브라우저에서 /rfp 진입, 파일 업로드, 진행률 표시, 완료 후 리포트 이동까지 실동작 확인
- 셸이 CRM 과 같은 AppShell 한 벌이고 자작 셸을 만들지 않은 것을 shell-contract 가드 통과로 확인
- pnpm design:check 통과, 목록은 ListSurface 를 쓰고 빈 상태는 EmptyState 를 쓰는 것을 파일에서 확인
- 문서 등급 선택이 필수이고 미선택 시 제출이 막히는 것을 브라우저에서 확인
의존: I14, I28

### I38 화면 리포트와 원문 뷰어
상태: 대기
모드: 경량
범위: 신규 apps/web/app/(rfp)/rfp/[id]/page.tsx, 신규 apps/web/app/(rfp)/rfp/[id]/ReportClient.tsx, 신규 apps/web/components/rfp/ReportCard.tsx, 신규 apps/web/components/rfp/SourceViewer.tsx, 신규 apps/web/components/rfp/EvidenceLink.tsx
감사 기준:
- 브라우저에서 리포트 카드 9종과 이상 조항 섹션과 적합도 상세가 렌더되는 것 확인
- 근거 링크를 누르면 원문 뷰어가 해당 페이지와 블록을 하이라이트하는 것 확인
- 근거 미확인 값과 낮은 신뢰도가 시각적으로 강등 표시되는 것 확인
- 작업용과 보고용 보기 전환이 동작하는 것 확인
의존: I24, I35, I37

### I39 화면 교차검증과 비교와 어시스턴트
상태: 대기
모드: 경량
범위: 신규 apps/web/components/rfp/CrossVerifyDialog.tsx, 신규 apps/web/components/rfp/VersionDiff.tsx, 신규 apps/web/components/rfp/ComparePanel.tsx, 신규 apps/web/app/(rfp)/rfp/assistant/page.tsx
감사 기준:
- 항목 카드의 교차검증 버튼에서 예상 비용과 시간이 표시되고 확인 후 새 버전이 생기는 것을 브라우저에서 확인
- 불일치 항목에서 벤더별 값과 근거가 병기되고 사용자 최종값 선택이 기록되는 것 확인
- 어시스턴트 답변에 인용이 붙고 인용 클릭으로 원문에 도달하는 것 확인
의존: I25, I26, I27, I38

### I40 화면 프로필과 적합도와 제안서
상태: 대기
모드: 경량
범위: 신규 apps/web/app/(rfp)/rfp/profile/page.tsx, 신규 apps/web/components/rfp/ProfileEditor.tsx, 신규 apps/web/components/rfp/FitPanel.tsx, 신규 apps/web/components/rfp/ProposalPanel.tsx
감사 기준:
- 회사 프로필 자동 초안 생성과 확인 저장이 브라우저에서 동작하는 것 확인
- 적합도 판정 카드와 요건 표와 갭 목록이 렌더되고 요건별 사용자 수정이 저장되는 것 확인
- 제안서 목차가 근거 요구사항과 함께 나오는 것 확인
의존: I22, I23, I33, I38

### I41 화면 레이더와 결과 기록
상태: 대기
모드: 경량
범위: 신규 apps/web/app/(rfp)/rfp/radar/page.tsx, 신규 apps/web/components/rfp/RadarRules.tsx, 신규 apps/web/components/rfp/OutcomeForm.tsx, 신규 apps/web/components/rfp/RevisionDiffPanel.tsx
감사 기준:
- 레이더 규칙 등록과 적중 목록과 사전 점수 정렬이 브라우저에서 동작하는 것 확인
- 참여 결정과 낙찰 결과 기록이 저장되고 나라장터 자동 채움이 덮어쓰지 않는 것 확인
- 정정공고 차수 diff 가 화면에서 보이는 것 확인
의존: I30, I31, I34, I38

### I42 화면 관리자 설정
상태: 대기
모드: 중량
범위: 신규 apps/web/app/(rfp)/rfp/admin/page.tsx, 신규 apps/web/components/rfp/VendorSettings.tsx, 신규 apps/web/components/rfp/RuleSettings.tsx, 신규 apps/web/components/rfp/TransferLog.tsx, 신규 apps/web/components/rfp/UsageDashboard.tsx
감사 기준:
- admin 이 아닌 계정이 /rfp/admin 에 접근하면 막히는 것을 브라우저에서 확인
- 벤더 키 등록과 모델 능력 값 편집과 월 예산 상한 저장이 DB 에 반영되는 것 확인
- 이상 조항 규칙 12개가 목록으로 보이고 켜고 끌 수 있는 것 확인
- 케이스별 전송 벤더 목록과 조직별 사용량과 비용이 조회되는 것 확인
- 내부 모델 엔드포인트 등록 폼이 있고 등록 전에는 NDA 문서 분석이 막히는 것 확인
의존: I17, I36, I39, I41

### I43 서비스 등재와 가드와 테스트 등재
상태: 대기
모드: 경량
범위: apps/web/lib/terms/index.ts, apps/web/lib/nav/surface.ts, apps/web/lib/nav/menu.ts, apps/web/package.json, 신규 apps/web/lib/rfp/rfp-guard.test.ts, apps/web/lib/changelog/entries.ts
감사 기준:
- ServiceKey 와 SERVICE_LABEL 과 SERVICE_ROUTES 와 SERVICE_HOME 과 NAV_LABEL 다섯 곳에 rfp 가 등재되어 CRM 과 같은 방식으로 서비스가 되는 것을 기존 nav 가드 통과로 확인
- 브라우저에서 계정 메뉴와 전체 메뉴와 Cmd+K 에서 RFP 로 오가는 길이 전부 잡히는 것 확인
- pnpm test 총 테스트 수가 신규 등재 전보다 실제로 늘어난 것을 실행 결과로 확인
- rfp-guard.test.ts 를 일부러 깨뜨려 실패하는 것을 확인한 뒤 되돌림
- 업데이트 내역에 v0.8.0 사용자향 항목이 추가됨
의존: I42

### I44 버전 올리기와 종합 정리
상태: 대기
모드: 경량
범위: package.json, apps/web/package.json, apps/web/lib/changelog/entries.ts, LOOP.md
감사 기준:
- 버전 표기 4곳이 전부 0.8.0 인 것을 grep 으로 확인
- pnpm build 통과
- 설계서 F0 부터 F12 대조표가 종합 감사 절에 기록됨
의존: I43

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-09-09) 최초 작성 (ins_0006)
- v0.2.0 (2026-09-09) 사용자 개입으로 범위 확대, Phase 3 전부와 Phase 4 온보딩까지 포함, 항목 30에서 44로 (ins_0006)
- v0.3.0 (2026-09-09) 사용자 개입 반영, I08 을 별도 OCR 엔진에서 멀티모달 이미지 텍스트화로 교체하고 I43 을 CRM 과 같은 서비스 등재로 강화 (ins_0006)
- v0.4.0 (2026-09-09) I01 중 선행 작업 누락 발견, pnpm test 선행 실패 3건을 정리하는 I01a 삽입 (audit:I01)
- v0.4.1 (2026-09-09) 선행 실패 가드 3건이 완료 정의(pnpm test 통과)를 막아 I01a 삽입 (audit:I01)
- v0.4.2 (2026-09-09) I06 범위에서 pnpm-lock.yaml 을 뺀다 — 이 저장소는 .gitignore:29 로 잠금 파일을 추적하지 않아 커밋 대상이 될 수 없다 (audit:I06)
