import { randomUUID } from 'node:crypto';
import { WebhookError } from './errors.mjs';
import { hashWebhookSecret, generateWebhookSecret, serializePublicWebhookEvent, serializeWebhookDelivery, serializeWebhookSubscription, signWebhookPayload } from './security.mjs';
import { createWebhookIdempotencyKey, nextWebhookRetryState, DEFAULT_WEBHOOK_MAX_ATTEMPTS, webhookRetryDelay } from './retry.mjs';
import { validateWebhookSubscription } from './validation.mjs';

export function createWebhookService({
  subscriptionStore,
  webhookStore,
  deliveryStore,
  authorizationPort,
  secretStore,
  deliveryPort,
  replayPort,
  dnsResolver,
  clock = () => Date.now(),
  idFactory = randomUUID,
  maxAttempts = DEFAULT_WEBHOOK_MAX_ATTEMPTS,
  sleep = async () => {}
} = {}) {
  const subscriptions = subscriptionStore ?? webhookStore;
  const deliveries = deliveryStore ?? webhookStore;
  if (!subscriptions) throw new TypeError('A webhook subscription store is required.');

  return {
    createSubscription,
    create: createSubscription,
    getSubscription,
    listSubscriptions,
    pauseSubscription,
    revokeSubscription,
    deliver,
    deliverEvent: deliver,
    getDelivery,
    retryDelay: (attempt, options) => webhookRetryDelay(attempt, options)
  };

  async function createSubscription(input, context = {}) {
    const owner = await requireOwner(context);
    const normalized = await validateWebhookSubscription(input, { dnsResolver });
    const id = input.id ?? idFactory();
    const secret = generateWebhookSecret();
    const record = {
      id,
      ownerId: ownerId(owner, context),
      actorId: ownerId(owner, context),
      actorRole: context.session?.user?.role ?? context.role ?? 'user',
      endpoint: normalized.endpoint,
      events: normalized.events,
      secretHash: hashWebhookSecret(secret),
      status: 'active',
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    const stored = await callStore(['createSubscription', 'createWebhookSubscription', 'create'], record);
    if (secretStore) {
      try {
        await storeSecret(id, secret, record);
      } catch (error) {
        // Do not leave an apparently usable subscription without a durable
        // signing secret. Revoke it before returning the typed failure.
        try {
          await callStore(['updateSubscription', 'updateWebhookSubscription', 'update'], id, { ...record, status: 'revoked', actorId: record.ownerId, actorRole: 'admin' }, record);
        } catch {
          // Preserve the original storage/configuration error.
        }
        throw error;
      }
    }
    return { subscription: serializeWebhookSubscription(stored ?? record), secret };
  }

  async function getSubscription(id, context = {}) {
    const record = await getStoredSubscription(id, context);
    await requireOwner(context, record.ownerId ?? record.owner_id);
    return serializeWebhookSubscription(record);
  }

  async function listSubscriptions(context = {}) {
    const owner = await requireOwner(context);
    const result = await callStore(['listSubscriptions', 'listWebhookSubscriptions', 'listForOwner'], ownerId(owner, context));
    return (Array.isArray(result) ? result : result?.items ?? []).map(serializeWebhookSubscription).filter(Boolean);
  }

  async function pauseSubscription(id, context = {}) { return changeStatus(id, 'paused', context); }
  async function revokeSubscription(id, context = {}) { return changeStatus(id, 'revoked', context); }

  async function changeStatus(id, status, context) {
    const current = await getStoredSubscription(id, context);
    await requireOwner(context, current.ownerId ?? current.owner_id);
    const session = context.session ?? context;
    const next = {
      ...current,
      status,
      actorId: session?.user?.id ?? current.ownerId ?? current.owner_id,
      actorRole: session?.user?.role ?? 'user',
      updatedAt: nowIso()
    };
    const stored = await callStore(['updateSubscription', 'updateWebhookSubscription', 'update'], id, next, current);
    return serializeWebhookSubscription(stored ?? next);
  }

  async function deliver(subscriptionId, event, options = {}) {
    const subscription = await getStoredSubscription(subscriptionId);
    if (subscription.status !== 'active') return { status: 'skipped', reason: subscription.status };
    const publicEvent = serializePublicWebhookEvent(event);
    if (!subscription.events.includes(publicEvent.eventType)) return { status: 'skipped', reason: 'event_not_subscribed' };
    const eventId = event.eventId ?? event.id ?? `${publicEvent.eventType}:${publicEvent.occurredAt ?? nowIso()}`;
    const idempotencyKey = createWebhookIdempotencyKey(subscriptionId, eventId);
    const claimed = await claimDelivery(idempotencyKey, subscriptionId, eventId, subscription.ownerId ?? subscription.owner_id);
    if (!claimed) return { status: 'duplicate', idempotencyKey };
    const secret = await readSecret(subscriptionId);
    if (!secret) throw new WebhookError('WEBHOOK_SECRET_UNAVAILABLE', 'The webhook signing secret is unavailable for delivery.', { status: 503 });
    if (!deliveryPort || typeof (deliveryPort.send ?? deliveryPort.deliver) !== 'function') throw new TypeError('deliveryPort.send(payload) or deliveryPort.deliver(payload) is required.');

    const body = JSON.stringify(publicEvent);
    const attempts = [];
    let state = { attempts: 0 };
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const timestamp = Math.floor(clock() / 1_000);
      const nonce = idFactory();
      const signature = signWebhookPayload({ body, timestamp, nonce, secret });
      let result;
      try {
        result = await callDelivery({
          endpoint: subscription.endpoint,
          body,
          headers: {
            'content-type': 'application/json',
            'x-accessmap-event': publicEvent.eventType,
            'x-accessmap-timestamp': String(timestamp),
            'x-accessmap-nonce': nonce,
            'x-accessmap-signature': signature,
            'x-accessmap-idempotency-key': idempotencyKey
          },
          idempotencyKey,
          attempt
        });
      } catch (error) {
        result = { ok: false, error };
      }
      state = nextWebhookRetryState(state, result, { ...options, maxAttempts, now: clock() });
      attempts.push({ attempt, status: result.status ?? null, ok: result.ok === true || (result.status >= 200 && result.status < 300), at: nowIso() });
      await recordDelivery({
        id: `${idempotencyKey}:${attempt}`,
        subscriptionId,
        eventId,
          idempotencyKey,
          attempt,
          ownerId: subscription.ownerId ?? subscription.owner_id,
          role: 'user',
          state,
        statusCode: result.status ?? null,
        deliveredAt: state.status === 'delivered' ? nowIso() : null,
        error: state.lastError,
        attempts: attempts.length
      });
      if (state.status === 'delivered' || state.status === 'dead_letter') break;
      await sleep(Math.max(0, new Date(state.nextAttemptAt).getTime() - clock()));
    }
    return { status: state.status, idempotencyKey, attempts: attempts.map((item) => ({ ...item })), delivery: serializeWebhookDelivery(state) };
  }

  async function getDelivery(id, context = {}) {
    if (!deliveries) throw new TypeError('A webhook delivery store is required.');
    const method = ['getDelivery', 'getWebhookDelivery', 'get'].find((name) => typeof deliveries[name] === 'function');
    if (!method) throw new TypeError('deliveryStore needs getDelivery or getWebhookDelivery.');
    const session = context.session ?? context;
    const record = await deliveries[method](id, {
      ownerId: session?.user?.id ?? null,
      role: session?.user?.role ?? 'user'
    });
    if (!record) return null;
    const subscription = await getStoredSubscription(record.subscriptionId, context);
    await requireOwner(context, subscription.ownerId ?? subscription.owner_id);
    return serializeWebhookDelivery(record);
  }

  async function requireOwner(context = {}, expectedOwnerId) {
    const session = context.session ?? context;
    const method = ['requireWebhookOwner', 'requireRole', 'authorize'].find((name) => typeof authorizationPort?.[name] === 'function');
    if (!method) throw new TypeError('authorizationPort needs requireWebhookOwner, requireRole, or authorize.');
    const result = method === 'requireWebhookOwner'
      ? await authorizationPort[method](session, expectedOwnerId)
      : await authorizationPort[method](session, ['user', 'admin', 'facility_manager', 'moderator']);
    if (!result) throw new WebhookError('WEBHOOK_OWNER_UNAUTHORIZED', 'The account cannot manage this webhook.', { status: 403, title: 'Webhook authorization denied' });
    if (expectedOwnerId && !isPrivileged(session) && ownerId(result, context) !== expectedOwnerId && ownerId(session?.user, context) !== expectedOwnerId) {
      throw new WebhookError('WEBHOOK_OWNER_SCOPE_REQUIRED', 'This webhook belongs to another owner.', { status: 403, title: 'Webhook authorization denied' });
    }
    return result;
  }

  async function getStoredSubscription(id, context = {}) {
    if (typeof id !== 'string' || id.trim().length === 0 || id.length > 160) throw new WebhookError('WEBHOOK_IDENTIFIER_INVALID', 'subscriptionId is invalid.', { field: 'subscriptionId' });
    const method = ['getSubscription', 'getWebhookSubscription', 'get'].find((name) => typeof subscriptions[name] === 'function');
    if (!method) throw new TypeError('subscriptionStore needs getSubscription or getWebhookSubscription.');
    const session = context.session ?? context;
    const record = await subscriptions[method](id.trim(), {
      ownerId: session?.user?.id ?? null,
      role: session?.user?.role ?? context.role ?? 'admin'
    });
    if (!record) throw new WebhookError('WEBHOOK_NOT_FOUND', 'The webhook subscription does not exist.', { status: 404, title: 'Webhook not found' });
    return record;
  }

  async function claimDelivery(key, subscriptionId, eventId, ownerId) {
    if (!deliveries) return true;
    const method = ['claimIdempotency', 'claimDelivery', 'claim'].find((name) => typeof deliveries[name] === 'function');
    if (!method) return true;
    const result = await deliveries[method](key, { subscriptionId, eventId, ownerId });
    return typeof result === 'boolean' ? result : result?.acquired !== false && result?.duplicate !== true;
  }

  async function recordDelivery(record) {
    if (!deliveries) return;
    const method = ['recordDelivery', 'saveDelivery', 'createDelivery'].find((name) => typeof deliveries[name] === 'function');
    if (method) await deliveries[method](record);
  }

  async function readSecret(id) {
    if (!secretStore) return null;
    const method = ['getSecret', 'readSecret', 'resolve'].find((name) => typeof secretStore[name] === 'function');
    if (!method) return null;
    return secretStore[method](id);
  }

  async function storeSecret(id, secret, record) {
    const method = ['storeSecret', 'saveSecret', 'store'].find((name) => typeof secretStore[name] === 'function');
    if (method) await secretStore[method]({ id, secret, secretHash: record.secretHash });
  }

  async function callStore(methods, ...args) {
    const method = methods.find((name) => typeof subscriptions[name] === 'function');
    if (!method) throw new TypeError(`subscriptionStore needs ${methods.join(' or ')}.`);
    return subscriptions[method](...args);
  }

  async function callDelivery(payload) {
    const method = typeof deliveryPort.send === 'function' ? 'send' : 'deliver';
    return deliveryPort[method](payload);
  }

  function ownerId(value, context) { return value?.id ?? value?.ownerId ?? value?.owner_id ?? context.actorId ?? context.userId ?? context.session?.user?.id ?? null; }
  function isPrivileged(session) { return ['admin', 'moderator'].includes(session?.user?.role); }
  function nowIso() { return new Date(clock()).toISOString(); }
}

export const createWebhookSubscriptionService = createWebhookService;
