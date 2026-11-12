import type { FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';

/**
 * Nuvemshop signs every webhook with HMAC-SHA256 of the raw body using the app
 * secret, hex-encoded, in the `x-linkedstore-hmac-sha256` header.
 */
export const verifyNuvemshopWebhook = async (req: FastifyRequest, reply: FastifyReply) => {
  const secret = process.env.NUVEMSHOP_WEBHOOK_SECRET;
  if (!secret) {
    req.log.error('NUVEMSHOP_WEBHOOK_SECRET is not configured');
    return reply.status(500).send({ error: 'Internal server error' });
  }

  const signature = req.headers['x-linkedstore-hmac-sha256'];
  if (typeof signature !== 'string' || signature.length === 0) {
    return reply.status(401).send({ error: 'Missing webhook signature.' });
  }

  const payload = (req as FastifyRequest & { rawBody?: string | Buffer }).rawBody;
  if (payload === undefined) {
    req.log.error('Raw body not available for the Nuvemshop webhook route');
    return reply.status(500).send({ error: 'Internal server error' });
  }

  const expected = Buffer.from(crypto.createHmac('sha256', secret).update(payload).digest('hex'));
  const received = Buffer.from(signature.trim().toLowerCase());

  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
    req.log.warn('Invalid Nuvemshop webhook signature');
    return reply.status(401).send({ error: 'Invalid webhook signature.' });
  }
};
