// Shapes mirror the server's read models (engine.getSessionDetail / ballotView).

export type BallotConfig = Record<string, number | boolean | string>;

export type Candidate = {
  wordId: string;
  text: string;
  key: string;
  votes: number;
  share: number;
};

export type BallotView = {
  id: string;
  position: number;
  status: 'open' | 'provisional' | 'closed';
  assumedWord: string | null;
  inRunoff: boolean;
  totalVotes: number;
  state: 'gathering' | 'forming' | 'settling' | 'converged' | 'contested';
  candidates: Candidate[];
};

export type SessionDetail = {
  session: {
    id: string;
    prompt: string;
    status: 'queued' | 'active' | 'complete' | 'abandoned';
    config: BallotConfig;
  } | null;
  lockedWords: { position: number; text: string }[];
  currentBallot: BallotView | null;
  provisionalBallot: BallotView | null;
  voterCount: number;
};

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `http ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  active: () => fetch('/api/sessions/active').then((r) => json<SessionDetail>(r)),
  session: (id: string) => fetch(`/api/sessions/${id}`).then((r) => json<SessionDetail>(r)),
  vote: (ballotId: string, word: string, source = 'remote') =>
    fetch(`/api/ballots/${ballotId}/vote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ word, source }),
    }).then((r) => json<{ ok: boolean; votedFor: string; changed: boolean }>(r)),
  myVote: (ballotId: string) =>
    fetch(`/api/ballots/${ballotId}/my-vote`).then((r) => json<{ wordId: string | null }>(r)),
};

// ---- curator (password-gated) ----

function curatorHeaders(password: string) {
  return { 'content-type': 'application/json', 'x-curator-password': password };
}

export const curatorApi = {
  listSessions: (pw: string) =>
    fetch('/api/curator/sessions', { headers: { 'x-curator-password': pw } }).then((r) =>
      json<{ sessions: CuratorSession[] }>(r),
    ),
  createSession: (pw: string, prompt: string) =>
    fetch('/api/curator/sessions', {
      method: 'POST',
      headers: curatorHeaders(pw),
      body: JSON.stringify({ prompt }),
    }).then((r) => json<{ session: CuratorSession }>(r)),
  updateSession: (pw: string, id: string, patch: Partial<{ prompt: string; queuePosition: number }>) =>
    fetch(`/api/curator/sessions/${id}`, {
      method: 'PATCH',
      headers: curatorHeaders(pw),
      body: JSON.stringify(patch),
    }).then((r) => json<{ session: CuratorSession }>(r)),
  deleteSession: (pw: string, id: string) =>
    fetch(`/api/curator/sessions/${id}`, { method: 'DELETE', headers: curatorHeaders(pw) }).then(
      (r) => json<{ ok: boolean }>(r),
    ),
  abandonSession: (pw: string, id: string) =>
    fetch(`/api/curator/sessions/${id}/abandon`, { method: 'POST', headers: curatorHeaders(pw) }).then(
      (r) => json<{ ok: boolean }>(r),
    ),
  closeBallot: (pw: string, ballotId: string, wordId?: string) =>
    fetch(`/api/curator/ballots/${ballotId}/close`, {
      method: 'POST',
      headers: curatorHeaders(pw),
      body: JSON.stringify({ wordId }),
    }).then((r) => json<{ winningWord?: string }>(r)),
  hideWord: (pw: string, wordId: string, hidden: boolean) =>
    fetch(`/api/curator/words/${wordId}/hide`, {
      method: 'POST',
      headers: curatorHeaders(pw),
      body: JSON.stringify({ hidden }),
    }).then((r) => json<{ word: unknown }>(r)),
  getSessionConfig: (pw: string, id: string) =>
    fetch(`/api/curator/sessions/${id}`, { headers: { 'x-curator-password': pw } }),
  putSessionConfig: (pw: string, id: string, config: BallotConfig) =>
    fetch(`/api/curator/sessions/${id}/config`, {
      method: 'PUT',
      headers: curatorHeaders(pw),
      body: JSON.stringify({ config }),
    }).then((r) => json<{ session: CuratorSession }>(r)),
  presets: (pw: string) =>
    fetch('/api/curator/presets', { headers: { 'x-curator-password': pw } }).then((r) =>
      json<{ presets: Record<string, { name: string; description: string; config: BallotConfig }> }>(r),
    ),
  metrics: (pw: string, sessionId?: string) =>
    fetch(`/api/curator/metrics${sessionId ? `?sessionId=${sessionId}` : ''}`, {
      headers: { 'x-curator-password': pw },
    }).then((r) => json<{ metrics: Metrics }>(r)),
  archive: (pw: string) =>
    fetch('/api/curator/archive', { headers: { 'x-curator-password': pw } }).then((r) =>
      json<{ sessions: ArchiveEntry[] }>(r),
    ),
};

export type CuratorSession = {
  id: string;
  prompt: string;
  status: string;
  queuePosition: number;
  config: BallotConfig;
  createdAt: string;
};

export type Metrics = {
  avgVotesPerBallot: number | null;
  avgSecondsPerBallot: number | null;
  wordsPerHour: number | null;
  closedBallots: number;
  activeVoters: number;
  bands: Record<string, 'green' | 'amber' | 'red' | 'na'>;
};

export type ArchiveEntry = {
  id: string;
  prompt: string;
  status: string;
  completedAt: string | null;
  response: string;
};
