# 02 작업 분해

Phase1 ④검색: [DB trgm 인덱스 mig] → [BE /api/work/search] → [FE 검색창+결과] → 검증.
Phase2 ②릴레이션: [BE 역링크/행위자 resolve] → [FE 일일 뱃지+부서 원본/행위자] → 검증.
Phase3 ③그룹핑: [모델 결정] → [DB project] → [BE autolink매칭+overview축] → [FE 축 토글] → 검증.
Phase4: GATE1-5 + 최종 tsc/design.

각 Phase 종료 시 main 증분 커밋(버전 max+1 조율). DC-QA/SEC/REV 통과 후 다음 Phase.
