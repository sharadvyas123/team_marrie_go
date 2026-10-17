import { FacilityError } from './errors.mjs';

/**
 * Authorization adapter for facility operations. The application auth module
 * remains the source of role/session policy; this service only composes that
 * port with the durable approved-claim lookup.
 */
export function createFacilityScopeService({ authorizationPort, claimStore } = {}) {
  if (!authorizationPort || typeof authorizationPort !== 'object') {
    throw new TypeError('authorizationPort is required.');
  }

  return {
    requireClaimRequest,
    requireApprovedScope,
    hasApprovedScope,
    listScopedFacilityIds,
    isPrivileged
  };

  async function requireClaimRequest(context = {}, placeId) {
    const session = context.session ?? context;
    const user = await callAuthorization(['requireRole', 'requireFacilityClaim', 'hasRole'], session, ['facility_manager', 'admin']);
    if (!user) throw forbidden('FACILITY_CLAIM_ROLE_REQUIRED', 'An active facility manager account is required to request a claim.');
    return user;
  }

  async function requireApprovedScope(context = {}, placeId) {
    const session = context.session ?? context;
    if (!validId(placeId)) throw forbidden('FACILITY_SCOPE_INVALID', 'A valid facility scope is required.');
    const authorized = await callAuthorization(['requireApprovedFacilityScope', 'requireFacilityScope', 'hasFacilityScope'], session, placeId, {
      action: context.action,
      allowRoles: ['admin', 'moderator']
    });
    if (!authorized) throw forbidden('FACILITY_SCOPE_REQUIRED', 'This account is not authorized for the requested facility.');

    if (!isPrivileged(session)) {
      const claim = await findApprovedClaim(placeId, userId(session));
      if (!claim || claim.status !== 'approved') {
        throw forbidden('FACILITY_CLAIM_NOT_APPROVED', 'An approved facility claim is required for this operation.');
      }
      return { user: authorized, claim };
    }
    return { user: authorized, claim: null };
  }

  async function hasApprovedScope(context = {}, placeId) {
    try {
      await requireApprovedScope(context, placeId);
      return true;
    } catch (error) {
      if (error instanceof FacilityError && error.status === 403) return false;
      throw error;
    }
  }

  async function listScopedFacilityIds(context = {}) {
    const session = context.session ?? context;
    if (isPrivileged(session)) return null;
    const user = await callAuthorization(['requireRole', 'hasRole'], session, ['facility_manager', 'admin']);
    if (!user) throw forbidden('FACILITY_CLAIM_ROLE_REQUIRED', 'An active facility manager account is required.');
    const direct = session?.user?.facilityIds ?? session?.user?.facilities;
    if (!claimStore) return Array.isArray(direct) ? [...new Set(direct.filter(validId))] : [];
    const result = await callStore(['listApprovedClaims', 'findApprovedClaimsForUser', 'listForUser'], userId(session));
    if (result === null && Array.isArray(direct)) {
      // A scope embedded in a session is only a candidate list. The claim
      // repository remains authoritative, so a revoked claim cannot remain
      // active because of stale session state.
      const approved = [];
      for (const placeId of direct.filter(validId)) {
        if (await findApprovedClaim(placeId, userId(session))) approved.push(placeId);
      }
      return [...new Set(approved)];
    }
    return (Array.isArray(result) ? result : result?.items ?? [])
      .filter((claim) => claim?.status === 'approved')
      .map((claim) => claim.placeId ?? claim.place_id)
      .filter(validId);
  }

  function isPrivileged(session) {
    const role = session?.user?.role;
    return role === 'admin' || role === 'moderator';
  }

  async function findApprovedClaim(placeId, ownerId) {
    if (!claimStore) return null;
    const method = ['findApprovedClaim', 'getApprovedClaim', 'getApprovedClaimForUser', 'findApprovedForFacility', 'findForUserAndPlace', 'getClaim'].find((name) => typeof claimStore[name] === 'function');
    if (!method) return null;
    const result = ['findForUserAndPlace', 'getApprovedClaimForUser'].includes(method)
      ? await claimStore[method](ownerId, placeId)
      : await claimStore[method](placeId, ownerId);
    if (Array.isArray(result)) return result.find((claim) => claim?.status === 'approved') ?? null;
    return result?.status === 'approved' ? result : null;
  }

  async function callAuthorization(methods, ...args) {
    const method = methods.find((name) => typeof authorizationPort[name] === 'function');
    if (!method) throw new TypeError(`authorizationPort needs ${methods.join(' or ')}.`);
    try {
      const result = await authorizationPort[method](...args);
      if (method === 'hasRole' || method === 'hasFacilityScope') return result ? (args[0]?.user ?? args[0]) : null;
      return result;
    } catch (error) {
      if (error?.status === 401 || error?.status === 403 || error?.name === 'AuthError') throw error;
      throw error;
    }
  }

  async function callStore(methods, ...args) {
    const method = methods.find((name) => typeof claimStore?.[name] === 'function');
    if (!method) return null;
    return claimStore[method](...args);
  }

  function userId(session) { return session?.user?.id ?? session?.user?.userId ?? session?.userId ?? null; }
  function validId(value) { return typeof value === 'string' && value.trim().length > 0; }
  function forbidden(code, detail) { return new FacilityError(code, detail, { status: 403, title: 'Facility authorization denied' }); }
}
