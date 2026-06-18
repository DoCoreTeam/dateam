# 01 — Architecture

## 핵심 결정: 단일 드롭존 + 종류별 자동 라우팅 + multipart

### 라우팅 SSOT — `lib/gpu/intake-routing.ts`
순수함수. UI/서버 양쪽이 import.
```
INTAKE_LIMITS = { MAX_STREAM_FILE: 4 * 1024*1024, MAX_CATALOG_FILE: 5*1024*1024, IMG_DOWNSCALE_OVER: 1.2*1024*1024 }
ACCEPT_ALL = '.txt,.csv,.md,.json,.png,.jpg,.jpeg,.webp,.pdf,.xlsx,.xls'
classifyFile(file) -> { route: 'stream' | 'catalog' | 'text', kind: 'image'|'pdf'|'spreadsheet'|'text' }
  - image/* → stream(image)         (다운스케일 대상)
  - application/pdf → stream(pdf)
  - .xlsx/.xls → catalog(spreadsheet)
  - .csv/.txt/.md/.json/text/* → text (textarea로 읽어들임; CSV는 csv-intake로도 가능)
```
이유: 종류 판별이 UI·서버 두 곳에 필요 → 복붙 금지(재사용·단일구현 정책).

### 이미지 다운스케일 — `lib/gpu/image-downscale.ts`
canvas로 최대변 ~2000px·JPEG q0.85 재인코딩. base64 +33%와 원본 용량 동시 완화 → 폰 스크린샷 사실상 항상 한도 내.

### 전송 계층 변경
- 기존: `POST /review/stream` JSON `{text, images:[{data(base64), mimeType}]}` → **4.5MB 한도**.
- 신규: `POST /review/stream` `multipart/form-data` `{ text, channel, is_test, files: File[] }`.
  - 서버: `req.headers.content-type` 분기 — `multipart/*`면 `req.formData()`로 파싱 후 각 File→`inlineData{data:base64,mimeType}` 변환(서버에서 base64 인코딩). 아니면 기존 JSON 경로(back-compat).
  - **효과**: 요청 바디는 raw 바이너리(인플레 0). 4.5MB 한도 대비 실효 천장 ~3.3MB→~4.4MB. 이미지는 다운스케일로 거의 항상 통과.
- 큰 파일: `classifyFile`가 MAX 초과 판정 시 업로드 안 하고 UI 안내(R5).

### 프론트 단일 드롭존 (QuoteRegisterTab)
- 드롭존 1개: textarea(붙여넣기/URL) + 파일첨부(accept=ACCEPT_ALL) + 드래그앤드롭.
- 첨부/드롭 파일을 `classifyFile`로 분기:
  - stream(image/pdf): `pendingStreamFiles`에 모음 → "AI 분석 시작" 시 multipart 전송.
  - catalog(spreadsheet): 자동으로 catalog 흡수 호출(기존 CatalogUploadSection 로직 재사용 — 컴포넌트는 내부 흡수, 시각 분리 섹션 제거).
  - text/csv: textarea에 적재(기존), CSV는 "표 감지" 시 csv-intake 인라인 처리 옵션.
- 별도 ②③ 시각 섹션 제거 → 단일 블록. 기능(특히 xlsx 흡수, csv 흡수)은 유지.
- "지원 형식" 배지 → 정보성(클릭 불가임을 명확히, 탭 오인 제거).

## SSOT/표준 준수
- 라우팅·다운스케일 = lib 단일구현. 색/치수 토큰. input-field/label. 디자인 가드 통과.

## 미래(비범위)
- >4.4MB 파일: Supabase Storage 서명URL 직업로드 → 경로만 서버 전달 → 서버 fetch. 별도 스프린트.
