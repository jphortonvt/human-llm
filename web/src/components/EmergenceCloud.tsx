import { motion } from 'framer-motion';
import type { Candidate } from '../lib/api';

/**
 * The emergence visualization. A plain vertical list sorted by votes; the only
 * vote-driven property is opacity = 0.12 + share * 0.88 (0.1 floor). No blur,
 * scale, rotation, color, or position effects. Reorders via FLIP layout
 * animation. See plan.md "The emergence effect".
 *
 * When `sampled` probabilities are provided (the closing moment), opacity
 * reflects post-temperature p' instead of raw share, then the winner snaps to 1
 * and losers fade to 0 — visibly showing the leader doesn't always win.
 */
export function EmergenceCloud({
  candidates,
  size = 'base',
  onVote,
  myVoteWordId,
  sampled,
  winnerWordId,
}: {
  candidates: Candidate[];
  size?: 'base' | 'display';
  onVote?: (c: Candidate) => void;
  myVoteWordId?: string | null;
  sampled?: Record<string, number> | null; // wordId/text -> p'
  winnerWordId?: string | null;
}) {
  const fontSize = size === 'display' ? '2.2rem' : '1.05rem';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {candidates.map((c) => {
        let opacity = 0.12 + c.share * 0.88;
        if (sampled) {
          if (winnerWordId) {
            opacity = c.wordId === winnerWordId ? 1 : 0;
          } else {
            const p = sampled[c.wordId] ?? sampled[c.text] ?? 0;
            opacity = 0.12 + p * 0.88;
          }
        }
        opacity = Math.max(0, Math.min(1, opacity));
        const mine = myVoteWordId === c.wordId;
        // On the voter screen, keep the voter's own pick clearly legible even if
        // it has few votes — so "what you chose" is never lost in the long tail.
        if (mine && !sampled) opacity = Math.max(opacity, 0.92);

        const inner = (
          <span>
            {mine ? '> ' : ''}
            {c.text}
          </span>
        );

        return (
          <motion.div
            key={c.wordId}
            layout
            initial={{ opacity: 0 }}
            animate={{ opacity }}
            transition={{ opacity: { duration: 0.8, ease: 'easeOut' }, layout: { duration: 0.5 } }}
            style={{ fontSize }}
          >
            {onVote ? (
              <button className="tap" style={{ fontSize }} onClick={() => onVote(c)}>
                {inner}
              </button>
            ) : (
              inner
            )}
          </motion.div>
        );
      })}
    </div>
  );
}
