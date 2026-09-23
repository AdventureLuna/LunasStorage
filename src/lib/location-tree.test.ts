import { describe, expect, it } from 'vitest';
import type { Location } from './types';
import { buildLocationTree, locationAndDescendants } from './location-tree';

const loc = (id: string, name: string, parent_id: string | null): Location => ({ id, name, parent_id, version: 1 });

describe('location hierarchy', () => {
  it('nests and sorts children while keeping separate roots', () => {
    const tree = buildLocationTree([
      loc('r2', 'Office', null), loc('c2', 'Desk drawer', 'r1'), loc('r1', 'Basement', null),
      loc('c1', 'Attic', 'r1'), loc('g1', 'Small parts', 'c2'),
    ]);
    expect(tree.map(node => node.name)).toEqual(['Basement', 'Office']);
    expect(tree[0].children.map(node => node.name)).toEqual(['Attic', 'Desk drawer']);
    expect(tree[0].children[1].children[0].name).toBe('Small parts');
  });

  it('identifies a location and all descendants to prevent selecting a cyclic parent', () => {
    const locations = [loc('root', 'Root', null), loc('child', 'Child', 'root'), loc('grandchild', 'Grandchild', 'child'), loc('other', 'Other', null)];
    expect(locationAndDescendants(locations, 'child')).toEqual(new Set(['child', 'grandchild']));
  });
});
