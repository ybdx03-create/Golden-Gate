# API 규약

- 기본 경로 `/api/v1`, 자원명은 영어 복수형 kebab-case, JSON 필드는 camelCase다.
- 성공: 조회 200, 생성 201. 입력 오류 400, 존재하지 않는 항목 404, DB 연결 실패 503.
- 오류 본문은 `{ "error": { "code": "UPPER_SNAKE_CASE", "message": "읽기 쉬운 설명" } }`이다.
- 날짜는 ISO `YYYY-MM-DD`, 시각은 오프셋이 포함된 ISO 8601, 금액은 JSON number로 전달한다. 저장은 PostgreSQL numeric이다.
- 목록은 현재 최대 100건(일봉 일괄 입력은 1,000건). 확장 시 `cursor` 기반 페이지네이션을 적용한다.
- 서버는 로컬 인터페이스에만 바인딩되며 외부 공개용 인증이 아직 없다.
