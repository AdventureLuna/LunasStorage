import { act, startTransition, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PhotoPicker } from './PhotoPicker';
import { StorageBrowser } from './StorageBrowser';
import { ItemPage } from './ItemPage';
import { InventoryGallery } from './InventoryGallery';
import type { Box, InventoryRow, Location } from '../lib/types';
import { boxLabel } from '../lib/box-label';
import { lastDestination, rememberDestination } from '../lib/destination';

let container: HTMLDivElement;
let root: Root;
const locations: Location[] = [
  { id: 'room', name: 'Basement', parent_id: null, version: 1 },
  { id: 'shelf', name: 'Shelf A', parent_id: 'room', version: 1 },
];
const boxes: Box[] = [{ id: 'box', box_number: 1, description: 'Box 10', location_id: 'shelf', capacity_l: null, version: 1 }];
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  localStorage.clear();
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL() { return 'blob:preview'; }
    static revokeObjectURL() { /* No resources in jsdom. */ }
  });
});
afterEach(async () => { await act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe('photo selection regression', () => {
  it('retains every selected file after the picker is reset and React defers its update', async () => {
    function Harness() {
      const [files, setFiles] = useState<File[]>([]);
      return <PhotoPicker files={files} disabled={false} onCamera={() => {}} onRemove={index => setFiles(current => current.filter((_, i) => i !== index))}
        onFiles={picked => startTransition(() => setFiles(current => [...current, ...picked]))}/>;
    }
    await act(() => root.render(<Harness/>));
    const input = container.querySelector('input[type=file]') as HTMLInputElement;
    let selection = [new File(['a'], 'one.jpg', { type: 'image/jpeg' }), new File(['b'], 'two.jpg', { type: 'image/jpeg' })];
    Object.defineProperty(input, 'files', { get: () => selection });
    Object.defineProperty(input, 'value', { get: () => '', set: () => { selection = []; } });
    await act(() => input.dispatchEvent(new Event('change', { bubbles: true })));
    expect(selection).toEqual([]);
    expect([...container.querySelectorAll('figcaption')].map(node => node.textContent)).toEqual(['one.jpg', 'two.jpg']);
    selection = [new File(['c'], 'three.jpg', { type: 'image/jpeg' })];
    await act(() => input.dispatchEvent(new Event('change', { bubbles: true })));
    expect(container.querySelectorAll('figure')).toHaveLength(3);
    await act(() => (container.querySelector('[aria-label="Remove pending photo two.jpg"]') as HTMLButtonElement).click());
    expect([...container.querySelectorAll('figcaption')].map(node => node.textContent)).toEqual(['one.jpg', 'three.jpg']);
  });
});

describe('storage browsing and box labels', () => {
  it('shows only the current level and reaches a named box through its parent locations', async () => {
    const add = vi.fn();
    await act(() => root.render(<StorageBrowser locations={locations} boxes={boxes} estimates={{}} onNewLocation={vi.fn()} onEditLocation={vi.fn()} onDeleteLocation={vi.fn()} onNewBox={vi.fn()} onEditBox={vi.fn()} onDeleteBox={vi.fn()} onContents={vi.fn()} onAddItem={add}/>));
    expect(container.textContent).not.toContain('Shelf A');
    expect(container.textContent).not.toContain('Box 10');
    await act(() => (container.querySelector('.folder-row') as HTMLButtonElement).click());
    expect(container.textContent).toContain('Shelf A');
    expect(container.textContent).not.toContain('Box 10');
    await act(() => (container.querySelector('.folder-row') as HTMLButtonElement).click());
    expect(container.textContent).toContain('Box 10');
    expect(container.textContent).not.toContain('Fill this box');
    await act(() => (container.querySelector('.folder-row') as HTMLButtonElement).click());
    await act(() => (container.querySelector('.box-primary-actions button') as HTMLButtonElement).click());
    expect(add).toHaveBeenCalledWith(boxes[0]);
    await act(() => (container.querySelector('.breadcrumbs button') as HTMLButtonElement).click());
    expect(container.textContent).not.toContain('Box 10');
  });

  it('accepts arbitrary labels while keeping legacy unnamed boxes readable', () => {
    expect(boxLabel(boxes[0])).toBe('Box 10');
    expect(boxLabel({ ...boxes[0], description: 'Holiday decorations' })).toBe('Holiday decorations');
    expect(boxLabel({ ...boxes[0], description: null })).toBe('Box 1');
  });

  it('remembers the chosen box per account and discards deleted destinations', () => {
    rememberDestination('luna', 'b:box');
    expect(lastDestination('luna', locations, boxes)).toBe('b:box');
    expect(lastDestination('other', locations, boxes)).toBe('');
    expect(lastDestination('luna', locations, [])).toBe('');
  });
});

describe('catalog item pages', () => {
  const item: InventoryRow = { id: 'item', name: 'Shelf brackets', notes: 'For the large shelf', tags: ['hardware'], quantity: 4, quantity_unit: 'pieces', quantity_approximate: false, volume_l: null, location_id: null, box_id: 'box', archived: false, archived_at: null, version: 1, created_at: '', locations: null, boxes: { ...boxes[0], locations: locations[1] }, item_photos: [
    { id: 'photo1', item_id: 'item', object_path: 'one', sort_order: 0, is_cover: true },
    { id: 'photo2', item_id: 'item', object_path: 'two', sort_order: 1, is_cover: false },
  ] };
  it('links cards to individual pages and displays the named box', async () => {
    await act(() => root.render(<InventoryGallery rows={[item]} selected={[]} onSelect={vi.fn()} onArchive={vi.fn()} photo={path => <img src={path} alt="Test photo"/>}/>));
    expect(container.querySelector('.inventory-card-title')?.getAttribute('href')).toBe('#/item/item');
    expect(container.textContent).toContain('Shelf A · Box 10');
  });
  it('switches the large image and passes the chosen move destination', async () => {
    const move = vi.fn().mockResolvedValue(undefined);
    await act(() => root.render(<ItemPage item={item} locations={locations} boxes={boxes} onEdit={vi.fn()} onArchive={vi.fn()} onMove={move} photo={path => <img src={path} alt="Test photo"/>}/>));
    expect(container.querySelector('.item-hero img')?.getAttribute('src')).toBe('one');
    await act(() => (container.querySelector('[aria-label="View photo 2"]') as HTMLButtonElement).click());
    expect(container.querySelector('.item-hero img')?.getAttribute('src')).toBe('two');
    const select = container.querySelector('select')!;
    await act(() => { select.value = 'l:room'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    await act(async () => { (container.querySelector('.move-item button') as HTMLButtonElement).click(); await Promise.resolve(); });
    expect(move).toHaveBeenCalledWith('l:room');
  });
});
