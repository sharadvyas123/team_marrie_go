import { randomUUID } from 'node:crypto';
import { FacilityError } from './errors.mjs';
import {
  normalizeFacilityClaimInput,
  normalizeFacilityIncidentInput,
  normalizeFacilityListFilters,
  normalizeFacilityResponseInput,
  normalizeIdentifier
} from './validation.mjs';
import {
  serializeCommunityHistoryItem,
  serializeFacilityClaim,
  serializeFacilityIncident,
  serializeFacilityList,
  serializeFacilityPlace,
  serializeFacilityResponse
} from './serializers.mjs';
import { createFacilityScopeService } from './authorization.mjs';

export function createFacilityService({
  repository,
  facilityRepository,
  facilityStore,
  store: facilityStoreAlias,
  claimStore,
  authorizationPort,
  scopeService,
  qrService,
  routeInvalidationPort,
  eventPort,
  clock = () => Date.now(),
  idFactory = randomUUID
} = {}) {
  const store = repository ?? facilityRepository ?? facilityStore ?? facilityStoreAlias;
  if (!store) throw new TypeError('A facility repository port is required.');
  const scope = scopeService ?? createFacilityScopeService({ authorizationPort, claimStore: claimStore ?? store });

  return {
    requestClaim,
    createClaim: requestClaim,
    claimFacility: requestClaim,
    listPlaces,
    listFacilities: listPlaces,
    getPlace,
    getFacility: getPlace,
    createResponse,
    publishResponse: createResponse,
    publishFacilityResponse: createResponse,
    updateResponse,
    createIncident,
    reportIncident: createIncident,
    createFacilityIncident: createIncident,
    updateIncident,
    updateFacilityIncident: updateIncident,
    acknowledgeIncident,
    acknowledgeFacilityIncident: acknowledgeIncident,
    resolveIncident,
    resolveFacilityIncident: resolveIncident,
    createQrCode,
    validateQrContext,
    deleteCommunityObservation
  };

  async function requestClaim(input, context = {}) {
    const normalized = normalizeFacilityClaimInput(input);
    const user = await scope.requireClaimRequest(context, normalized.placeId);
    const record = {
      ...normalized,
      id: input.id ?? idFactory(),
      userId: userId(user, context),
      status: 'pending',
      createdAt: nowIso(clock),
      updatedAt: nowIso(clock),
      actorId: userId(user, context),
      actorRole: context.session?.user?.role ?? context.role ?? 'facility_manager'
    };
    const stored = await callStore(['createFacilityClaim', 'createClaim', 'createClaimRequest'], record);
    return serializeFacilityClaim(stored ?? record);
  }

  async function listPlaces(filters = {}, context = {}) {
    const normalized = normalizeFacilityListFilters(filters);
    const scopedIds = await scope.listScopedFacilityIds(context);
    const options = {
      ...normalized,
      ...(scopedIds ? { facilityIds: scopedIds } : {}),
      actorId: userId(context.session?.user, context),
      actorRole: context.session?.user?.role ?? context.role ?? 'facility_manager'
    };
    const result = await callStore(['listApprovedFacilities', 'listFacilities', 'listPlaces'], options);
    const records = (Array.isArray(result) ? result : result?.items ?? [])
      .filter((record) => !scopedIds || scopedIds.includes(record.id ?? record.placeId ?? record.place_id));
    const items = serializeFacilityList(records);
    return {
      items,
      pagination: result?.pagination ?? { page: normalized.page, pageSize: normalized.pageSize, total: items.length, hasNext: items.length >= normalized.pageSize }
    };
  }

  async function getPlace(placeId, context = {}) {
    const id = normalizeIdentifier(placeId, 'placeId');
    await scope.requireApprovedScope(context, id);
    const record = await callStore(['getFacility', 'getPlace', 'getByPlaceId'], id);
    return serializeFacilityPlace(record);
  }

  async function createResponse(input, context = {}) {
    const normalized = normalizeFacilityResponseInput(input);
    const user = await scope.requireApprovedScope(context, normalized.placeId);
    const record = {
      ...normalized,
      id: input.id ?? idFactory(),
      managerId: userId(user, context),
      source: 'facility',
      createdAt: nowIso(clock),
      updatedAt: nowIso(clock),
      actorId: userId(user, context),
      actorRole: context.session?.user?.role ?? context.role ?? 'facility_manager'
    };
    const stored = await callStore(['createFacilityResponse', 'createResponse'], record);
    return serializeFacilityResponse(stored ?? record);
  }

  async function updateResponse(responseId, patch, context = {}) {
    const id = normalizeIdentifier(responseId, 'responseId');
    const current = await callStore(['getFacilityResponse', 'getResponse', 'getResponseById'], id);
    if (!current) throw notFound('FACILITY_RESPONSE_NOT_FOUND', 'The facility response does not exist.');
    const placeId = normalizeIdentifier(current.placeId ?? current.place_id, 'placeId');
    const user = await scope.requireApprovedScope(context, placeId);
    const normalized = normalizeFacilityResponseInput(patch, { partial: true });
    if (normalized.placeId && normalized.placeId !== placeId) throw conflict('FACILITY_RESPONSE_SCOPE_IMMUTABLE', 'A facility response cannot move to another place.');
    delete normalized.placeId;
    const next = {
      ...current,
      ...normalized,
      managerId: current.managerId ?? userId(user, context),
      source: 'facility',
      actorId: userId(user, context),
      actorRole: context.session?.user?.role ?? context.role ?? 'facility_manager',
      updatedAt: nowIso(clock)
    };
    const stored = await callStore(['updateFacilityResponse', 'updateResponse'], id, next, current);
    return serializeFacilityResponse(stored ?? next);
  }

  async function createIncident(input, context = {}) {
    const normalized = normalizeFacilityIncidentInput(input);
    const user = await scope.requireApprovedScope(context, normalized.placeId);
    const record = {
      ...normalized,
      id: input.id ?? idFactory(),
      source: 'facility',
      reportedBy: userId(user, context),
      actorId: userId(user, context),
      actorRole: context.session?.user?.role ?? context.role ?? 'facility_manager',
      status: normalized.status ?? 'reported',
      startsAt: normalized.startsAt ?? nowIso(clock),
      createdAt: nowIso(clock),
      updatedAt: nowIso(clock)
    };
    const stored = await callStore(['createFacilityIncident', 'createIncident'], record);
    const result = stored ?? record;
    await afterIncidentChange(result, null, 'barrier.created');
    return serializeFacilityIncident(result);
  }

  async function updateIncident(incidentId, patch, context = {}) {
    const id = normalizeIdentifier(incidentId, 'incidentId');
    const current = await callStore(['getFacilityIncident', 'getIncident', 'getIncidentById'], id);
    if (!current) throw notFound('FACILITY_INCIDENT_NOT_FOUND', 'The facility incident does not exist.');
    const placeId = normalizeIdentifier(current.placeId ?? current.place_id, 'placeId');
    const user = await scope.requireApprovedScope(context, placeId);
    const normalized = normalizeFacilityIncidentInput(patch, { partial: true });
    if (normalized.placeId && normalized.placeId !== placeId) throw conflict('FACILITY_INCIDENT_SCOPE_IMMUTABLE', 'A facility incident cannot move to another place.');
    delete normalized.placeId;
    const next = {
      ...current,
      ...normalized,
      source: 'facility',
      updatedBy: userId(user, context),
      actorId: userId(user, context),
      actorRole: context.session?.user?.role ?? context.role ?? 'facility_manager',
      updatedAt: nowIso(clock)
    };
    if (next.status === 'resolved' && !next.resolvedAt) next.resolvedAt = nowIso(clock);
    const stored = await callStore(['updateFacilityIncident', 'updateIncident'], id, next, current);
    const result = stored ?? next;
    await afterIncidentChange(result, current, result.status === 'resolved' ? 'barrier.resolved' : 'barrier.updated');
    return serializeFacilityIncident(result);
  }

  async function acknowledgeIncident(incidentId, context = {}) {
    return updateIncident(incidentId, { status: 'acknowledged' }, context);
  }

  async function resolveIncident(incidentId, input = {}, context = {}) {
    return updateIncident(incidentId, { ...input, status: 'resolved' }, context);
  }

  async function createQrCode(input, context = {}) {
    const create = qrService && (qrService.create ?? qrService.createQrContext);
    if (typeof create !== 'function') throw new TypeError('qrService.create or qrService.createQrContext is required for QR creation.');
    const facilityId = normalizeIdentifier(input.facilityId ?? input.placeId, 'facilityId');
    await scope.requireApprovedScope(context, facilityId);
    const created = await create.call(qrService, { ...input, facilityId, placeId: input.placeId ?? facilityId }, context);
    const record = await callStore(['createQrCode', 'createQr'], {
      id: created.jti,
      facilityId,
      placeId: input.placeId ?? facilityId,
      token: created.token,
      expiresAt: created.expiresAt,
      context: created.context,
      createdBy: userId(context.user, context),
      createdAt: nowIso(clock)
    });
    return record ? { ...created, id: record.id ?? created.jti } : created;
  }

  async function validateQrContext(token, options = {}) {
    const validate = qrService && (qrService.validate ?? qrService.validateQrContext);
    if (typeof validate !== 'function') throw new TypeError('qrService.validate or qrService.validateQrContext is required for QR validation.');
    return validate.call(qrService, token, options);
  }

  async function deleteCommunityObservation() {
    throw new FacilityError('FACILITY_HISTORY_IMMUTABLE', 'Facility operations cannot delete community observations.', { status: 405, title: 'Community history is immutable here' });
  }

  async function afterIncidentChange(record, previous, eventType) {
    if (routeInvalidationPort && typeof routeInvalidationPort.invalidateForIncident === 'function') {
      try {
        await routeInvalidationPort.invalidateForIncident(record, { previous, reason: 'facility_incident_changed' });
      } catch {
        // Durable facility state must not be rolled back by cache fan-out.
      }
    }
    if (eventPort && typeof eventPort.publish === 'function') {
      try {
        await eventPort.publish(eventType, {
          eventType,
          placeId: record.placeId ?? record.place_id ?? null,
          incidentId: record.id,
          status: record.status,
          severity: record.severity,
          type: record.type ?? record.incidentType
        });
      } catch {
        // Outbox delivery owns retry behavior.
      }
    }
  }

  async function callStore(methods, ...args) {
    const method = methods.find((name) => typeof store[name] === 'function');
    if (!method) throw new TypeError(`Facility repository needs ${methods.join(' or ')}.`);
    return store[method](...args);
  }

  function userId(user, context) { return user?.id ?? user?.userId ?? context.actorId ?? context.userId ?? context.session?.user?.id ?? null; }
  function nowIso(clockFn) { return new Date(clockFn()).toISOString(); }
  function notFound(code, detail) { return new FacilityError(code, detail, { status: 404, title: 'Facility record not found' }); }
  function conflict(code, detail) { return new FacilityError(code, detail, { status: 409, title: 'Facility operation conflicts with existing record' }); }
}

export const createFacilityOperations = createFacilityService;
