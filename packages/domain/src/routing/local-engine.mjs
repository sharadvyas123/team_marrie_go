import { RouteRequestError } from './errors.mjs';

/**
 * A deterministic fallback engine for the seeded access graphs. It deliberately
 * operates only on the graph snapshot supplied by the repository adapter. A
 * deployment that needs city-wide routing can inject an OSRM/Valhalla adapter
 * into the application service without changing the route contract.
 */
export function createLocalRoutingEngine({ now = () => Date.now() } = {}) {
  return {
    async calculate(request, { accessGraph } = {}) {
      const graph = normalizeGraph(accessGraph);
      if (graph.nodes.length === 0 || graph.edges.length === 0) {
        throw new RouteRequestError(
          'A routing provider is not configured for the requested access graph.',
          { code: 'ROUTING_GRAPH_UNAVAILABLE', status: 503 }
        );
      }

      const origin = selectNode(graph.nodes, request.origin, 'origin');
      const destination = selectNode(graph.nodes, request.destination, 'destination');
      if (!origin || !destination) {
        throw new RouteRequestError(
          'The requested route endpoints are not present in the local access graph.',
          { code: 'ROUTING_ENDPOINT_UNAVAILABLE', status: 404 }
        );
      }

      const path = shortestPath(graph, origin.id, destination.id);
      if (!path) return { routes: [] };

      const segments = path.edges.map((edge, sequence) => ({
        ...edge,
        id: edge.id,
        edgeId: edge.id,
        sequence,
        observedAt: edge.lastObservedAt ?? null
      }));
      return {
        id: `local-${hash(`${origin.id}:${destination.id}:${segments.map((edge) => edge.id).join(',')}`)}`,
        distanceMeters: path.distanceMeters,
        durationSeconds: Math.max(60, Math.ceil(path.distanceMeters / 1.25)),
        calculatedAt: new Date(now()).toISOString(),
        segments
      };
    }
  };
}

function normalizeGraph(value) {
  const nodes = (Array.isArray(value?.nodes) ? value.nodes : [])
    .filter((node) => node && typeof node.id === 'string')
    .map((node) => ({ ...node, id: String(node.id) }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const edges = (Array.isArray(value?.edges) ? value.edges : [])
    .filter((edge) => edge && typeof edge.id === 'string' && edge.fromNodeId && edge.toNodeId)
    .filter((edge) => edge.status !== 'blocked' && edge.status !== 'closed')
    .map((edge) => ({ ...edge, id: String(edge.id) }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return { nodes, edges };
}

function selectNode(nodes, endpoint, role) {
  if (endpoint?.nodeId) return nodes.find((node) => node.id === endpoint.nodeId) ?? null;
  if (endpoint?.placeId) {
    const matching = nodes.filter((node) => node.placeId === endpoint.placeId || node.place_id === endpoint.placeId);
    if (matching.length === 0) return null;
    return role === 'origin'
      ? matching.find((node) => node.type === 'entrance' || node.nodeType === 'entrance') ?? matching[0]
      : matching.find((node) => ['room', 'toilet', 'lift'].includes(node.type ?? node.nodeType)) ?? matching.at(-1);
  }
  if (endpoint?.latitude !== undefined && endpoint?.longitude !== undefined) {
    return nodes
      .map((node) => ({ node, distance: squaredDistance(node.latitude, node.longitude, endpoint.latitude, endpoint.longitude) }))
      .sort((left, right) => left.distance - right.distance || left.node.id.localeCompare(right.node.id))[0]?.node ?? null;
  }
  return null;
}

function shortestPath(graph, originId, destinationId) {
  const distances = new Map([[originId, 0]]);
  const previous = new Map();
  const pending = new Set(graph.nodes.map((node) => node.id));
  const edgesByFrom = new Map();
  for (const edge of graph.edges) {
    const list = edgesByFrom.get(edge.fromNodeId) ?? [];
    list.push(edge);
    edgesByFrom.set(edge.fromNodeId, list);
  }

  while (pending.size > 0) {
    const current = [...pending]
      .sort((left, right) => (distances.get(left) ?? Infinity) - (distances.get(right) ?? Infinity) || left.localeCompare(right))[0];
    if (current === undefined || !Number.isFinite(distances.get(current))) break;
    pending.delete(current);
    if (current === destinationId) break;
    for (const edge of edgesByFrom.get(current) ?? []) {
      if (!pending.has(edge.toNodeId)) continue;
      const distance = distances.get(current) + edgeDistance(edge, graph);
      const existing = distances.get(edge.toNodeId);
      const previousEdge = previous.get(edge.toNodeId)?.edge;
      if (existing === undefined || distance < existing || (distance === existing && edge.id.localeCompare(previousEdge?.id ?? '') < 0)) {
        distances.set(edge.toNodeId, distance);
        previous.set(edge.toNodeId, { nodeId: current, edge });
      }
    }
  }

  if (!distances.has(destinationId)) return null;
  const edges = [];
  let cursor = destinationId;
  while (cursor !== originId) {
    const step = previous.get(cursor);
    if (!step) return null;
    edges.push(step.edge);
    cursor = step.nodeId;
  }
  edges.reverse();
  return { edges, distanceMeters: distances.get(destinationId) };
}

function edgeDistance(edge, graph) {
  if (Number.isFinite(Number(edge.distanceMeters))) return Math.max(1, Number(edge.distanceMeters));
  const from = graph.nodes.find((node) => node.id === edge.fromNodeId);
  const to = graph.nodes.find((node) => node.id === edge.toNodeId);
  if (from && to && [from.latitude, from.longitude, to.latitude, to.longitude].every(Number.isFinite)) {
    return Math.max(1, Math.round(Math.sqrt(squaredDistance(from.latitude, from.longitude, to.latitude, to.longitude)) * 111_000));
  }
  return 1;
}

function squaredDistance(leftLatitude, leftLongitude, rightLatitude, rightLongitude) {
  return ((Number(leftLatitude) - Number(rightLatitude)) ** 2) + ((Number(leftLongitude) - Number(rightLongitude)) ** 2);
}

function hash(value) {
  let result = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16_777_619);
  }
  return (result >>> 0).toString(16).padStart(8, '0');
}
