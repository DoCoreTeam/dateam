# GPU 모델 중복 박멸 — 캐노니컬 일원화 + 기존중복 병합 v0.7.261

## 문제
모델 목록(gpu_products)이 변형명으로 중복: A6000↔RTX A6000, V100↔Tesla V100.
근본: 모델 생성 경로 7곳 중 경쟁사 경로(competitor-import)가 캐노니컬 미사용(ilike 정확매칭)→변형명마다 새 모델.

## 수정 (코드 — 영구 해법)
- canonical-model.ts: ALIAS_TO_CANONICAL에 teslav100→'V100' 추가(a6000→'RTX A6000' 기존). +오병합금지 테스트.
- competitor-import.ts: 모델 find-or-create를 canonicalizeModel+normModelKey 매칭(confirm-review-item 동일 SSOT). 캐노니컬명 생성.

## 데이터 병합 (일회성 — 실행 완료)
백업(/tmp/merge-dup-backup.json) → A6000→RTX A6000, Tesla V100 32GB→V100(재지정+소프트삭제), 16GB→리네임.

## 검증
DB(중복0·데이터보존)+브라우저 실카탈로그API(A6000·Tesla V100 사라짐)+568테스트·tsc0·design·next build·DC-REV APPROVED.
