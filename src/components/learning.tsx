import { useEffect, useState } from 'react';
import { ArrowRight, Check, History, RefreshCw } from 'lucide-react';

type Outcome = {
  id: number;
  symbol: string;
  actionCode: string;
  horizonTradingDays: number;
  rawReturnPct: number;
  dataAsOfDate: string;
  outcomePriceDate: string;
};
type Journal = { id: number; outcome: string | null; lesson: string | null };
type Knowledge = {
  id: number;
  title: string;
  body: string;
  evidenceType: 'FACT' | 'INFERENCE' | 'HYPOTHESIS';
  sourceUrl: string | null;
};
type Instrument = { id: number; symbol: string; companyName: string };
const base = '/api/v1';
async function request(path: string, method: 'GET' | 'POST' | 'PATCH' = 'GET', body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message ?? '요청 실패');
  return data;
}
export function RecommendationOutcomes() {
  const [rows, setRows] = useState<Outcome[]>([]),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  useEffect(() => {
    request('/recommendation-outcomes')
      .then(setRows)
      .catch(() => {});
  }, []);
  async function evaluate() {
    setBusy(true);
    try {
      const result = await request('/recommendation-outcomes/evaluate', 'POST');
      setRows(await request('/recommendation-outcomes'));
      setMessage(`${result.evaluated}개 평가를 갱신했습니다.`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '평가 실패');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel spaced-panel">
      <div className="panel-head">
        <div>
          <span className="panel-kicker">AFTER THE CALL</span>
          <h2>추천 사후 검증</h2>
        </div>
        <button
          className="secondary-button compact"
          disabled={busy}
          onClick={() => void evaluate()}
        >
          <RefreshCw size={15} /> 결과 갱신
        </button>
      </div>
      <p className="panel-subtitle">
        추천 기준 종가 이후 1·5·20거래일 원시 종가 수익률. 배당·분할·거래 비용·환율은 제외하며 실제
        계좌 손익이 아닙니다.
      </p>
      {message && <p className="inline-message">{message}</p>}
      {rows.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>종목</th>
                <th>판단</th>
                <th>기간</th>
                <th>기준일</th>
                <th>평가일</th>
                <th>원시 수익률</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="ticker">{r.symbol}</td>
                  <td>{r.actionCode}</td>
                  <td>{r.horizonTradingDays}거래일</td>
                  <td>{r.dataAsOfDate}</td>
                  <td>{r.outcomePriceDate}</td>
                  <td className={r.rawReturnPct >= 0 ? 'positive' : 'negative'}>
                    {r.rawReturnPct >= 0 ? '+' : ''}
                    {r.rawReturnPct.toFixed(2)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty compact-empty">
          <div className="empty-icon">
            <History size={22} />
          </div>
          <h3>평가할 후속 데이터가 없습니다</h3>
          <p>추천 이후 일봉이 쌓이면 결과를 갱신할 수 있습니다.</p>
        </div>
      )}
    </section>
  );
}
export function FundamentalsForm({
  instruments,
  busy,
  onSubmit,
}: {
  instruments: Instrument[];
  busy: boolean;
  onSubmit: (value: unknown) => void;
}) {
  const [symbol, setSymbol] = useState(''),
    [date, setDate] = useState(''),
    [growth, setGrowth] = useState(''),
    [margin, setMargin] = useState(''),
    [pe, setPe] = useState(''),
    [source, setSource] = useState(''),
    [url, setUrl] = useState('');
  return (
    <section className="panel form-panel">
      <div className="panel-head">
        <div>
          <span className="panel-kicker">COMPANY FUNDAMENTALS</span>
          <h2>성장·가치 지표</h2>
        </div>
      </div>
      <p className="form-hint">
        공시 또는 신뢰할 수 있는 출처의 기간별 수치만 입력하세요. 빈 지표는 분석에 사용하지
        않습니다.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit({
            symbol,
            periodEndDate: date,
            revenueGrowthYoyPct: growth || null,
            netMarginPct: margin || null,
            peRatio: pe || null,
            sourceName: source,
            sourceUrl: url || undefined,
          });
        }}
      >
        <label>
          종목
          <select required value={symbol} onChange={(e) => setSymbol(e.target.value)}>
            <option value="">종목 선택</option>
            {instruments.map((i) => (
              <option key={i.id} value={i.symbol}>
                {i.symbol}
              </option>
            ))}
          </select>
        </label>
        <label>
          재무 기준일
          <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <div className="form-pair">
          <label>
            매출 성장률 YoY %
            <input
              type="number"
              step="0.01"
              value={growth}
              onChange={(e) => setGrowth(e.target.value)}
            />
          </label>
          <label>
            순이익률 %
            <input
              type="number"
              step="0.01"
              value={margin}
              onChange={(e) => setMargin(e.target.value)}
            />
          </label>
        </div>
        <label>
          PER
          <input type="number" step="0.01" value={pe} onChange={(e) => setPe(e.target.value)} />
        </label>
        <label>
          출처 이름
          <input
            required
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="예: SEC 10-Q"
          />
        </label>
        <label>
          출처 URL
          <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} />
        </label>
        <button className="secondary-button full" disabled={busy}>
          재무 지표 저장 <ArrowRight size={16} />
        </button>
      </form>
    </section>
  );
}
export function JournalOutcomeEditor({ entry, onSaved }: { entry: Journal; onSaved: () => void }) {
  const [open, setOpen] = useState(false),
    [outcome, setOutcome] = useState(entry.outcome ?? ''),
    [lesson, setLesson] = useState(entry.lesson ?? ''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function save() {
    setBusy(true);
    try {
      await request(`/journal-entries/${entry.id}`, 'PATCH', { outcome, lesson });
      setOpen(false);
      setError('');
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장 실패');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="inline-editor">
      {!open ? (
        <button className="text-button" onClick={() => setOpen(true)}>
          {entry.outcome ? '결과 수정' : '사후 결과 기록'} <ArrowRight size={13} />
        </button>
      ) : (
        <div className="inline-editor-fields">
          <label>
            실제 결과
            <textarea rows={2} value={outcome} onChange={(e) => setOutcome(e.target.value)} />
          </label>
          <label>
            배운 점<textarea rows={2} value={lesson} onChange={(e) => setLesson(e.target.value)} />
          </label>
          {error && <span className="form-error">{error}</span>}
          <div>
            <button className="secondary-button compact" onClick={() => setOpen(false)}>
              취소
            </button>
            <button
              className="primary-button compact"
              disabled={busy || !outcome.trim() || !lesson.trim()}
              onClick={() => void save()}
            >
              <Check size={14} /> 저장
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
export function KnowledgeEditor({ entry, onSaved }: { entry: Knowledge; onSaved: () => void }) {
  const [open, setOpen] = useState(false),
    [title, setTitle] = useState(entry.title),
    [body, setBody] = useState(entry.body),
    [type, setType] = useState(entry.evidenceType),
    [source, setSource] = useState(entry.sourceUrl ?? ''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function save() {
    setBusy(true);
    try {
      await request(`/knowledge-entries/${entry.id}`, 'PATCH', {
        title,
        body,
        evidenceType: type,
        sourceUrl: source || null,
      });
      setOpen(false);
      setError('');
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장 실패');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="inline-editor">
      {!open ? (
        <button className="text-button" onClick={() => setOpen(true)}>
          지식 수정 <ArrowRight size={13} />
        </button>
      ) : (
        <div className="inline-editor-fields">
          <label>
            제목
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label>
            분류
            <select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              <option value="FACT">확인된 사실</option>
              <option value="INFERENCE">해석</option>
              <option value="HYPOTHESIS">미검증 가설</option>
            </select>
          </label>
          <label>
            내용
            <textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
          </label>
          <label>
            출처 URL
            <input type="url" value={source} onChange={(e) => setSource(e.target.value)} />
          </label>
          {error && <span className="form-error">{error}</span>}
          <div>
            <button className="secondary-button compact" onClick={() => setOpen(false)}>
              취소
            </button>
            <button
              className="primary-button compact"
              disabled={busy || !title.trim() || !body.trim()}
              onClick={() => void save()}
            >
              <Check size={14} /> 저장
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
