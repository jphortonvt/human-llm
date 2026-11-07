import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from '../hooks/useSession';
import {
  type ArchiveEntry,
  type BallotConfig,
  type CuratorSession,
  type Metrics,
  curatorApi,
} from '../lib/api';

type Tab = 'queue' | 'live' | 'tuning' | 'archive';

export function CuratorPage() {
  const [pw, setPw] = useState<string>(() => localStorage.getItem('hllm_pw') ?? '');
  const [authed, setAuthed] = useState(false);
  const [tab, setTab] = useState<Tab>('queue');
  const [err, setErr] = useState<string | null>(null);

  const tryAuth = useCallback(async (candidate: string) => {
    try {
      await curatorApi.listSessions(candidate);
      localStorage.setItem('hllm_pw', candidate);
      setPw(candidate);
      setAuthed(true);
      setErr(null);
    } catch {
      setErr('wrong password');
      setAuthed(false);
    }
  }, []);

  useEffect(() => {
    if (pw) tryAuth(pw);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!authed) {
    return (
      <div className="page">
        <div className="dim" style={{ marginBottom: 16 }}>curator</div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            tryAuth(pw);
          }}
        >
          <input
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="password"
            autoFocus
          />
        </form>
        {err && <div className="dim" style={{ marginTop: 12 }}>{err}</div>}
      </div>
    );
  }

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <div style={{ display: 'flex', gap: 24, marginBottom: 32 }}>
        {(['queue', 'live', 'tuning', 'archive'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{ opacity: tab === t ? 1 : 0.4 }}>
            {t}
          </button>
        ))}
      </div>
      {tab === 'queue' && <QueueTab pw={pw} />}
      {tab === 'live' && <LiveTab pw={pw} />}
      {tab === 'tuning' && <TuningTab pw={pw} />}
      {tab === 'archive' && <ArchiveTab pw={pw} />}
    </div>
  );
}

// ---- Queue ----

function QueueTab({ pw }: { pw: string }) {
  const [sessions, setSessions] = useState<CuratorSession[]>([]);
  const [prompt, setPrompt] = useState('');

  const load = useCallback(async () => {
    const r = await curatorApi.listSessions(pw);
    setSessions(r.sessions);
  }, [pw]);

  useEffect(() => {
    load();
  }, [load]);

  const add = async () => {
    if (!prompt.trim()) return;
    await curatorApi.createSession(pw, prompt.trim());
    setPrompt('');
    load();
  };

  const queued = sessions.filter((s) => s.status === 'queued');
  const active = sessions.find((s) => s.status === 'active');

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
        style={{ marginBottom: 28 }}
      >
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="new prompt — press enter to queue"
        />
      </form>

      {active && (
        <div style={{ marginBottom: 24 }}>
          <div className="dim">active</div>
          <div>{active.prompt}</div>
        </div>
      )}

      <div className="dim" style={{ marginBottom: 8 }}>queue ({queued.length})</div>
      {queued.length === 0 && <div className="dim">empty</div>}
      {queued.map((s, i) => (
        <div key={s.id} style={{ display: 'flex', gap: 16, padding: '4px 0' }}>
          <span className="dim">{i + 1}</span>
          <span style={{ flex: 1 }}>{s.prompt}</span>
          <button
            className="dim"
            onClick={async () => {
              await curatorApi.updateSession(pw, s.id, { queuePosition: s.queuePosition - 1.5 });
              load();
            }}
          >
            up
          </button>
          <button
            className="dim"
            onClick={async () => {
              await curatorApi.deleteSession(pw, s.id);
              load();
            }}
          >
            delete
          </button>
        </div>
      ))}
    </div>
  );
}

// ---- Live ----

function LiveTab({ pw }: { pw: string }) {
  const { detail, refresh } = useSession();
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  const sessionId = detail?.session?.id;
  useEffect(() => {
    const tick = () => curatorApi.metrics(pw, sessionId).then((r) => setMetrics(r.metrics)).catch(() => {});
    tick();
    const id = setInterval(tick, 10000);
    return () => clearInterval(id);
  }, [pw, sessionId]);

  if (!detail?.session) return <div className="dim">no active session</div>;
  const ballot = detail.currentBallot;

  return (
    <div>
      <div className="dim">prompt</div>
      <div style={{ marginBottom: 20 }}>{detail.session.prompt}</div>

      <div className="dim">response so far</div>
      <div style={{ marginBottom: 20 }}>{detail.lockedWords.map((w) => w.text).join(' ') || '—'}</div>

      {metrics && <MetricsRow metrics={metrics} />}

      {ballot ? (
        <div style={{ marginTop: 24 }}>
          <div className="dim">
            ballot {ballot.position} — {ballot.inRunoff ? 'runoff' : ballot.state} — {ballot.totalVotes} votes{' '}
            <button
              onClick={async () => {
                await curatorApi.closeBallot(pw, ballot.id);
                refresh();
              }}
            >
              [force close]
            </button>
          </div>
          <div style={{ marginTop: 12 }}>
            {ballot.candidates.map((c) => (
              <div key={c.wordId} style={{ display: 'flex', gap: 16, padding: '2px 0' }}>
                <span style={{ width: 160 }}>{c.text}</span>
                <span className="dim" style={{ width: 60 }}>{c.votes}</span>
                <button className="dim" onClick={async () => { await curatorApi.hideWord(pw, c.wordId, true); refresh(); }}>hide</button>
                <button className="dim" onClick={async () => { await curatorApi.closeBallot(pw, ballot.id, c.wordId); refresh(); }}>pick</button>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="dim" style={{ marginTop: 24 }}>no open ballot</div>
      )}

      {detail.provisionalBallot && (
        <div className="dim" style={{ marginTop: 20 }}>
          pre-staged: if "{detail.provisionalBallot.assumedWord}" wins → ballot {detail.provisionalBallot.position}
        </div>
      )}

      <div style={{ marginTop: 28 }}>
        <button
          className="dim"
          onClick={async () => {
            if (sessionId) await curatorApi.abandonSession(pw, sessionId);
            refresh();
          }}
        >
          abandon session
        </button>
      </div>
    </div>
  );
}

function MetricsRow({ metrics }: { metrics: Metrics }) {
  const color = (b: string) => (b === 'green' ? '#000' : b === 'amber' ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.25)');
  const fmt = (n: number | null, suffix = '') => (n == null ? '—' : `${Math.round(n * 10) / 10}${suffix}`);
  return (
    <div style={{ display: 'flex', gap: 28, fontSize: '0.9rem' }}>
      <span style={{ color: color(metrics.bands.avgVotesPerBallot) }}>
        {fmt(metrics.avgVotesPerBallot)} votes/ballot
      </span>
      <span style={{ color: color(metrics.bands.avgSecondsPerBallot) }}>
        {fmt(metrics.avgSecondsPerBallot, 's')}/ballot
      </span>
      <span style={{ color: color(metrics.bands.wordsPerHour) }}>{fmt(metrics.wordsPerHour)} words/hr</span>
      <span className="dim">{metrics.activeVoters} connected</span>
    </div>
  );
}

// ---- Tuning ----

const NUMERIC_FIELDS = [
  'temperature',
  'landslide_share',
  'landslide_min_votes',
  'confident_share',
  'confident_margin',
  'confident_min_votes',
  'max_votes',
  'soft_timeout_seconds',
  'min_votes_floor',
  'hard_timeout_seconds',
  'prestage_threshold',
  'max_tokens_per_session',
];
const BOOL_FIELDS = [
  'landslide_enabled',
  'confident_enabled',
  'max_votes_enabled',
  'soft_timeout_enabled',
  'hard_timeout_enabled',
  'prestage_enabled',
  'end_token_enabled',
  'paragraph_token_enabled',
];

function TuningTab({ pw }: { pw: string }) {
  const { detail } = useSession();
  const [config, setConfig] = useState<BallotConfig | null>(null);
  const [presets, setPresets] = useState<Record<string, { name: string; description: string; config: BallotConfig }>>({});
  const [saved, setSaved] = useState(false);

  const sessionId = detail?.session?.id;
  const sessionConfig = useMemo(() => detail?.session?.config ?? null, [detail]);

  useEffect(() => {
    if (sessionConfig && !config) setConfig({ ...sessionConfig });
  }, [sessionConfig, config]);
  useEffect(() => {
    curatorApi.presets(pw).then((r) => setPresets(r.presets)).catch(() => {});
  }, [pw]);

  if (!detail?.session) return <div className="dim">no active session to tune</div>;
  if (!config) return <div className="dim">loading config…</div>;

  const set = (k: string, v: number | boolean) => {
    setConfig({ ...config, [k]: v });
    setSaved(false);
  };

  const save = async () => {
    if (!sessionId) return;
    await curatorApi.putSessionConfig(pw, sessionId, config);
    setSaved(true);
  };

  return (
    <div>
      <div className="dim" style={{ marginBottom: 16 }}>
        changes apply to the next ballot, not the open one.
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
        {Object.entries(presets).map(([key, p]) => (
          <button key={key} className="dim" title={p.description} onClick={() => { setConfig({ ...p.config }); setSaved(false); }}>
            [{p.name}]
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '240px 130px', rowGap: 6, columnGap: 24, alignItems: 'center' }}>
        {NUMERIC_FIELDS.map((f) => (
          <Fragment2 key={f}>
            <label className="dim">{f}</label>
            <input
              type="text"
              value={String(config[f] ?? '')}
              onChange={(e) => set(f, Number(e.target.value))}
            />
          </Fragment2>
        ))}
        {BOOL_FIELDS.map((f) => (
          <Fragment2 key={f}>
            <label className="dim">{f}</label>
            <button onClick={() => set(f, !config[f])}>{config[f] ? 'on' : 'off'}</button>
          </Fragment2>
        ))}
      </div>

      <div style={{ marginTop: 24, display: 'flex', gap: 20 }}>
        <button onClick={save}>save to session</button>
        {saved && <span className="dim">saved</span>}
      </div>
    </div>
  );
}

// React fragments can't take keys with shorthand; tiny helper keeps the grid flat.
function Fragment2({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

// ---- Archive ----

function ArchiveTab({ pw }: { pw: string }) {
  const [entries, setEntries] = useState<ArchiveEntry[]>([]);
  useEffect(() => {
    curatorApi.archive(pw).then((r) => setEntries(r.sessions)).catch(() => {});
  }, [pw]);

  if (entries.length === 0) return <div className="dim">no completed sessions yet</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {entries.map((e) => (
        <div key={e.id}>
          <div className="dim" style={{ fontStyle: 'italic' }}>{e.prompt} · {e.status}</div>
          <div>{e.response || '—'}</div>
        </div>
      ))}
    </div>
  );
}
