import { randomUUID } from 'node:crypto';
import { incidentInvalidationScopes } from '../../../../packages/domain/src/routing/index.mjs';
import { IncidentError } from './errors.mjs';
import {
  assertIncidentTransition,
  normalizeIncidentInput,
  normalizeIncidentPatch
} from './validation.mjs';
import { createPublicIncidentEvent } from './events.mjs';
import { serializePublicIncident, serializeIncidentList } from './serializers.mjs';

/** Incident application service using repository, invalidation, cache, and event ports. */
export function createIncidentService({
  repository,
  incidentRepository,
  incidentStore,
  routeInvalidationPort,
  invalidationPort,
  cachePort,
  eventPort,
  clock = () => Date.now(),
  idFactory = () => cryptoRandomId()
} = {}) {
  const store = repository ?? incidentRepository ?? incidentStore;
  const invalidator = routeInvalidationPort ?? invalidationPort ?? cachePort ?? null;
  if (!store) throw new TypeError('An incident repository port is required.');

  return {
    create,
    update,
    resolve,
    get,
    list,
    createIncident: create,
    updateIncident: update,
    resolveIncident: resolve,
    listIncidents: list
  };

  async function create(input, context = {}) {
    const normalized = normalizeIncidentInput(input, { now: clock });
    const status = normalized.status ?? 'reported';
    if (!['reported', 'validated', 'published'].includes(status)) {
      throw new IncidentError('INCIDENT_CREATE_STATUS_INVALID',
        'A new incident may start as reported, validated, or published.', { field: 'status' });
    }
    const privateInput = {
      ...normalized,
      id: input.id ?? idFactory(),
      createdAt: nowIso(clock),
      createdBy: context.actorId ?? context.userId ?? input.reporterId ?? null,
      reporterId: input.reporterId ?? context.actorId ?? context.userId ?? null,
      actorId: context.actorId ?? context.userId ?? context.session?.user?.id ?? null,
      actorRole: context.role ?? context.session?.user?.role ?? 'user'
    };
    const stored = await callStore(['createIncident', 'create'], privateInput);
    const record = stored ?? privateInput;
    await afterChange(record, null, status === 'published' ? 'incident.created' : null, 'incident_created');
    return serializePublicIncident(record);
  }

  async function update(id, patch, context = {}) {
    const current = await getStored(id);
    if (!current) throw new IncidentError('INCIDENT_NOT_FOUND', 'The incident does not exist.', { status: 404 });
    const normalized = normalizeIncidentPatch(patch, { now: clock });
    const nextStatus = normalized.status ?? current.status;
    assertIncidentTransition(current.status ?? 'reported', nextStatus);
    const merged = { ...current, ...normalized };
    if (nextStatus === 'resolved' && !merged.resolvedAt) merged.resolvedAt = nowIso(clock);
    if (nextStatus !== 'resolved' && Object.hasOwn(normalized, 'resolvedAt')) delete merged.resolvedAt;
    merged.updatedAt = nowIso(clock);
    merged.updatedBy = context.actorId ?? context.userId ?? null;
    merged.actorId = context.actorId ?? context.userId ?? context.session?.user?.id ?? null;
    merged.actorRole = context.role ?? context.session?.user?.role ?? 'user';
    const stored = await callStore(['updateIncident', 'update'], id, merged, current);
    const record = stored ?? merged;
    const eventType = nextStatus === 'resolved' ? 'incident.resolved' : 'incident.updated';
    await afterChange(record, current, eventType, 'incident_updated');
    return serializePublicIncident(record);
  }

  async function resolve(id, input = {}, context = {}) {
    return update(id, { ...input, status: 'resolved' }, context);
  }

  async function get(id, { publicOnly = true } = {}) {
    const record = await getStored(id);
    if (!record) return null;
    return publicOnly ? serializePublicIncident(record) : { ...record };
  }

  async function list(filters = {}) {
    const options = normalizeListFilters(filters);
    const result = await callStore(['listIncidents', 'list'], options);
    const records = (Array.isArray(result) ? result : result?.items ?? [])
      .filter((record) => !options.activeOnly || isActivePublicIncident(record, clock()));
    const items = serializeIncidentList(records, { includeUnpublished: false });
    if (Array.isArray(result)) return { items, pagination: pagination(options, items.length) };
    return {
      ...result,
      items,
      pagination: result?.pagination ?? pagination(options, items.length)
    };
  }

  async function getStored(id) {
    if (typeof id !== 'string' || id.trim().length === 0 || id.length > 160) {
      throw new IncidentError('INCIDENT_IDENTIFIER_INVALID', 'incidentId is invalid.', { field: 'incidentId' });
    }
    const method = ['getIncident', 'getById', 'get'].find((name) => typeof store[name] === 'function');
    if (!method) throw new TypeError('Incident repository needs getIncident(id) or getById(id).');
    return store[method](id.trim());
  }

  async function afterChange(record, previous, eventType, reason) {
    const scopes = [...new Set([
      ...incidentInvalidationScopes(previous),
      ...incidentInvalidationScopes(record)
    ])].sort();
    const invalidation = {
      schemaVersion: 'route-invalidation.v1',
      reason,
      incidentId: record.id ?? record.incidentId,
      scopes,
      affectedPlaceId: record.placeId ?? null,
      affectedAccessNodeId: record.accessNodeId ?? null,
      affectedAccessEdgeId: record.accessEdgeId ?? null,
      occurredAt: nowIso(clock)
    };
    if (invalidator) {
      try {
        if (typeof invalidator.invalidateForIncident === 'function') {
          await invalidator.invalidateForIncident(record, { previous, reason });
        } else if (typeof invalidator.invalidateAffected === 'function') {
          await invalidator.invalidateAffected(invalidation);
        } else if (typeof invalidator.invalidateByScopes === 'function') {
          await invalidator.invalidateByScopes(scopes, invalidation);
        }
      } catch {
        // A cache/event side effect must not undo the durable incident write.
      }
    }
    if (!eventPort || !eventType) return;
    const event = createPublicIncidentEvent(record, {
      eventType,
      occurredAt: invalidation.occurredAt,
      routeInvalidation: invalidation
    });
    if (!event) return;
    try {
      if (typeof eventPort.publish === 'function') {
        await eventPort.publish(eventType, event, event);
      } else if (typeof eventPort.emit === 'function') {
        await eventPort.emit(eventType, event);
      } else if (typeof eventPort.send === 'function') {
        await eventPort.send(event);
      }
    } catch {
      // The outbox/event port owns retry behavior; the incident remains saved.
    }
  }

  async function callStore(methodNames, ...args) {
    const method = methodNames.find((name) => typeof store[name] === 'function');
    if (!method) throw new TypeError(`Incident repository needs ${methodNames.join(' or ')}.`);
    return store[method](...args);
  }
}

export const createIncidentLifecycleService = createIncidentService;

function normalizeListFilters(filters) {
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) {
    throw new IncidentError('INCIDENT_FILTERS_INVALID', 'Incident filters must be an object.');
  }
  const page = boundedInteger(filters.page ?? 1, 1, 10_000, 'page');
  const pageSize = boundedInteger(filters.pageSize ?? filters.page_size ?? 20, 1, 100, 'pageSize');
  const allowed = ['placeId', 'status', 'activeOnly', 'bbox', 'page', 'pageSize'];
  const unknown = Object.keys(filters).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new IncidentError('INCIDENT_FILTER_INVALID',
    `Unsupported incident filter: ${unknown[0]}.`, { field: unknown[0] });
  if (filters.status !== undefined && !['reported', 'validated', 'published', 'disputed', 'resolved', 'archived'].includes(filters.status)) {
    throw new IncidentError('INCIDENT_FILTER_INVALID', 'status is invalid.', { field: 'status' });
  }
  return {
    ...(filters.placeId ? { placeId: boundedId(filters.placeId, 'placeId') } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.activeOnly !== undefined ? { activeOnly: Boolean(filters.activeOnly) } : {}),
    ...(filters.bbox ? { bbox: filters.bbox } : {}),
    page,
    pageSize
  };
}

function pagination(options, total) {
  return {
    page: options.page,
    pageSize: options.pageSize,
    total,
    hasNext: total >= options.pageSize
  };
}

function boundedInteger(value, minimum, maximum, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new IncidentError('INCIDENT_BOUND_INVALID',
      `${field} must be an integer between ${minimum} and ${maximum}.`, { field });
  }
  return number;
}

function boundedId(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 160) {
    throw new IncidentError('INCIDENT_IDENTIFIER_INVALID', `${field} is invalid.`, { field });
  }
  return value.trim();
}

function nowIso(clock) {
  return new Date(clock()).toISOString();
}

function isActivePublicIncident(record, now) {
  if (!['published', 'validated', 'disputed'].includes(record?.status)) return false;
  const expiry = record.expectedExpiryAt ?? record.expected_expiry_at ?? record.expiresAt;
  return !expiry || Date.parse(expiry) > now;
}

function cryptoRandomId() {
  return randomUUID();
}
