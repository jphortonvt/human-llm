import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Anonymous voter identity. The token is a random id plus an HMAC signature, so
 * a client can't fabricate valid identities without round-tripping the server
 * (which the per-IP vote limiter then throttles). Stored as an httpOnly cookie
 * so page JS / XSS can't read or mint it. This is the light-touch dedup layer —
 * it raises the cost of stuffing without adding any friction for real voters.
 */
const COOKIE = 'hllm_voter';
const IS_PROD = process.env.NODE_ENV === 'production';
const SECRET = process.env.TOKEN_SECRET ?? 'human-llm-dev-token-secret';

if (IS_PROD && !process.env.TOKEN_SECRET) {
  console.warn(
    '[auth] TOKEN_SECRET is unset in production — voter tokens use a public default ' +
      'and could be forged. Set TOKEN_SECRET to a random value.',
  );
}

function sign(id: string): string {
  return createHmac('sha256', SECRET).update(id).digest('base64url');
}

function mintToken(): { token: string; id: string } {
  const id = randomUUID();
  return { token: `${id}.${sign(id)}`, id };
}

/** Verify a `id.sig` token; returns the id if the signature is valid, else null. */
function verifyToken(token: string): string | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const id = token.slice(0, dot);
  const sig = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(id));
  if (sig.length !== expected.length) return null;
  return timingSafeEqual(sig, expected) ? id : null;
}

/** Return the voter's identity, minting + setting a signed cookie if needed. */
export function getOrSetVoterToken(req: FastifyRequest, reply: FastifyReply): string {
  const cookie = req.headers.cookie ?? '';
  const match = cookie.match(/(?:^|;\s*)hllm_voter=([^;]+)/);
  if (match) {
    const id = verifyToken(decodeURIComponent(match[1]));
    if (id) return id;
    // forged or legacy token → fall through and re-mint
  }

  const { token, id } = mintToken();
  const attrs = [
    `${COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'Max-Age=31536000',
    'SameSite=Lax',
    'HttpOnly',
  ];
  if (IS_PROD) attrs.push('Secure');
  reply.header('Set-Cookie', attrs.join('; '));
  return id;
}
