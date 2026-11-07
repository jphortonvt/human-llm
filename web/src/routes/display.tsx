import { useCallback, useEffect, useRef, useState } from 'react';
import { EmergenceCloud } from '../components/EmergenceCloud';
import { LockedResponse } from '../components/LockedResponse';
import { useSession } from '../hooks/useSession';

const VOTE_URL = (import.meta.env.VITE_VOTE_URL as string) ?? 'humanllm.exhibit/v';

/**
 * Gallery wall (/display). Fullscreen, read-only, no controls, no countdown.
 * Header is plain lowercase numbers; the emergence list uses opacity only; the
 * sampling moment briefly shows post-temperature p' then snaps to the winner.
 * See plan.md Phase 3 + "Sampling moment".
 */
type Sampling = { probabilities: Record<string, number>; winner: string | null };

export function DisplayPage() {
  const [sampling, setSampling] = useState<Sampling | null>(null);
  const samplingTimer = useRef<number | null>(null);

  const onEvent = useCallback((event: { type: string } & Record<string, unknown>) => {
    if (event.type === 'ballot_closed') {
      const probs = (event.probabilities as { text: string; p: number }[] | undefined) ?? [];
      const map: Record<string, number> = {};
      for (const p of probs) map[p.text] = p.p;
      // Phase 1: show equalized p'. Phase 2: snap to winner.
      setSampling({ probabilities: map, winner: null });
      if (samplingTimer.current) window.clearTimeout(samplingTimer.current);
      samplingTimer.current = window.setTimeout(() => {
        setSampling({ probabilities: map, winner: (event.winningWord as string) ?? null });
        samplingTimer.current = window.setTimeout(() => setSampling(null), 1200);
      }, 1000);
    }
  }, []);

  const { detail } = useSession(onEvent);

  // Clear any stale sampling overlay when a fresh ballot is open.
  useEffect(() => {
    if (detail?.currentBallot && !sampling) return;
  }, [detail, sampling]);

  if (!detail?.session) {
    return (
      <div className="display-root" style={rootStyle}>
        <div className="dim">the room is thinking</div>
      </div>
    );
  }

  const s = detail.session;
  const ballot = detail.currentBallot;
  const t = (s.config.temperature as number) ?? 1;
  const tokenNum = detail.lockedWords.length + 1;

  return (
    <div style={rootStyle}>
      {/* header */}
      <div className="dim" style={{ fontSize: '1rem', marginBottom: 40, display: 'flex', gap: 40 }}>
        <span>token {tokenNum}</span>
        <span>{detail.voterCount} connected</span>
        <span>t={t}</span>
      </div>

      {/* prompt + locked response */}
      <LockedResponse prompt={s.prompt} words={detail.lockedWords} size="display" />

      {/* emergence cloud */}
      <div style={{ marginTop: 48 }}>
        {ballot && ballot.candidates.length > 0 ? (
          <EmergenceCloud
            candidates={ballot.candidates}
            size="display"
            sampled={sampling?.probabilities ?? null}
            winnerWordId={
              sampling?.winner
                ? ballot.candidates.find((c) => c.text === sampling.winner)?.wordId ?? null
                : null
            }
          />
        ) : (
          <div className="dim" style={{ fontSize: '2.2rem' }}>
            {s.status === 'complete' ? '' : '…'}
          </div>
        )}
      </div>

      {/* state indicator */}
      {ballot && (
        <div className="dim" style={{ marginTop: 36, fontSize: '1.1rem' }}>
          {ballot.inRunoff ? 'contested' : ballot.state}
        </div>
      )}

      {/* footer */}
      <div className="dim" style={{ position: 'fixed', bottom: 32, left: 0, right: 0, textAlign: 'center', fontSize: '1rem' }}>
        vote at {VOTE_URL}
      </div>
    </div>
  );
}

const rootStyle: React.CSSProperties = {
  minHeight: '100vh',
  background: 'var(--bg)',
  color: 'var(--ink)',
  padding: '48px 64px',
};
