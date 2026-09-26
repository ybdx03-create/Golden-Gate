# Golden Gate 명명 및 설계 표준

## 공통

- 도메인 용어는 `instrument`, `sector`, `price_bar`, `analysis_run`, `recommendation`, `trade`, `journal_entry`, `knowledge_entry`를 사용한다. 같은 개념에 다른 이름을 붙이지 않는다.
- 내부 이름은 영어, UI 문구는 한국어로 쓴다. 모든 금액에 통화 코드를, 모든 데이터에 출처와 시각을 함께 보관한다.
- PostgreSQL 데이터베이스 이름 **"Golden Gate"**만 요청에 따른 예외다. SQL 식별자로 사용할 때 큰따옴표가 필요하다.

## 데이터베이스

- 스키마, 테이블, 컬럼, 인덱스와 제약 이름: 소문자 `snake_case`, 테이블은 복수형(`instruments`, `price_bars`).
- 기본 키 `id`(identity bigint), 외래 키 `<단수 엔티티>_id`, 날짜 `*_date`(date), 시각 `*_at`(timestamptz, UTC 저장).
- 통화 금액 `*_amount` numeric(20,6)와 별도 `currency_code` char(3). 비율은 `*_ratio`, 퍼센트 포인트는 `*_pct`.
- 인덱스 `idx_<table>_<columns>`, 유니크 `uq_<table>_<columns>`, 체크 `ck_<table>_<purpose>`, 외래 키 `fk_<table>_<target>`.
- 외부 데이터에는 `source_name`, `source_url`(가능할 때), `observed_at`(시장 데이터 시점), `ingested_at`(저장 시점)을 둔다. 분석 당시 자료를 나중에 덮어쓰지 않는다.
- 마이그레이션은 `db/migrations/NNNN_description.sql` 형태로 증가한다.

## API와 코드

- API는 `/api/v1/<plural-resource>`를 사용한다. JSON 필드는 `camelCase`; DB 매핑은 서버 계층에서 수행한다.
- TypeScript 변수·함수는 `camelCase`, 타입·React 컴포넌트는 `PascalCase`, 파일은 `kebab-case.ts(x)`.
- 서버는 `server/<domain>.ts`, UI 컴포넌트는 `src/components/<name>.tsx`로 둔다. 비즈니스 계산은 순수 함수로 분리한다.
- 오류는 `{ error: { code, message } }`로 반환한다. 입력은 Zod로 검증한다.

## UI/UX

- 디자인 토큰은 CSS 변수 `--color-*`, `--space-*`, `--radius-*`로 관리한다. 상태는 색만으로 구별하지 않고 텍스트를 병기한다.
- 데이터가 없거나 지연되면 빈 상태 및 마지막 갱신 시각을 보인다. 관측·추정·의견을 명시적으로 구별한다.
- 금액은 통화 코드와 천 단위 구분, 시각은 `Asia/Shanghai`와 `America/New_York`를 명기한다. 손익은 수수료 및 FX 반영 여부를 표시한다.
- 키보드 사용, 명시적인 폼 레이블, 충분한 대비, 모바일 1열 레이아웃을 기본으로 한다.

## 의사결정 원칙

- 추천은 자동 주문이 아니다. 매수·매도 후보의 근거, 반대 근거, 데이터 시점, 무효화 조건을 같이 보여 준다.
- 목표 수익은 추적 지표일 뿐 모델의 점수나 위험 한도를 변경하지 않는다. 데이터가 부족하면 `INSUFFICIENT_DATA`를 반환한다.
