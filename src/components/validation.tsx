import { useEffect, useState } from 'react';
import {
  Activity,
  AlertCircle,
  ArrowRight,
  FlaskConical,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';

type Sample = {
  tradeCount: number;
  winRatePct: number | null;
  averageNetTradeReturnPct: number | null;
  periodReturnPct?: number | null;
};
type Backtest = {
  id: number;
  createdAt?: string;
  status: string;
  reason?: string;
  dataStartDate: string | null;
  dataEndDate: string | null;
  splitDate?: string;
  parameters: {
    feeBps: number;
    slippageBps: number;
    positionPct: number;
    holdingTradingDays: number;
  };
  netReturnPct?: number;
  maxDrawdownPct?: number;
  development?: Sample;
  holdout?: Sample;
  limitations?: string[];
  trades?: {
    symbol: string;
    entryDate: string;
    exitDate: string;
    netReturnPct: number;
    sample: string;
  }[];
};
type RiskDashboard = {
  policy: {
    maxSinglePositionPct: number;
    maxSectorExposurePct: number;
    minCashPct: number;
    maxDailyLossPct: number;
    maxDrawdownPct: number;
  };
  positions: { symbol: string; exposurePct: number | null }[];
  sectorExposures: { name: string; exposurePct: number }[];
  cashPct: number | null;
  flags: { code: string; message: string }[];
  measurementStatus: string;
  dailyLossStatus: string;
  drawdownStatus: string;
};
async function request(path: string, method: 'GET' | 'POST' | 'PUT' = 'GET', body?: unknown) {
  const res = await fetch('/api/v1' + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message ?? '요청 실패');
  return data;
}
const pct = (value: number | null | undefined) =>
  value == null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
export function ValidationPanel() {
  const [result, setResult] = useState<Backtest | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  useEffect(() => {
    request('/backtest-runs/latest')
      .then(setResult)
      .catch(() => {});
  }, []);
  async function run() {
    setBusy(true);
    try {
      setResult(
        await request('/backtest-runs', 'POST', {
          feeBps: 10,
          slippageBps: 10,
          positionPct: 10,
          holdingTradingDays: 5,
        }),
      );
      setMessage('시간 순서 검증을 완료했습니다. 아래 한계를 함께 확인하세요.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '검증 실패');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel spaced-panel">
      <div className="panel-head">
        <div>
          <span className="panel-kicker">HISTORICAL VALIDATION</span>
          <h2>퀀트 모델 과거 검증</h2>
        </div>
        <button className="secondary-button compact" disabled={busy} onClick={() => void run()}>
          <FlaskConical size={15} />
          {busy ? '검증 중…' : '검증 실행'}
        </button>
      </div>
      <p className="panel-subtitle">
        신호 전 21개 일봉만 사용해 다음 개장가에 진입하고 5거래일 보유합니다. 거래당 자본 10%, 왕복
        수수료·슬리피지 각각 10bp/측을 가정합니다.
      </p>
      {message && <p className="inline-message">{message}</p>}
      {!result ? (
        <div className="empty compact-empty">
          <div className="empty-icon">
            <FlaskConical size={21} />
          </div>
          <h3>검증 기록이 없습니다</h3>
          <p>최소 60개 완료된 일봉이 있어야 실행할 수 있습니다.</p>
        </div>
      ) : result.status !== 'COMPLETED' ? (
        <div className="validation-empty">
          <AlertCircle size={17} />
          {result.reason}
        </div>
      ) : (
        <>
          <div className="validation-meta">
            데이터 {result.dataStartDate} ~ {result.dataEndDate} · 보류 구간 시작 {result.splitDate}
          </div>
          <div className="validation-metrics">
            <div>
              <span>전체 가상 순수익</span>
              <strong className={(result.netReturnPct ?? 0) >= 0 ? 'positive' : 'negative'}>
                {pct(result.netReturnPct)}
              </strong>
            </div>
            <div>
              <span>최대 평가 낙폭</span>
              <strong>{pct(result.maxDrawdownPct)}</strong>
            </div>
            <div>
              <span>보류 구간 거래</span>
              <strong>{result.holdout?.tradeCount ?? 0}건</strong>
            </div>
            <div>
              <span>보류 구간 승률</span>
              <strong>{pct(result.holdout?.winRatePct)}</strong>
            </div>
          </div>
          <div className="validation-split">
            <div>
              <span>개발 구간</span>
              <strong>{result.development?.tradeCount ?? 0}건</strong>
              <small>거래 평균 {pct(result.development?.averageNetTradeReturnPct)}</small>
            </div>
            <ArrowRight size={18} />
            <div>
              <span>시간 순서 보류 구간</span>
              <strong>{result.holdout?.tradeCount ?? 0}건</strong>
              <small>구간 수익 {pct(result.holdout?.periodReturnPct)}</small>
            </div>
          </div>
          <ul className="limitation-list">
            {result.limitations?.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          {result.trades?.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>종목</th>
                    <th>진입일</th>
                    <th>청산일</th>
                    <th>구간</th>
                    <th>가상 순수익</th>
                  </tr>
                </thead>
                <tbody>
                  {result.trades
                    .slice(-10)
                    .reverse()
                    .map((trade, i) => (
                      <tr key={i}>
                        <td className="ticker">{trade.symbol}</td>
                        <td>{trade.entryDate}</td>
                        <td>{trade.exitDate}</td>
                        <td>{trade.sample === 'holdout' ? '보류' : '개발'}</td>
                        <td className={trade.netReturnPct >= 0 ? 'positive' : 'negative'}>
                          {pct(trade.netReturnPct)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
export function RiskPanel() {
  const [data, setData] = useState<RiskDashboard | null>(null),
    [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [form, setForm] = useState<RiskDashboard['policy'] | null>(null);
  useEffect(() => {
    request('/risk-dashboard')
      .then((r: RiskDashboard) => {
        setData(r);
        setForm(r.policy);
      })
      .catch(() => {});
  }, []);
  async function save() {
    if (!form) return;
    setBusy(true);
    try {
      const result = (await request('/risk-policy', 'PUT', form)) as RiskDashboard;
      setData(result);
      setForm(result.policy);
      setEditing(false);
      setMessage('위험 한도를 저장했습니다. 자동 주문에는 연결되지 않습니다.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '저장 실패');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel spaced-panel">
      <div className="panel-head">
        <div>
          <span className="panel-kicker">CAPITAL PROTECTION</span>
          <h2>위험 관리</h2>
        </div>
        <button className="secondary-button compact" onClick={() => setEditing(!editing)}>
          <ShieldCheck size={15} />
          {editing ? '닫기' : '한도 설정'}
        </button>
      </div>
      <p className="panel-subtitle">
        목표 수익과 관계없이 설정한 한도를 기준으로 현재 보유 비중을 점검합니다. 주문을 자동으로
        막거나 실행하지 않습니다.
      </p>
      {message && <p className="inline-message">{message}</p>}
      {data?.flags.length ? (
        <div className="risk-flags">
          {data.flags.map((flag) => (
            <div key={flag.code}>
              <AlertCircle size={16} />
              {flag.message}
            </div>
          ))}
        </div>
      ) : (
        <div className="risk-clear">
          <ShieldCheck size={17} />
          {data?.measurementStatus === 'CURRENT_VALUATION'
            ? '현재 측정 가능한 비중에서 초과 항목이 없습니다.'
            : '가격 또는 환율이 오래되어 현재 비중을 계산할 수 없습니다.'}
        </div>
      )}
      {data && (
        <div className="risk-grid">
          <div>
            <span>단일 종목 최대</span>
            <strong>{data.policy.maxSinglePositionPct}%</strong>
          </div>
          <div>
            <span>산업 비중 최대</span>
            <strong>{data.policy.maxSectorExposurePct}%</strong>
          </div>
          <div>
            <span>최소 현금 비중</span>
            <strong>{data.policy.minCashPct}%</strong>
          </div>
          <div>
            <span>현재 현금 비중</span>
            <strong>{data.cashPct == null ? '—' : `${data.cashPct.toFixed(2)}%`}</strong>
          </div>
        </div>
      )}
      <p className="risk-note">
        일일 손실과 고점 대비 낙폭은 일별 평가 자산 스냅샷이 없어 아직 측정할 수 없습니다. 설정값을
        표시하더라도 준수 여부를 확정하지 않습니다.
      </p>
      {editing && form && (
        <div className="risk-form">
          <div className="form-pair">
            <label>
              단일 종목 최대 %
              <input
                type="number"
                min="1"
                max="100"
                value={form.maxSinglePositionPct}
                onChange={(e) => setForm({ ...form, maxSinglePositionPct: Number(e.target.value) })}
              />
            </label>
            <label>
              산업 비중 최대 %
              <input
                type="number"
                min="1"
                max="100"
                value={form.maxSectorExposurePct}
                onChange={(e) => setForm({ ...form, maxSectorExposurePct: Number(e.target.value) })}
              />
            </label>
          </div>
          <div className="form-pair">
            <label>
              최소 현금 비중 %
              <input
                type="number"
                min="0"
                max="100"
                value={form.minCashPct}
                onChange={(e) => setForm({ ...form, minCashPct: Number(e.target.value) })}
              />
            </label>
            <label>
              일일 손실 한도 %
              <input
                type="number"
                min="0.1"
                max="100"
                step="0.1"
                value={form.maxDailyLossPct}
                onChange={(e) => setForm({ ...form, maxDailyLossPct: Number(e.target.value) })}
              />
            </label>
          </div>
          <label>
            최대 낙폭 한도 %
            <input
              type="number"
              min="0.1"
              max="100"
              step="0.1"
              value={form.maxDrawdownPct}
              onChange={(e) => setForm({ ...form, maxDrawdownPct: Number(e.target.value) })}
            />
          </label>
          <button className="primary-button" disabled={busy} onClick={() => void save()}>
            <RefreshCw size={15} /> 저장
          </button>
        </div>
      )}
    </section>
  );
}
