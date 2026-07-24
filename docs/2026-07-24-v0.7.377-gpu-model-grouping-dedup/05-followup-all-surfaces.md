# 05-followup — 전 표면 일관 적용 + 삭제행 누출 수정 (v0.7.386)

## 발단 (사용자 지적)
- v0.7.377은 **스펙 관리(SpecsTab) 한 곳만** 그룹핑 → 사용자가 실제 보는 **가격표(board)** 는 그대로 H100 4줄. "실제 렌더 경로 우선 + 공존 경로 전부" 정책 위반.
- specs 화면의 "NVIDIA RTX PRO 6000 폼팩터 3" = **삭제된 표기중복이 그룹에 섞인 버그**(대소문자·제조사명만 다른 같은 모델).
- "스펙 같으면 회사마다 이름 달라도 같은 모델", "전 모델 전 항목 다 확인".

## 전수 감사 결과 (실DB, baseModelKey 클러스터링)
- **활성 카탈로그는 깨끗**: 표기중복 0, 다중표기는 정당한 폼팩터 계열(a100/b200/h100)뿐.
- 정규화 정확성 검증: `NVIDIA RTX PRO 6000`·`RTX Pro 6000`·`RTX PRO 6000` → 모두 `rtxpro6000`(합쳐짐 ✓) / `RTX 6000 Ada`·`Quadro RTX 6000`·`RTX A6000`·`RTX 6000` → 각각 분리(오병합 0 ✓).
- 스크린샷의 "RTX PRO 6000 폼팩터 3"은 **삭제(2026-06-23)된 2행이 specs API 미필터로 누출**된 것. 대량병합 불필요.

## 수정 (라이브 표면 전부)
| 표면 | 수정 |
|---|---|
| specs API (`specs/route.ts`, `specs/generate`) | **`.is('deleted_at', null)` 추가** — 삭제행 누출 차단(가짜 폼팩터 제거) |
| **UnifiedTable** (가격표=board + 5뷰, 사용자 실화면) | `baseModelKey` 그룹핑 + 폼팩터 태그(행) |
| **catalog** (판매가격표) | `buildModelGroups` base 그룹핑 + collapse 키 base화 |
| **ModelCandidateQueue** (신규 등록 대기) | base로 묶어 "H100의 신규 폼팩터"로 제시 + 그룹 일괄등록 |
| SpecsTab (v0.7.377) | 유지 |

## 보류 (명시)
- **PriceTableTab** (unified OFF 롤백 뷰, 사용자 미노출): `model_name`이 tier그룹·collapse·파생사다리(`buildTierModelGroups`/`modelKey`)의 정체성 키로 깊게 얽혀, 잘못 건드리면 파생가격 회귀. 라이브 아니므로 후속 과제로 분리.

## 검증
- tsc 0 / design:check ✅ / 실브라우저 E2E 4/4 (board H100 1그룹·specs 삭제행 제거·catalog 정상).
