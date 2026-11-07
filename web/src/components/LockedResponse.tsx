import { AnimatePresence, motion } from 'framer-motion';

/**
 * The prompt and the locked-in response so far. Plain monospace, black, normal
 * wrapping. Each new winning word fades in (0.4s, opacity only — no movement).
 * Full text always visible; no truncation. See plan.md "Locked-in response".
 */
export function LockedResponse({
  prompt,
  words,
  size = 'base',
}: {
  prompt: string;
  words: { position: number; text: string }[];
  size?: 'base' | 'display';
}) {
  return (
    <div style={{ fontSize: size === 'display' ? '2.2rem' : '1rem', lineHeight: 1.5 }}>
      <span className="dim" style={{ fontStyle: 'italic' }}>
        {prompt}
      </span>{' '}
      <AnimatePresence initial={false}>
        {words.map((w) => (
          <motion.span
            key={w.position}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4 }}
          >
            {w.text}{' '}
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  );
}
