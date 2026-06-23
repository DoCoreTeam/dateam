# 검증 결과

## v0.7.249 — 경쟁사 추출 전사기반 전환 (실제 화면 교정 — 둔갑·누락 박멸)
v0.7.247의 미해결분(화면 표시 아이템이 카탈로그매핑 classify.items에서 나와 B300→H100 둔갑·GB300/GB200 드롭) 근본 교정.
- **근본수정**: 표시 경쟁사 아이템 출처를 `classify.items` → **전사(verbatim) rows 기반 `transcriptionToCompetitorItems`** 로 전환(전사 성공 시). 카탈로그 매핑 완전 제거. 전사 실패 시만 폴백(회귀0).
- **reconcile**: 행수 → **distinct 모델 기준**(2가격/모델 전개로 누락 못잡던 것 교정).

**실경로 검증(화면에 가는 바로 그 변환, 실 Gemini, 2회 연속 PASS)**:
```
전사 9행 → 경쟁사 아이템 9건
- NVIDIA HGX B300  | 7.85  (원문 — H100 둔갑 0)
- NVIDIA HGX B200  | 7.15  (원문)
- NVIDIA GB300 NVL72 | 가격미상 (보존)
- NVIDIA GB200 NVL72 | 가격미상 (보존)
- H200/H100/RTX PRO 6000/L40S | 정상
판정: 8/8 원문표기 · B300/B200 보존 · H100 표기 1건(둔갑0) · GB300/GB200 price_unknown · 모델당 1행
```
> 지난 실수(단독 전사만 테스트) 교정: 이번엔 화면을 채우는 실제 변환함수 출력으로 검증. (참고: 전사는 Vision이라 잘린/저해상 이미지면 일부 누락 가능 — 깨끗한 전체 표는 9/9 일관)

- 단위 559/559 · tsc 0 · design:check ✅ · **next build 통과** · 🟥 DC-REV APPROVED(~93)
- 후속(LOW·비차단): parsePriceToken 비현실 대가 상한 가드

---

# (이전) 검증 결과 — 전사 우선 + 행수 대조 + 보존 (v0.7.247)

## 실 AI 파이프라인 검증 (결정적 — 실제 transcription.ts + 실 Gemini Vision)
`scripts/pipeline-test-nebius.ts` — 캡처한 Nebius GPU표(9행) 이미지를 실제 `buildTranscriptionPrompt()` + 실 Gemini로 전사 → `parseTranscription()`.

**결과: 9/9 누락 0** ✅
```
source_row_count = 9 | rows = 9
- "NVIDIA GB300 NVL72"        | (가격미상 — Contact us 보존)
- "NVIDIA HGX B300"           | $7.85
- "NVIDIA GB200 NVL72"        | (가격미상 — Contact us 보존)
- "NVIDIA HGX B200"           | $7.15
- "NVIDIA HGX H200"           | $4.50
- "NVIDIA HGX H100"           | $3.85
- "NVIDIA RTX PRO 6000"       | $1.80
- "NVIDIA L40S with Intel CPU"| from $1.82
- "NVIDIA L40S with AMD CPU"  | from $1.55
누락 모델: 없음 ✅ · 가격미상 보존: 2 (GB300, GB200) · reconcile: source9=extracted9 missing0
```

### 이전(v0.7.246) 대비
| 항목 | 이전 | 지금 |
|---|---|---|
| 추출 행수 | 4/9 (조용한 누락) | **9/9** |
| 모델명 | B300→"H100 80GB" 둔갑 | **"NVIDIA HGX B300" 원문** |
| 가격없는 행 | 통째 삭제 | **가격미상 보존** |
| 누락 감지 | 없음 | reconcile로 가시화 |

→ 사용자 핵심 요구("누락은 절대 안 됨")가 실 AI·실 이미지로 **충족**됨. 카탈로그 강제매핑 제거로 모델 오염도 동시 해결.

## 정적/단위 검증
- tsc 0 · 전체 테스트 **544/544** · design:check ✅
- 신규 단위테스트 24(transcription9/reconcile10/validate-preserve5)
- 🟥 DC-REV **93/100 APPROVED** · 🟥 DC-SEC **PASS**(CRITICAL0·HIGH0; USER_DATA 펜스·레이트리밋은 비차단 후속 권고)

## UI 라이브 렌더 — 한계 명시(정직)
헤드리스 E2E 세션에서 `/pricing/gpu`가 `/home`으로 리다이렉트(콘솔 에러 0, 본 변경의 라우팅 미변경 — throwaway 계정/세션 라우팅 이슈)되어 **라이브 화면 캡처는 미완**. FE 배선(누락 배너 `reconciliation.missing>0`, 가격미상 배지/자동반영 제외, 원문 병기)은 tsc·DC-REV 페이로드 라인대조·단위테스트로 검증.
→ 추출 정확도(핵심)는 실 AI로 결정적 증명. 라이브 UI 스크린샷은 환경 제약으로 후속.

## 후속(비차단)
- USER_DATA 프롬프트 인젝션 펜스 SSOT, 라우트 레이트리밋 (DC-SEC 권고)
- 전사 declared 과대보고 시 과경고 정책(현재는 안전측—과경고>침묵누락)
- market/refresh·비스트림 review의 로컬 fetchUrlText 표보존 SSOT 통일
