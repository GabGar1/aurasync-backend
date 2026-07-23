import type { FastifyRequest, FastifyReply, DoneFuncWithErr } from 'fastify';
import crypto from 'crypto';

export const verifyNuvemshopWebhook = (req: FastifyRequest, reply: FastifyReply, done: DoneFuncWithErr) => {
  const nuvemshopSignature = req.headers['x-webhook-signature'] as string;
  const secret = process.env.NUVEMSHOP_WEBHOOK_SECRET;

  if (!secret) {
    console.error('NUVEMSHOP_WEBHOOK_SECRET não está configurado no ambiente.');
    reply.status(500).send({ error: 'Webhook secret not configured on server.' });
    return;
  }

  if (!nuvemshopSignature) {
    console.warn('Requisição sem o cabeçalho x-webhook-signature.');
    reply.status(401).send({ error: 'Missing webhook signature.' });
    return;
  }

  const payload = (req as any).rawBody;

  if (!payload) {
    console.error('Raw body não disponível na requisição. Certifique-se de que um plugin de raw body está registrado.');
    reply.status(500).send({ error: 'Internal server error: Raw body not available.' });
    return;
  }

  const [algorithm, signatureHash] = nuvemshopSignature.split('=');

  if (algorithm !== 'sha256') {
    console.warn('Algoritmo de assinatura de webhook inválido. Esperado sha256.');
    reply.status(401).send({ error: 'Invalid webhook signature algorithm.' });
    return;
  }

  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload);
  const expectedSignature = hmac.digest('hex');

  if (signatureHash !== expectedSignature) {
    console.warn('Assinatura de webhook inválida recebida.');
    reply.status(401).send({ error: 'Invalid webhook signature.' });
    return;
  }

  done();
};