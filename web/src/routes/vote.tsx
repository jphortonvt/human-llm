import { useCallback, useEffect, useState } from 'react';
import { EmergenceCloud } from '../components/EmergenceCloud';
import { LockedResponse } from '../components/LockedResponse';
import { useSession } from '../hooks/useSession';
import { api, type Candidate } from '../lib/api';

/**
 * Voter interface (/vote). Phone-optimized. Prompt, locked response, qualitative
 * state, candidate list, free-text input. No counts, no countdown. Tap a word to
 * vote for it (opacity = vote share; your pick is marked `>` and kept legible),
 * or type a new one. A status line spells out what your tap/submit just did.
 */
export function VotePage() {
  const { detail, loading } = useSession();
  const [draft, setDraft] = useState('');
  const [myVoteWordId, setMyVoteWordId] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const ballot = detail?.currentBallot ?? null;
  const ballotId = ballot?.id ?? null;

  // Pull this voter's current choice whenever the ballot changes.
  useEffect(() => {
    setMyVoteWordId(null);
    if (!ballotId) return;
    api
      .myVote(ballotId)
      .then((r) => setMyVoteWordId(r.wordId))
      .catch(() => {});
  }, [ballotId]);

  const submitWord = useCallback(
    async (word: string, optimisticWordId?: string) => {
      if (!ballotId || !word.trim()) return;
      setErr(null);
      setPending(word.toLowerCase());
      // Snappy feedback: move the marker immediately for taps on existing words.
      if (optimisticWordId) setMyVoteWordId(optimisticWordId);
      try {
        await api.vote(ballotId, word);
        setDraft('');
        // Resync my vote (server is authoritative; assigns ids for new words).
        const mv = await api.myVote(ballotId);
        setMyVoteWordId(mv.wordId);
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'vote failed');
      } finally {
        setPending(null);
      }
    },
    [ballotId],
  );

  // Tapping a candidate casts/changes your vote for it.
  const onVote = useCallback((c: Candidate) => submitWord(c.text, c.wordId), [submitWord]);

  if (loading) return <div className="page dim">loading…</div>;
  if (!detail?.session) return <div className="page dim">the room is thinking. no active prompt.</div>;
  if (detail.session.status !== 'active' || !ballot) {
    return (
      <div className="page">
        <LockedResponse prompt={detail.session.prompt} words={detail.lockedWords} />
        <p className="dim" style={{ marginTop: 24 }}>
          {detail.session.status === 'complete' ? 'this response is complete.' : 'waiting…'}
        </p>
      </div>
    );
  }

  // Optimistically show the pending word if it's not yet in the list.
  const candidates = [...ballot.candidates];
  if (pending && !candidates.some((c) => c.key === pending)) {
    candidates.push({ wordId: `pending-${pending}`, text: pending, key: pending, votes: 1, share: 0 });
  }

  // The display text of the word this voter currently backs (for the status line).
  const myWord =
    candidates.find((c) => c.wordId === myVoteWordId)?.text ?? (pending || null);

  return (
    <div className="page">
      <LockedResponse prompt={detail.session.prompt} words={detail.lockedWords} />

      <div style={{ marginTop: 28, marginBottom: 4 }}>what word comes next?</div>
      <div className="dim" style={{ marginBottom: 16 }}>{ballot.inRunoff ? 'runoff' : ballot.state}</div>

      <div style={{ marginBottom: 12 }}>
        {candidates.length === 0 ? (
          <span className="dim">be the first to suggest the next word</span>
        ) : (
          <EmergenceCloud candidates={candidates} myVoteWordId={myVoteWordId} onVote={onVote} />
        )}
      </div>

      {/* status line — spells out what your tap/submit did, or how to act */}
      <div className="dim" style={{ marginBottom: 24, minHeight: '1.5em' }}>
        {myWord
          ? `you're voting for "${myWord}" — tap another word or type to change`
          : candidates.length === 0
            ? 'type a word below to start the vote'
            : 'tap a word to vote, or type a new one below'}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submitWord(draft);
        }}
      >
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="type a new word"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="send"
        />
      </form>
      {err && (
        <div className="dim" style={{ marginTop: 10 }}>
          {err}
        </div>
      )}
    </div>
  );
}
