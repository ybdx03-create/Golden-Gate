import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  Database,
  FileText,
  Filter,
  History,
  LayoutDashboard,
  Menu,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react';
import './styles.css';
import {
  RecommendationOutcomes,
  FundamentalsForm,
  JournalOutcomeEditor,
  KnowledgeEditor,
} from './components/learning';

type Recommendation = {
  id: number;
  symbol: string;
  companyName: string;
  sectorName: string | null;
  actionCode: string;
  score: number | null;
  momentum20dPct: number | null;
  volumeRatio: number | null;
  flowProxyRatio: number | null;
  thesis: string;
  counterThesis: string;
  invalidation: string;
  dataAsOfDate: string | null;
  modelVersion: string;
  runAt: string;
};
type Instrument = {
  id: number;
  symbol: string;
  companyName: string;
  sectorName: string | null;
  priceDate: string | null;
  closeAmount: number | null;
  priceSource: string | null;
};
type Holding = {
  symbol: string;
  companyName: string;
  quantity: number;
  costBasisHkd: number;
  marketValueHkd: number | null;
  unrealizedPnlHkd: number | null;
  priceDate: string | null;
};
type Portfolio = {
  initialCashHkd: number;
  cashHkd: number;
  realizedPnlHkd: number;
  equityHkd: number | null;
  totalPnlHkd: number | null;
  fxRate: { hkdPerUsd: number; rateDate: string; sourceName: string } | null;
  holdings: Holding[];
};
type Dashboard = {
  schedule: {
    nextOpenAt: string;
    nextOpenShanghai: string;
    nextOpenNewYork: string;
    calendarNote: string;
  };
  instruments: Instrument[];
  recommendations: Recommendation[];
  portfolio: Portfolio;
  journalCount: number;
  knowledgeCount: number;
  dataPolicy: string;
};
type Journal = {
  id: number;
  entryDate: string;
  title: string;
  observation: string;
  hypothesis: string;
  decision: string;
  outcome: string | null;
  lesson: string | null;
  relatedSymbol: string | null;
};
type Knowledge = {
  id: number;
  title: string;
  body: string;
  evidenceType: 'FACT' | 'INFERENCE' | 'HYPOTHESIS';
  sourceUrl: string | null;
  relatedSymbol: string | null;
  createdAt: string;
};
type Trade = {
  id: number;
  symbol: string;
  sideCode: 'BUY' | 'SELL';
  quantity: number;
  priceAmount: number;
  feeAmount: number;
  fxHkdPerUsd: number;
  executedAt: string;
  note: string | null;
};
type Tab = 'overview' | 'market' | 'portfolio' | 'journal' | 'knowledge' | 'data';

const API = '/api/v1';
const TARGET_HKD = 5_000_000;
async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(API + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message ?? `서버 오류 (${response.status})`);
  return body as T;
}
const money = (value: number | null | undefined, currency = 'HKD') =>
  value == null
    ? '—'
    : new Intl.NumberFormat('ko-KR', {
        style: 'currency',
        currency,
        maximumFractionDigits: 0,
      }).format(value);
const number = (value: number | null | undefined, digits = 1) =>
  value == null
    ? '—'
    : new Intl.NumberFormat('ko-KR', { maximumFractionDigits: digits }).format(value);
const dateToday = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
const actionLabel: Record<string, string> = {
  BUY_CANDIDATE: '매수 후보',
  HOLD: '보유 관찰',
  REDUCE: '축소 검토',
  WATCH: '관망',
  INSUFFICIENT_DATA: '데이터 부족',
};
const nav: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'overview', label: '오늘의 브리핑', icon: LayoutDashboard },
  { id: 'market', label: '시장과 종목', icon: Activity },
  { id: 'portfolio', label: '포트폴리오', icon: Wallet },
  { id: 'journal', label: '투자 일지', icon: History },
  { id: 'knowledge', label: '지식 라이브러리', icon: BookOpen },
  { id: 'data', label: '데이터 관리', icon: Database },
];
function Empty({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: React.ElementType;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon size={23} />
      </div>
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  );
}
function Pill({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'positive' | 'negative' | 'warning';
}) {
  return <span className={`pill pill-${tone}`}>{label}</span>;
}
function App() {
  const [tab, setTab] = useState<Tab>('overview');
  const [mobileNav, setMobileNav] = useState(false);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [journal, setJournal] = useState<Journal[]>([]);
  const [knowledge, setKnowledge] = useState<Knowledge[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<Recommendation | null>(null);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  async function load() {
    setLoading(true);
    try {
      const [d, j, k, t] = await Promise.all([
        api<Dashboard>('/dashboard'),
        api<Journal[]>('/journal-entries'),
        api<Knowledge[]>('/knowledge-entries'),
        api<Trade[]>('/trades'),
      ]);
      setDashboard(d);
      setJournal(j);
      setKnowledge(k);
      setTrades(t);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '데이터를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function submit(path: string, payload: unknown, success: string) {
    setBusy(true);
    setNotice('');
    try {
      await api(path, { method: 'POST', body: JSON.stringify(payload) });
      setNotice(success);
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : '요청이 실패했습니다.');
    } finally {
      setBusy(false);
    }
  }
  async function runAnalysis() {
    await submit('/analysis-runs', {}, '분석을 완료했습니다. 데이터 시점을 확인하세요.');
  }
  const recs = dashboard?.recommendations ?? [];
  const sectors = useMemo(() => {
    const groups = new Map<
      string,
      { scores: number[]; flows: number[]; count: number; positive: number }
    >();
    for (const r of recs) {
      if (r.score == null) continue;
      const name = r.sectorName ?? '미분류';
      const g = groups.get(name) ?? { scores: [], flows: [], count: 0, positive: 0 };
      g.scores.push(r.score);
      if (r.flowProxyRatio != null) g.flows.push(r.flowProxyRatio);
      g.count++;
      if ((r.momentum20dPct ?? 0) > 0) g.positive++;
      groups.set(name, g);
    }
    return [...groups]
      .map(([name, g]) => ({
        name,
        score: g.scores.reduce((a, b) => a + b, 0) / g.count,
        flow: g.flows.length ? g.flows.reduce((a, b) => a + b, 0) / g.flows.length : null,
        count: g.count,
        positive: g.positive,
      }))
      .sort((a, b) => (b.flow ?? 0) - (a.flow ?? 0));
  }, [recs]);
  const portfolio = dashboard?.portfolio;
  const pageTitle = nav.find((item) => item.id === tab)?.label ?? '';
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-mark">
            <span>G</span>
            <span className="brand-slash">/</span>
            <span>G</span>
          </div>
          <div>
            <strong>GOLDEN GATE</strong>
            <small>INVESTMENT INTELLIGENCE</small>
          </div>
          <button
            className="mobile-close"
            aria-label="메뉴 닫기"
            onClick={() => setMobileNav(false)}
          >
            <X size={18} />
          </button>
        </div>
        <div className="sidebar-section-label">WORKSPACE</div>
        <nav aria-label="주 메뉴">
          {nav.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${tab === item.id ? 'active' : ''}`}
              onClick={() => {
                setTab(item.id);
                setMobileNav(false);
              }}
            >
              <item.icon size={18} />
              <span>{item.label}</span>
              {tab === item.id && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-insight">
            <Sparkles size={17} />
            <span>
              기록이 쌓일수록
              <br />
              판단이 선명해집니다.
            </span>
          </div>
          <div className="account">
            <div className="avatar">GG</div>
            <div>
              <strong>내 투자 워크스페이스</strong>
              <small>로컬 데이터 · HKD 기준</small>
            </div>
          </div>
        </div>
      </aside>
      {mobileNav && (
        <button
          className="mobile-backdrop"
          aria-label="메뉴 닫기"
          onClick={() => setMobileNav(false)}
        />
      )}
      <main className="main-content">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="mobile-menu"
              aria-label="메뉴 열기"
              onClick={() => setMobileNav(true)}
            >
              <Menu size={22} />
            </button>
            <div className="breadcrumb">
              WORKSPACE <span>/</span> <strong>{pageTitle}</strong>
            </div>
          </div>
          <div className="topbar-right">
            <div className={`connection ${error ? 'offline' : 'online'}`}>
              <span />
              {error ? '연결 확인 필요' : '로컬 데이터베이스'}
            </div>
            <button
              className="icon-button"
              title="새로고침"
              aria-label="새로고침"
              onClick={() => void load()}
            >
              <RefreshCw size={17} />
            </button>
            <div className="top-avatar">GG</div>
          </div>
        </header>
        <div className="content-wrap">
          {notice && (
            <div className="notice">
              <Check size={16} />
              <span>{notice}</span>
              <button aria-label="알림 닫기" onClick={() => setNotice('')}>
                <X size={15} />
              </button>
            </div>
          )}
          {error && (
            <div className="warning-banner">
              <ShieldAlert size={18} />
              <div>
                <strong>PostgreSQL 연결을 확인하세요</strong>
                <span>
                  {error} · .env의 DATABASE_URL과 npm run db:setup을 확인하면 실데이터 화면이
                  열립니다.
                </span>
              </div>
            </div>
          )}
          {tab === 'overview' && (
            <>
              <div className="page-head">
                <div>
                  <div className="eyebrow">
                    <span className="eyebrow-line" /> DAILY INTELLIGENCE{' '}
                    <span className="eyebrow-date">
                      {new Intl.DateTimeFormat('ko-KR', {
                        dateStyle: 'full',
                        timeZone: 'Asia/Shanghai',
                      }).format(new Date())}
                    </span>
                  </div>
                  <h1>
                    오늘의 시장을 <em>명확하게.</em>
                  </h1>
                  <p>시장 데이터와 투자 기록을 한곳에서 살펴보고, 근거 있는 결정을 준비하세요.</p>
                </div>
                <button
                  className="primary-button"
                  disabled={busy || !!error}
                  onClick={() => void runAnalysis()}
                >
                  <Sparkles size={17} />
                  {busy ? '분석 중…' : '오늘의 분석 실행'}
                  <ArrowRight size={16} />
                </button>
              </div>
              <div className="schedule-strip">
                <div className="schedule-icon">
                  <Clock3 size={19} />
                </div>
                <div className="schedule-main">
                  <span>다음 미국 정규장 개장</span>
                  <strong>
                    {dashboard?.schedule.nextOpenShanghai ?? '연결 후 표시'}{' '}
                    <small>중국 시간</small>
                  </strong>
                </div>
                <div className="schedule-side">
                  <span>뉴욕 시간</span>
                  <strong>{dashboard?.schedule.nextOpenNewYork ?? '—'}</strong>
                </div>
                <Pill label="일봉 기반 분석" tone="warning" />
              </div>
              <div className="metric-grid">
                <Metric
                  icon={Wallet}
                  label="평가 자산"
                  value={money(portfolio?.equityHkd)}
                  sub={portfolio?.equityHkd == null ? '시세·환율 입력 후 계산' : '현금 + 평가액'}
                />
                <Metric
                  icon={TrendingUp}
                  label="누적 손익"
                  value={money(portfolio?.totalPnlHkd)}
                  sub={
                    portfolio?.totalPnlHkd == null
                      ? '평가에 필요한 데이터 없음'
                      : `실현 손익 ${money(portfolio?.realizedPnlHkd)}`
                  }
                  trend={portfolio?.totalPnlHkd}
                />
                <Metric
                  icon={Activity}
                  label="분석된 종목"
                  value={`${recs.filter((r) => r.score != null).length}개`}
                  sub={`관심 종목 ${dashboard?.instruments.length ?? 0}개`}
                />
                <Metric
                  icon={BookOpen}
                  label="축적된 지식"
                  value={`${dashboard?.knowledgeCount ?? 0}개`}
                  sub={`투자 일지 ${dashboard?.journalCount ?? 0}건`}
                />
              </div>
              <div className="goal-strip">
                <div>
                  <span className="goal-kicker">ONE YEAR GOAL</span>
                  <strong>
                    {money(portfolio?.equityHkd)} <small>/ {money(TARGET_HKD)}</small>
                  </strong>
                  <p>현재 평가 자산 기준 진행률 · 목표가 위험 한도를 변경하지 않습니다.</p>
                </div>
                <div className="goal-right">
                  <strong>
                    {portfolio?.equityHkd == null
                      ? '—'
                      : `${number(Math.min(100, (portfolio.equityHkd / TARGET_HKD) * 100), 2)}%`}
                  </strong>
                  <div className="goal-track">
                    <span
                      style={{
                        width: `${portfolio?.equityHkd == null ? 0 : Math.min(100, Math.max(0, (portfolio.equityHkd / TARGET_HKD) * 100))}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
              <div className="content-grid">
                <section className="panel recommendations-panel">
                  <PanelHead
                    kicker="THE SHORTLIST"
                    title="최신 투자 후보"
                    extra={
                      <button className="text-button" onClick={() => setTab('market')}>
                        전체 보기 <ArrowRight size={15} />
                      </button>
                    }
                  />
                  <div className="panel-subtitle">
                    규칙 기반 후보 분류 · 투자 결정 전 근거와 반대 근거를 확인하세요
                  </div>
                  {recs.length ? (
                    <div className="recommendation-list">
                      {recs.slice(0, 5).map((r) => (
                        <RecommendationRow key={r.id} item={r} onClick={() => setSelected(r)} />
                      ))}
                    </div>
                  ) : (
                    <Empty
                      icon={Sparkles}
                      title="아직 분석 결과가 없습니다"
                      body="관심 종목과 일봉 21개 이상을 등록한 뒤 분석을 실행하세요."
                      action={
                        <button className="secondary-button" onClick={() => setTab('data')}>
                          데이터 등록 <ArrowRight size={15} />
                        </button>
                      }
                    />
                  )}
                </section>
                <section className="panel sector-panel">
                  <PanelHead
                    kicker="CAPITAL ROTATION"
                    title="산업별 거래대금 변화"
                    extra={<Filter size={17} className="muted-icon" />}
                  />
                  <div className="panel-subtitle">
                    관심 종목의 거래대금 배율 · 기관 자금 유입 확정 지표 아님
                  </div>
                  {sectors.length ? (
                    <div className="sector-list">
                      {sectors.slice(0, 6).map((s, i) => (
                        <div className="sector-row" key={s.name}>
                          <div className="sector-line">
                            <div>
                              <span className="sector-rank">{String(i + 1).padStart(2, '0')}</span>
                              <strong>{s.name}</strong>
                            </div>
                            <span>
                              {number(s.score, 0)} <small>/ 100</small>
                            </span>
                          </div>
                          <div className="score-track">
                            <div style={{ width: `${s.score}%` }} />
                          </div>
                          <div className="sector-foot">
                            분석 {s.count}개 종목 · 거래대금{' '}
                            {s.flow == null ? '—' : `${number(s.flow, 2)}배`}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Empty
                      icon={Activity}
                      title="산업 분석 대기 중"
                      body="종목과 가격 데이터가 쌓이면 산업별 강도가 나타납니다."
                    />
                  )}
                </section>
              </div>
              <div className="bottom-grid">
                <section className="panel journal-preview">
                  <PanelHead
                    kicker="LEARNING LOOP"
                    title="최근 투자 기록"
                    extra={
                      <button className="text-button" onClick={() => setTab('journal')}>
                        일지 보기 <ArrowRight size={15} />
                      </button>
                    }
                  />
                  {journal.length ? (
                    <div className="journal-mini-list">
                      {journal.slice(0, 3).map((j) => (
                        <div className="journal-mini" key={j.id}>
                          <div className="journal-mini-icon">
                            <FileText size={17} />
                          </div>
                          <div>
                            <strong>{j.title}</strong>
                            <span>
                              {j.entryDate} {j.relatedSymbol && `· ${j.relatedSymbol}`}
                            </span>
                          </div>
                          <ArrowRight size={15} />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Empty
                      icon={FileText}
                      title="첫 투자 일지를 써보세요"
                      body="관찰과 가설, 결정을 기록하면 이후 결과와 비교할 수 있습니다."
                      action={
                        <button className="secondary-button" onClick={() => setTab('journal')}>
                          일지 작성 <Plus size={15} />
                        </button>
                      }
                    />
                  )}
                </section>
                <section className="philosophy-card">
                  <div className="philosophy-orbit">
                    <div>GG</div>
                  </div>
                  <span className="philosophy-kicker">OUR APPROACH</span>
                  <h2>
                    예측보다 중요한 건<br />
                    <em>검증 가능한 판단.</em>
                  </h2>
                  <p>
                    무엇을 보았고, 왜 결정했으며, 실제로 어떤 결과가 났는지. Golden Gate는 모든 투자
                    과정을 연결합니다.
                  </p>
                  <button onClick={() => setTab('knowledge')}>
                    지식 라이브러리 보기 <ArrowRight size={16} />
                  </button>
                </section>
              </div>
            </>
          )}
          {tab === 'market' && (
            <>
              <PageIntro
                eyebrow="MARKET INTELLIGENCE"
                title="시장과 종목"
                body="종목의 관측 데이터, 모델 판단, 반대 근거를 함께 확인합니다."
              />
              <div className="disclosure">
                <ShieldAlert size={18} />
                <span>
                  이 화면은 과거 일봉 분석입니다. 프리마켓 호가나 실제 기관 순매수 데이터가
                  아닙니다.
                </span>
              </div>
              <section className="panel">
                <PanelHead
                  kicker="WATCHLIST"
                  title="관심 종목"
                  extra={
                    <button className="secondary-button compact" onClick={() => setTab('data')}>
                      <Plus size={15} /> 종목 추가
                    </button>
                  }
                />
                {dashboard?.instruments.length ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>종목</th>
                          <th>산업</th>
                          <th>최근 종가</th>
                          <th>데이터 날짜</th>
                          <th>출처</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dashboard.instruments.map((i) => (
                          <tr key={i.id}>
                            <td>
                              <strong className="ticker">{i.symbol}</strong>
                              <span className="company">{i.companyName}</span>
                            </td>
                            <td>{i.sectorName ?? '—'}</td>
                            <td>{money(i.closeAmount, 'USD')}</td>
                            <td>{i.priceDate ?? '—'}</td>
                            <td>{i.priceSource ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty
                    icon={Search}
                    title="등록된 종목이 없습니다"
                    body="먼저 관심 종목을 추가하세요."
                  />
                )}
              </section>
              <section className="panel spaced-panel">
                <PanelHead
                  kicker="MODEL OUTPUT"
                  title="분석 결과"
                  extra={
                    <button
                      className="secondary-button compact"
                      disabled={busy || !!error}
                      onClick={() => void runAnalysis()}
                    >
                      <RefreshCw size={15} /> 재분석
                    </button>
                  }
                />
                {recs.length ? (
                  <div className="recommendation-list">
                    {recs.map((r) => (
                      <RecommendationRow key={r.id} item={r} onClick={() => setSelected(r)} />
                    ))}
                  </div>
                ) : (
                  <Empty
                    icon={Activity}
                    title="분석 결과가 없습니다"
                    body="일봉 21개 이상을 등록하고 분석을 실행하세요."
                  />
                )}
              </section>
              <RecommendationOutcomes />
            </>
          )}
          {tab === 'portfolio' && (
            <>
              <PageIntro
                eyebrow="YOUR CAPITAL"
                title="포트폴리오"
                body="체결 기록과 FIFO 원가를 바탕으로 HKD 손익을 계산합니다."
              />
              <div className="metric-grid three">
                <Metric
                  icon={Wallet}
                  label="현금 잔액"
                  value={money(portfolio?.cashHkd)}
                  sub="초기 현금 50,000 HKD"
                />
                <Metric
                  icon={TrendingUp}
                  label="실현 손익"
                  value={money(portfolio?.realizedPnlHkd)}
                  sub="매도 체결 · 수수료·체결 FX 반영"
                  trend={portfolio?.realizedPnlHkd}
                />
                <Metric
                  icon={Activity}
                  label="평가 자산"
                  value={money(portfolio?.equityHkd)}
                  sub={
                    portfolio?.fxRate
                      ? `환율 ${portfolio.fxRate.rateDate} · ${portfolio.fxRate.sourceName}`
                      : '최신 환율을 입력하세요'
                  }
                />
              </div>
              <div className="two-column">
                <section className="panel">
                  <PanelHead kicker="POSITIONS" title="보유 종목" />
                  {portfolio?.holdings.length ? (
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>종목</th>
                            <th>수량</th>
                            <th>원가 HKD</th>
                            <th>평가액 HKD</th>
                            <th>평가 손익</th>
                          </tr>
                        </thead>
                        <tbody>
                          {portfolio.holdings.map((h) => (
                            <tr key={h.symbol}>
                              <td>
                                <strong className="ticker">{h.symbol}</strong>
                              </td>
                              <td>{number(h.quantity, 4)}</td>
                              <td>{money(h.costBasisHkd)}</td>
                              <td>{money(h.marketValueHkd)}</td>
                              <td
                                className={(h.unrealizedPnlHkd ?? 0) >= 0 ? 'positive' : 'negative'}
                              >
                                {money(h.unrealizedPnlHkd)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <Empty
                      icon={Wallet}
                      title="보유 종목이 없습니다"
                      body="매수 체결을 기록하면 포지션이 나타납니다."
                    />
                  )}
                </section>
                <TradeForm
                  instruments={dashboard?.instruments ?? []}
                  busy={busy}
                  onSubmit={(v) => void submit('/trades', v, '체결을 기록했습니다.')}
                />
              </div>
              <section className="panel spaced-panel">
                <PanelHead kicker="EXECUTION HISTORY" title="거래 이력" />
                {trades.length ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>체결 시각</th>
                          <th>종목</th>
                          <th>방향</th>
                          <th>수량</th>
                          <th>가격</th>
                          <th>체결 FX</th>
                        </tr>
                      </thead>
                      <tbody>
                        {trades.map((t) => (
                          <tr key={t.id}>
                            <td>
                              {new Date(t.executedAt).toLocaleString('ko-KR', {
                                timeZone: 'Asia/Shanghai',
                              })}
                            </td>
                            <td className="ticker">{t.symbol}</td>
                            <td>
                              <Pill
                                label={t.sideCode === 'BUY' ? '매수' : '매도'}
                                tone={t.sideCode === 'BUY' ? 'positive' : 'negative'}
                              />
                            </td>
                            <td>{number(t.quantity, 4)}</td>
                            <td>{money(t.priceAmount, 'USD')}</td>
                            <td>{number(t.fxHkdPerUsd, 4)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty
                    icon={History}
                    title="거래 이력이 없습니다"
                    body="실제 체결만 직접 기록해 주세요. 이 앱은 주문을 실행하지 않습니다."
                  />
                )}
              </section>
            </>
          )}
          {tab === 'journal' && (
            <>
              <PageIntro
                eyebrow="DECISION JOURNAL"
                title="투자 일지"
                body="관찰 → 가설 → 결정 → 결과를 분리해 기록하고 사후에 검증합니다."
              />
              <div className="two-column">
                <section className="panel">
                  <PanelHead kicker="YOUR ENTRIES" title="기록 목록" />
                  {journal.length ? (
                    <div className="entry-list">
                      {journal.map((j) => (
                        <article className="entry-card" key={j.id}>
                          <div className="entry-meta">
                            <CalendarDays size={14} />
                            {j.entryDate}
                            {j.relatedSymbol && <Pill label={j.relatedSymbol} />}
                          </div>
                          <h3>{j.title}</h3>
                          <div className="entry-field">
                            <small>관찰</small>
                            <p>{j.observation}</p>
                          </div>
                          <div className="entry-field">
                            <small>가설</small>
                            <p>{j.hypothesis}</p>
                          </div>
                          <div className="entry-field">
                            <small>결정</small>
                            <p>{j.decision}</p>
                          </div>
                          {j.outcome && (
                            <div className="entry-field">
                              <small>결과</small>
                              <p>{j.outcome}</p>
                            </div>
                          )}
                          {j.lesson && (
                            <div className="entry-field">
                              <small>배운 점</small>
                              <p>{j.lesson}</p>
                            </div>
                          )}
                          <JournalOutcomeEditor entry={j} onSaved={() => void load()} />
                        </article>
                      ))}
                    </div>
                  ) : (
                    <Empty
                      icon={FileText}
                      title="아직 기록이 없습니다"
                      body="첫 투자 가설을 남기고 나중에 결과와 비교해 보세요."
                    />
                  )}
                </section>
                <JournalForm
                  busy={busy}
                  onSubmit={(v) => void submit('/journal-entries', v, '투자 일지를 저장했습니다.')}
                />
              </div>
            </>
          )}
          {tab === 'knowledge' && (
            <>
              <PageIntro
                eyebrow="COMPOUNDING INSIGHT"
                title="지식 라이브러리"
                body="확인된 사실, 해석, 미검증 가설을 구분해 축적합니다."
              />
              <div className="two-column">
                <section className="panel">
                  <PanelHead kicker="RESEARCH NOTES" title="지식 목록" />
                  <div className="search-field">
                    <Search size={17} />
                    <input
                      aria-label="지식 검색"
                      placeholder="제목 또는 내용 검색"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                  {knowledge.filter((k) =>
                    (k.title + ' ' + k.body).toLowerCase().includes(search.toLowerCase()),
                  ).length ? (
                    <div className="knowledge-list">
                      {knowledge
                        .filter((k) =>
                          (k.title + ' ' + k.body).toLowerCase().includes(search.toLowerCase()),
                        )
                        .map((k) => (
                          <article className="knowledge-card" key={k.id}>
                            <div className="knowledge-top">
                              <Pill
                                label={
                                  k.evidenceType === 'FACT'
                                    ? '확인된 사실'
                                    : k.evidenceType === 'INFERENCE'
                                      ? '해석'
                                      : '미검증 가설'
                                }
                                tone={
                                  k.evidenceType === 'FACT'
                                    ? 'positive'
                                    : k.evidenceType === 'HYPOTHESIS'
                                      ? 'warning'
                                      : 'neutral'
                                }
                              />
                              {k.relatedSymbol && <span className="ticker">{k.relatedSymbol}</span>}
                            </div>
                            <h3>{k.title}</h3>
                            <p>{k.body}</p>
                            {k.sourceUrl && (
                              <a href={k.sourceUrl} target="_blank" rel="noreferrer">
                                근거 자료 열기 <ArrowRight size={13} />
                              </a>
                            )}
                            <KnowledgeEditor entry={k} onSaved={() => void load()} />
                          </article>
                        ))}
                    </div>
                  ) : (
                    <Empty
                      icon={BookOpen}
                      title="축적된 지식이 없습니다"
                      body="투자에서 배운 점과 출처를 기록해 보세요."
                    />
                  )}
                </section>
                <KnowledgeForm
                  busy={busy}
                  onSubmit={(v) =>
                    void submit('/knowledge-entries', v, '지식 항목을 저장했습니다.')
                  }
                />
              </div>
            </>
          )}
          {tab === 'data' && (
            <>
              <PageIntro
                eyebrow="DATA OPERATIONS"
                title="데이터 관리"
                body="출처가 확인된 데이터만 가져오고, 갱신 시각을 항상 확인하세요."
              />
              <div className="disclosure">
                <Database size={18} />
                <span>
                  Alpha Vantage 연동은 과거 일봉만 수집합니다. 무료 요금제의 호출 제한과 데이터
                  지연을 확인하세요.
                </span>
              </div>
              <div className="data-grid">
                <InstrumentForm
                  busy={busy}
                  onSubmit={(v) => void submit('/instruments', v, '관심 종목을 저장했습니다.')}
                />
                <SyncForm
                  instruments={dashboard?.instruments ?? []}
                  busy={busy}
                  onSubmit={(v) => void submit('/data/sync', v, '과거 일봉을 가져왔습니다.')}
                />
                <FxForm
                  busy={busy}
                  onSubmit={(v) => void submit('/fx-rates', v, '환율을 저장했습니다.')}
                />
                <FundamentalsForm
                  instruments={dashboard?.instruments ?? []}
                  busy={busy}
                  onSubmit={(v) => void submit('/fundamentals', v, '재무 지표를 저장했습니다.')}
                />
              </div>
              <CsvForm
                busy={busy}
                onSubmit={(v) => void submit('/price-bars/import', v, 'CSV 일봉을 저장했습니다.')}
              />
            </>
          )}
        </div>
      </main>
      {selected && (
        <div className="modal-backdrop" onMouseDown={() => setSelected(null)}>
          <div
            className="detail-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`${selected.symbol} 분석 상세`}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="modal-top">
              <div>
                <span className="modal-kicker">RESEARCH BRIEF / {selected.modelVersion}</span>
                <h2>
                  {selected.symbol} <small>{selected.companyName}</small>
                </h2>
              </div>
              <button className="icon-button" aria-label="닫기" onClick={() => setSelected(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-stats">
              <div>
                <small>모델 판단</small>
                <Pill
                  label={actionLabel[selected.actionCode] ?? selected.actionCode}
                  tone={
                    selected.actionCode === 'BUY_CANDIDATE'
                      ? 'positive'
                      : selected.actionCode === 'REDUCE'
                        ? 'negative'
                        : 'neutral'
                  }
                />
              </div>
              <div>
                <small>점수</small>
                <strong>
                  {selected.score == null ? '—' : `${number(selected.score, 0)} / 100`}
                </strong>
              </div>
              <div>
                <small>20일 수익률</small>
                <strong>
                  {selected.momentum20dPct == null ? '—' : `${number(selected.momentum20dPct)}%`}
                </strong>
              </div>
              <div>
                <small>거래대금 배율 (대용)</small>
                <strong>
                  {selected.flowProxyRatio == null
                    ? '—'
                    : `${number(selected.flowProxyRatio, 2)}배`}
                </strong>
              </div>
              <div>
                <small>데이터 기준일</small>
                <strong>{selected.dataAsOfDate ?? '—'}</strong>
              </div>
            </div>
            <div className="detail-section">
              <span className="detail-label positive">01 / 판단 근거</span>
              <p>{selected.thesis}</p>
            </div>
            <div className="detail-section">
              <span className="detail-label warning">02 / 반대 근거와 한계</span>
              <p>{selected.counterThesis}</p>
            </div>
            <div className="detail-section">
              <span className="detail-label">03 / 가설 무효화</span>
              <p>{selected.invalidation}</p>
            </div>
            <div className="modal-note">
              <ShieldAlert size={16} />
              확률 예측 또는 자동 주문이 아닙니다. 데이터와 실제 시장 상태를 확인한 뒤 직접
              결정하세요.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
function Metric({
  icon: Icon,
  label,
  value,
  sub,
  trend,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub: string;
  trend?: number | null;
}) {
  return (
    <div className="metric-card">
      <div className="metric-top">
        <span>{label}</span>
        <div className="metric-icon">
          <Icon size={18} />
        </div>
      </div>
      <strong>{value}</strong>
      <div className="metric-foot">
        {trend != null &&
          (trend >= 0 ? (
            <ArrowUpRight size={15} className="positive" />
          ) : (
            <ArrowDownRight size={15} className="negative" />
          ))}
        <span>{sub}</span>
      </div>
    </div>
  );
}
function PanelHead({
  kicker,
  title,
  extra,
}: {
  kicker: string;
  title: string;
  extra?: React.ReactNode;
}) {
  return (
    <div className="panel-head">
      <div>
        <span className="panel-kicker">{kicker}</span>
        <h2>{title}</h2>
      </div>
      {extra}
    </div>
  );
}
function PageIntro({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return (
    <div className="page-intro">
      <span className="eyebrow">
        <span className="eyebrow-line" />
        {eyebrow}
      </span>
      <h1>{title}</h1>
      <p>{body}</p>
    </div>
  );
}
function RecommendationRow({ item, onClick }: { item: Recommendation; onClick: () => void }) {
  const tone =
    item.actionCode === 'BUY_CANDIDATE'
      ? 'positive'
      : item.actionCode === 'REDUCE'
        ? 'negative'
        : item.actionCode === 'INSUFFICIENT_DATA'
          ? 'warning'
          : 'neutral';
  return (
    <button className="recommendation-row" onClick={onClick}>
      <div className="ticker-icon">{item.symbol.slice(0, 2)}</div>
      <div className="rec-name">
        <strong>
          {item.symbol}
          <span>{item.companyName}</span>
        </strong>
        <small>
          {item.sectorName ?? '미분류'} · {item.dataAsOfDate ?? '기준일 없음'}
        </small>
      </div>
      <div className="rec-momentum">
        <span>20일 추세</span>
        <strong className={(item.momentum20dPct ?? 0) >= 0 ? 'positive' : 'negative'}>
          {item.momentum20dPct == null
            ? '—'
            : `${item.momentum20dPct >= 0 ? '+' : ''}${number(item.momentum20dPct)}%`}
        </strong>
      </div>
      <Pill label={actionLabel[item.actionCode] ?? item.actionCode} tone={tone} />
      <ArrowRight size={17} className="row-arrow" />
    </button>
  );
}
function FormPanel({
  kicker,
  title,
  children,
}: {
  kicker: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel form-panel">
      <PanelHead kicker={kicker} title={title} />
      {children}
    </section>
  );
}
function InstrumentForm({ busy, onSubmit }: { busy: boolean; onSubmit: (v: unknown) => void }) {
  const [symbol, setSymbol] = useState(''),
    [name, setName] = useState(''),
    [sector, setSector] = useState('');
  return (
    <FormPanel kicker="WATCHLIST" title="관심 종목 등록">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit({ symbol, companyName: name, sectorName: sector });
        }}
      >
        <label>
          종목 코드
          <input
            required
            placeholder="예: AAPL"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          />
        </label>
        <label>
          회사명
          <input
            required
            placeholder="회사명"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          산업 분류
          <input
            required
            placeholder="예: 반도체"
            value={sector}
            onChange={(e) => setSector(e.target.value)}
          />
        </label>
        <button className="primary-button full" disabled={busy}>
          종목 저장 <ArrowRight size={16} />
        </button>
      </form>
    </FormPanel>
  );
}
function SyncForm({
  instruments,
  busy,
  onSubmit,
}: {
  instruments: Instrument[];
  busy: boolean;
  onSubmit: (v: unknown) => void;
}) {
  const [symbol, setSymbol] = useState('');
  return (
    <FormPanel kicker="HISTORICAL DATA" title="일봉 가져오기">
      <p className="form-hint">
        .env에 Alpha Vantage API 키가 있을 때 최대 최근 100개 일봉을 가져옵니다.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit({ symbol });
        }}
      >
        <label>
          등록된 종목
          <select required value={symbol} onChange={(e) => setSymbol(e.target.value)}>
            <option value="">종목 선택</option>
            {instruments.map((i) => (
              <option key={i.id} value={i.symbol}>
                {i.symbol} · {i.companyName}
              </option>
            ))}
          </select>
        </label>
        <button className="secondary-button full" disabled={busy || !symbol}>
          <RefreshCw size={16} /> 과거 일봉 동기화
        </button>
      </form>
    </FormPanel>
  );
}
function FxForm({ busy, onSubmit }: { busy: boolean; onSubmit: (v: unknown) => void }) {
  const [date, setDate] = useState(dateToday()),
    [rate, setRate] = useState(''),
    [source, setSource] = useState('수동 입력');
  return (
    <FormPanel kicker="CURRENCY" title="USD/HKD 환율">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit({ rateDate: date, hkdPerUsd: rate, sourceName: source });
        }}
      >
        <label>
          기준일
          <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          1 USD당 HKD
          <input
            type="number"
            step="0.000001"
            min="0.000001"
            required
            placeholder="직접 확인한 환율"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
        </label>
        <label>
          출처
          <input required value={source} onChange={(e) => setSource(e.target.value)} />
        </label>
        <button className="secondary-button full" disabled={busy}>
          환율 저장 <ArrowRight size={16} />
        </button>
      </form>
    </FormPanel>
  );
}
function CsvForm({ busy, onSubmit }: { busy: boolean; onSubmit: (v: unknown) => void }) {
  const [csv, setCsv] = useState('');
  const [parseError, setParseError] = useState('');
  function handle(e: React.FormEvent) {
    e.preventDefault();
    try {
      const lines = csv.trim().split(/\r?\n/);
      const header = lines.shift()?.toLowerCase().replace(/\s/g, '');
      if (header !== 'symbol,date,open,high,low,close,volume')
        throw new Error('첫 줄은 symbol,date,open,high,low,close,volume 이어야 합니다.');
      const rows = lines.map((line) => {
        const [symbol, priceDate, openAmount, highAmount, lowAmount, closeAmount, volumeShares] =
          line.split(',').map((v) => v.trim());
        if (!volumeShares) throw new Error('CSV 열이 부족합니다.');
        return { symbol, priceDate, openAmount, highAmount, lowAmount, closeAmount, volumeShares };
      });
      if (!rows.length) throw new Error('데이터 행이 없습니다.');
      setParseError('');
      onSubmit(rows);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'CSV 형식을 확인하세요.');
    }
  }
  return (
    <FormPanel kicker="MANUAL IMPORT" title="CSV 일봉 가져오기">
      <p className="form-hint">
        헤더: symbol,date,open,high,low,close,volume. 직접 확인한 과거 일봉만 입력하세요.
      </p>
      <form onSubmit={handle}>
        <label>
          CSV 내용
          <textarea
            rows={7}
            placeholder={
              'symbol,date,open,high,low,close,volume\nAAPL,2026-09-25,100,103,99,102,1000000'
            }
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
          />
        </label>
        {parseError && <span className="form-error">{parseError}</span>}
        <button className="secondary-button" disabled={busy || !csv.trim()}>
          CSV 저장 <ArrowRight size={16} />
        </button>
      </form>
    </FormPanel>
  );
}
function TradeForm({
  instruments,
  busy,
  onSubmit,
}: {
  instruments: Instrument[];
  busy: boolean;
  onSubmit: (v: unknown) => void;
}) {
  const [symbol, setSymbol] = useState(''),
    [side, setSide] = useState<'BUY' | 'SELL'>('BUY'),
    [quantity, setQuantity] = useState(''),
    [price, setPrice] = useState(''),
    [fee, setFee] = useState('0'),
    [fx, setFx] = useState('');
  return (
    <FormPanel kicker="MANUAL EXECUTION" title="체결 기록">
      <p className="form-hint">주문은 실행되지 않습니다. 실제 브로커 체결 내역만 기록하세요.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit({
            symbol,
            sideCode: side,
            quantity,
            priceAmount: price,
            feeAmount: fee,
            fxHkdPerUsd: fx,
            executedAt: new Date().toISOString(),
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
          방향
          <select value={side} onChange={(e) => setSide(e.target.value as 'BUY' | 'SELL')}>
            <option value="BUY">매수</option>
            <option value="SELL">매도</option>
          </select>
        </label>
        <div className="form-pair">
          <label>
            수량
            <input
              type="number"
              min="0.000001"
              step="0.000001"
              required
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </label>
          <label>
            주당 가격 USD
            <input
              type="number"
              min="0.000001"
              step="0.000001"
              required
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </label>
        </div>
        <div className="form-pair">
          <label>
            수수료 USD
            <input
              type="number"
              min="0"
              step="0.000001"
              required
              value={fee}
              onChange={(e) => setFee(e.target.value)}
            />
          </label>
          <label>
            체결 FX (HKD/USD)
            <input
              type="number"
              min="0.000001"
              step="0.000001"
              required
              value={fx}
              onChange={(e) => setFx(e.target.value)}
            />
          </label>
        </div>
        <button className="primary-button full" disabled={busy}>
          체결 저장 <ArrowRight size={16} />
        </button>
      </form>
    </FormPanel>
  );
}
function JournalForm({ busy, onSubmit }: { busy: boolean; onSubmit: (v: unknown) => void }) {
  const [date, setDate] = useState(dateToday()),
    [title, setTitle] = useState(''),
    [observation, setObservation] = useState(''),
    [hypothesis, setHypothesis] = useState(''),
    [decision, setDecision] = useState(''),
    [outcome, setOutcome] = useState(''),
    [lesson, setLesson] = useState(''),
    [symbol, setSymbol] = useState('');
  return (
    <FormPanel kicker="NEW ENTRY" title="오늘의 판단 기록">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit({
            entryDate: date,
            title,
            observation,
            hypothesis,
            decision,
            outcome,
            lesson,
            relatedSymbol: symbol || undefined,
          });
        }}
      >
        <label>
          날짜
          <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          제목
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="오늘의 핵심 판단"
          />
        </label>
        <label>
          관련 종목 (선택)
          <input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            placeholder="예: NVDA"
          />
        </label>
        <label>
          관찰한 사실
          <textarea
            required
            rows={3}
            value={observation}
            onChange={(e) => setObservation(e.target.value)}
          />
        </label>
        <label>
          투자 가설
          <textarea
            required
            rows={3}
            value={hypothesis}
            onChange={(e) => setHypothesis(e.target.value)}
          />
        </label>
        <label>
          내 결정
          <textarea
            required
            rows={3}
            value={decision}
            onChange={(e) => setDecision(e.target.value)}
          />
        </label>
        <label>
          결과 (선택)
          <textarea rows={2} value={outcome} onChange={(e) => setOutcome(e.target.value)} />
        </label>
        <label>
          배운 점 (선택)
          <textarea rows={2} value={lesson} onChange={(e) => setLesson(e.target.value)} />
        </label>
        <button className="primary-button full" disabled={busy}>
          일지 저장 <ArrowRight size={16} />
        </button>
      </form>
    </FormPanel>
  );
}
function KnowledgeForm({ busy, onSubmit }: { busy: boolean; onSubmit: (v: unknown) => void }) {
  const [title, setTitle] = useState(''),
    [body, setBody] = useState(''),
    [type, setType] = useState<'FACT' | 'INFERENCE' | 'HYPOTHESIS'>('HYPOTHESIS'),
    [source, setSource] = useState(''),
    [symbol, setSymbol] = useState('');
  return (
    <FormPanel kicker="NEW INSIGHT" title="지식 추가">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit({
            title,
            body,
            evidenceType: type,
            sourceUrl: source || undefined,
            relatedSymbol: symbol || undefined,
          });
        }}
      >
        <label>
          제목
          <input required value={title} onChange={(e) => setTitle(e.target.value)} />
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
          <textarea required rows={7} value={body} onChange={(e) => setBody(e.target.value)} />
        </label>
        <label>
          출처 URL (선택)
          <input type="url" value={source} onChange={(e) => setSource(e.target.value)} />
        </label>
        <label>
          관련 종목 (선택)
          <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
        </label>
        <button className="primary-button full" disabled={busy}>
          지식 저장 <ArrowRight size={16} />
        </button>
      </form>
    </FormPanel>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
