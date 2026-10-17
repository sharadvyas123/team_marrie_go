import { CivicError } from './errors.mjs';
import {
  makeCivicPagination,
  normalizeCivicChangeFilters,
  normalizeCivicIncidentFilters
} from './pagination.mjs';
import {
  serializePublicAccessibility,
  serializePublicChangeList,
  serializePublicIncidentList
} from './serializers.mjs';

export function createCivicService({
  repository,
  publicRepository,
  civicPort,
  rateLimitPort,
  clock = () => Date.now(),
  rateLimitAction = 'civic-api'
} = {}) {
  const data = repository ?? publicRepository ?? civicPort;
  if (!data) throw new TypeError('A public civic data port is required.');

  return {
    getPlaceAccessibility,
    getAccessibility: getPlaceAccessibility,
    listIncidents,
    listPublicIncidents: listIncidents,
    listChanges,
    listPublicChanges: listChanges
  };

  async function getPlaceAccessibility(placeId, context = {}) {
    await enforceRateLimit(context, 'place-accessibility');
    const id = identifier(placeId, 'placeId');
    const record = await callData(['getPublicPlaceAccessibility', 'getPlaceAccessibility', 'getPublicPlace'], id, { publicOnly: true });
    const serialized = serializePublicAccessibility(record);
    if (!serialized) throw new CivicError('CIVIC_PLACE_NOT_FOUND', 'The requested public place is not available.', { status: 404, title: 'Public place not found' });
    return serialized;
  }

  async function listIncidents(filters = {}, context = {}) {
    await enforceRateLimit(context, 'incidents');
    const options = normalizeCivicIncidentFilters(filters);
    const result = await callData(['listPublicIncidents', 'listIncidents'], options, { publicOnly: true });
    const records = Array.isArray(result) ? result : result?.items ?? [];
    const items = serializePublicIncidentList(records);
    return {
      items,
      pagination: makeCivicPagination(options, {
        total: result?.pagination?.total ?? result?.total ?? items.length,
        hasNext: result?.pagination?.hasNext ?? result?.hasNext
      })
    };
  }

  async function listChanges(filters = {}, context = {}) {
    await enforceRateLimit(context, 'changes');
    const options = normalizeCivicChangeFilters(filters);
    const result = await callData(['listPublicChanges', 'listChanges'], options, { publicOnly: true });
    const records = Array.isArray(result) ? result : result?.items ?? [];
    const items = serializePublicChangeList(records);
    return {
      items,
      pagination: makeCivicPagination(options, {
        total: result?.pagination?.total ?? result?.total ?? items.length,
        hasNext: result?.pagination?.hasNext ?? result?.hasNext
      })
    };
  }

  async function enforceRateLimit(context, action) {
    if (!rateLimitPort) return;
    const identity = context.apiKeyId ?? context.consumerId ?? context.ip ?? context.identity ?? 'anonymous';
    const input = { identity, action: `${rateLimitAction}:${action}`, now: clock() };
    const method = ['check', 'consume', 'allow', 'take'].find((name) => typeof rateLimitPort[name] === 'function');
    if (!method) throw new TypeError('rateLimitPort needs check, consume, allow, or take.');
    const result = await rateLimitPort[method](input);
    const allowed = typeof result === 'boolean' ? result : result?.allowed !== false;
    if (!allowed) {
      throw new CivicError('CIVIC_RATE_LIMITED', 'The civic API rate limit has been reached.', {
        status: 429,
        title: 'Too many requests',
        retryAfter: result?.retryAfter ?? 60
      });
    }
  }

  async function callData(methods, ...args) {
    const method = methods.find((name) => typeof data[name] === 'function');
    if (!method) throw new TypeError(`Public civic data port needs ${methods.join(' or ')}.`);
    return data[method](...args);
  }

  function identifier(value, field) {
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > 160) throw new CivicError('CIVIC_IDENTIFIER_INVALID', `${field} is invalid.`, { field });
    return value.trim();
  }
}

export const createCivicApi = createCivicService;
export const createPublicCivicService = createCivicService;
