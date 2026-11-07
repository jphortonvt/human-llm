import { and, eq, sql } from 'drizzle-orm';
import type { DB } from '../db/index.js';
import { ballots, sessions, votes, words } from '../db/schema.js';
import { hub } from './events.js';

export type Metrics = {
  avgVotesPerBallot: number | null;
  avgSecondsPerBallot: number | null;
  wordsPerHour: number | null;
  closedBallots: number;
  activeVoters: number;
  // band-coded against target ranges from plan.md "Tuning In Practice"
  bands: Record<string, 'green' | 'amber' | 'red' | 'na'>;
};

function band(value: number | null, green: [number, number], amber: [number, number]) {
  if (value == null) return 'na' as const;
  if (value >= green[0] && value <= green[1]) return 'green' as const;
  if (value >= amber[0] && value <= amber[1]) return 'amber' as const;
  return 'red' as const;
}

export async function computeMetrics(db: DB, sessionId?: string): Promise<Metrics> {
  // Closed ballots in scope.
  const closed = await db.query.ballots.findMany({
    where: sessionId
      ? and(eq(ballots.sessionId, sessionId), eq(ballots.status, 'closed'))
      : eq(ballots.status, 'closed'),
  });

  const closedCount = closed.length;

  // Avg votes per ballot at close.
  let avgVotes: number | null = null;
  let avgSeconds: number | null = null;
  if (closedCount > 0) {
    let voteSum = 0;
    let secSum = 0;
    for (const b of closed) {
      const [{ c }] = await db
        .select({ c: sql<number>`count(*)` })
        .from(votes)
        .where(eq(votes.ballotId, b.id));
      voteSum += Number(c);
      if (b.closedAt && b.openedAt) {
        secSum += (b.closedAt.getTime() - b.openedAt.getTime()) / 1000;
      }
    }
    avgVotes = voteSum / closedCount;
    avgSeconds = secSum / closedCount;
  }

  // Words per hour from the last 10 closed ballots' span.
  let wph: number | null = null;
  const recent = [...closed]
    .filter((b) => b.closedAt)
    .sort((a, b) => (b.closedAt!.getTime() ?? 0) - (a.closedAt!.getTime() ?? 0))
    .slice(0, 10);
  if (recent.length >= 2) {
    const newest = recent[0].closedAt!.getTime();
    const oldest = recent[recent.length - 1].closedAt!.getTime();
    const hours = (newest - oldest) / 3_600_000;
    if (hours > 0) wph = (recent.length - 1) / hours;
  }

  const m: Metrics = {
    avgVotesPerBallot: avgVotes,
    avgSecondsPerBallot: avgSeconds,
    wordsPerHour: wph,
    closedBallots: closedCount,
    activeVoters: hub.connectionCount,
    bands: {
      avgVotesPerBallot: band(avgVotes, [8, 30], [5, 40]),
      avgSecondsPerBallot: band(avgSeconds, [60, 480], [30, 900]),
      wordsPerHour: band(wph, [8, 15], [5, 20]),
    },
  };
  return m;
}
