# Golden Gate

미국 주식의 개장 전 리서치, 규칙 기반 후보 분류, 실제 거래 기록, HKD 손익 계산, 투자 가설의 사후 검증과 지식 축적을 위한 **로컬 웹 워크스페이스**입니다. 주문을 전송하지 않습니다.

## 지금 가능한 일

- 관심 종목·산업 등록, CSV 일봉 입력 또는 Alpha Vantage 과거 일봉 동기화
- 매출 성장률, 순이익률, PER과 출처 입력
- 20거래일 가격·거래량·거래대금 대용 지표를 바탕으로 매수 후보/보유 관찰/축소 검토/관망 분류
- 기준일·근거·반대 근거·무효화 조건을 포함한 분석 실행 기록
- 추천 후 1·5·20거래일 원시 종가 수익률 사후 검증
- 시간 순서 보류 구간, 거래 비용, 슬리피지를 반영한 연구용 백테스트
- 단일 종목·산업 집중도 및 현금 비중 위험 한도
- 체결 기록, FIFO 원가, 수수료와 체결 환율을 반영한 HKD 실현 손익
- 최신 일봉 및 환율이 있을 때만 평가 자산 표시; 7일 이상 오래된 데이터로는 평가하지 않음
- 관찰→가설→결정→결과 일지와 버전 이력을 가진 지식 라이브러리
- 뉴욕 거래 시간 기준 다음 개장 시각 표시와 거래일 08:45 ET의 자동 분석

## 실행

요구 사항: Node.js 22+, npm, PostgreSQL 18(다른 지원 버전도 가능). macOS에서 Xcode 라이선스 경고가 뜨면 사용자가 `sudo xcodebuild -license`를 실행해 동의하거나 `DEVELOPER_DIR=/Library/Developer/CommandLineTools`를 Git 명령 앞에 지정해야 합니다.

```bash
npm install
cp .env.example .env
# .env의 DATABASE_URL을 로컬 PostgreSQL 계정에 맞게 편집
npm run db:setup
npm run dev
```

브라우저: http://127.0.0.1:5173

API: http://127.0.0.1:8787/api/v1/health

DB 이름은 정확히 `"Golden Gate"`입니다. 연결 URL에서는 공백을 `%20`으로 인코딩합니다. `db:setup`을 다시 실행하면 이미 적용된 마이그레이션을 건너뜁니다. `.env`는 Git에서 제외됩니다.

### 데이터 등록 순서

1. **데이터 관리**에서 종목과 산업을 등록합니다.
2. 확인한 출처의 일봉 CSV를 붙여넣거나 `.env`에 `ALPHA_VANTAGE_API_KEY`를 설정해 종목별 과거 일봉을 동기화합니다. CSV 헤더는 `symbol,date,open,high,low,close,volume`입니다.
3. 회사 공시 등의 재무 수치와 출처를 입력합니다. 입력하지 않은 지표는 분석에서 제외됩니다.
4. **오늘의 분석 실행**을 누릅니다. 21개 이상의 완료된 일봉이 없으면 추천 대신 데이터 부족을 표시합니다.
5. 실제 브로커 체결을 포트폴리오에 기록합니다. 투자 일지에 당시 가설을 남기고 결과가 나온 뒤 사후 결과를 추가합니다.
6. 새로운 일봉이 쌓이면 시장과 종목 화면에서 추천 결과를 갱신합니다.

Alpha Vantage 일별 API는 최근 100개 일봉의 `compact` 모드를 사용합니다. 무료 API 호출 수는 공급자 정책에 따르며, 실시간 및 15분 지연 미국 주식 데이터는 별도 유료 권한이 필요할 수 있습니다. [공식 API 문서](https://www.alphavantage.co/documentation/), [공식 지원 안내](https://www.alphavantage.co/support/)

## 명명 및 구조

[명명·설계 표준](docs/standards/naming.md), [아키텍처와 데이터 한계](docs/architecture.md), [모델과 검증 방법](docs/model.md)을 참고하세요.

- `server/`: Express API, 분석 및 포트폴리오 계산
- `src/`: React 화면과 디자인 시스템
- `db/migrations/`: PostgreSQL 스키마와 버전 변경
- `scripts/setup-db.mjs`: 정확한 DB 이름 생성 및 마이그레이션
- `scripts/smoke-test.mjs`: 별도 임시 DB를 이용한 통합 검증

## 주요 API

| 기능                | 경로                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 상태·대시보드       | `GET /api/v1/health`, `GET /api/v1/dashboard`                                                                             |
| 종목·일봉·재무·환율 | `POST /api/v1/instruments`, `/price-bars/import`, `/fundamentals`, `/fx-rates`                                            |
| 과거 일봉 동기화    | `POST /api/v1/data/sync`                                                                                                  |
| 분석·추천           | `POST /api/v1/analysis-runs`, `GET /api/v1/recommendations`                                                               |
| 백테스트·위험 한도  | `GET /api/v1/backtest-runs/latest`, `POST /api/v1/backtest-runs`, `GET /api/v1/risk-dashboard`, `PUT /api/v1/risk-policy` |
| 추천 사후 검증      | `POST /api/v1/recommendation-outcomes/evaluate`, `GET /api/v1/recommendation-outcomes`                                    |
| 거래·포트폴리오     | `POST /api/v1/trades`, `GET /api/v1/trades`, `/portfolio`                                                                 |
| 투자 일지           | `GET/POST /api/v1/journal-entries`, `PATCH /api/v1/journal-entries/:id`                                                   |
| 지식                | `GET/POST /api/v1/knowledge-entries`, `PATCH /api/v1/knowledge-entries/:id`                                               |

## 검증

```bash
npm run build
npm test
npm run test:integration
```

통합 테스트는 독립된 임시 PostgreSQL DB를 만들고 종료할 때 제거합니다. 실계좌 데이터는 건드리지 않습니다.

## 한계와 다음 단계

이 버전은 **과거 일봉 규칙 모델**이며 당일 상승·하락 확률을 검증된 확률로 제시하지 않습니다. 거래대금 변화는 자금 흐름의 대용 지표일 뿐 기관 매매의 증거가 아닙니다. 현재 재무 데이터는 수동 입력이고, 뉴스·실시간 프리마켓 호가·브로커 자동 연동은 없습니다. 원시 종가 수익률 사후 평가는 배당·분할·거래 비용·환율을 제외하므로 실제 계좌 성과와 별개입니다. 최신 데이터는 UI에 기준일을 표시하며 7일 이상 오래된 가격·환율로 포트폴리오를 평가하지 않습니다.

거래 달력은 통상 NYSE 휴장일 규칙을 계산하지만 임시 휴장과 조기 폐장을 자동 반영하지 못합니다. 정규 개장 시각은 NYSE 기준 09:30 ET이며 중국 시간으로 미국 서머타임 중 21:30, 표준시 중 22:30입니다. [NYSE 거래 시간 및 휴장일](https://www.nyse.com/trade/hours-calendars)

실전 운용 전에는 라이선스가 맞는 실시간 데이터, 공식 캘린더, 기업 공시의 시점별 수집, 배당·분할 조정, 거래 비용을 포함한 백테스트와 워크포워드 검증, 일일 평가 자산 스냅샷을 이용한 손실·낙폭 측정, 계좌·사용자 인증을 추가해야 합니다. 현재 서버는 `127.0.0.1`에만 바인딩됩니다. 50,000 HKD → 5,000,000 HKD 목표는 추적용이며 분석 점수나 위험 한도를 높이는 데 쓰지 않습니다.
