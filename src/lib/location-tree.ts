import type { Location } from './types';

export type LocationNode = Location & { children: LocationNode[] };

export function buildLocationTree(locations: Location[]): LocationNode[] {
  const nodes = new Map(locations.map(location => [location.id, { ...location, children: [] as LocationNode[] }]));
  const roots: LocationNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parent_id ? nodes.get(node.parent_id) : undefined;
    if (parent && parent.id !== node.id) parent.children.push(node);
    else roots.push(node);
  }
  const sort = (branch: LocationNode[]) => {
    branch.sort((a, b) => a.name.localeCompare(b.name));
    branch.forEach(node => sort(node.children));
  };
  sort(roots);
  return roots;
}

export function locationAndDescendants(locations: Location[], locationId: string): Set<string> {
  const result = new Set<string>([locationId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const location of locations) {
      if (location.parent_id && result.has(location.parent_id) && !result.has(location.id)) {
        result.add(location.id);
        changed = true;
      }
    }
  }
  return result;
}
