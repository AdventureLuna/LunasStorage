import { act, startTransition, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PhotoPicker } from './PhotoPicker';
import { StorageView } from './StorageView';
import {useLocation} from 'react-router-dom';
import {createMemoryRouter,RouterProvider} from 'react-router-dom';
import {WorkspaceContext,emptySummary} from './model';
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
      return <PhotoPicker files={files} disabled={false} onRemove={index => setFiles(current => current.filter((_, i) => i !== index))}
        onFiles={picked => startTransition(() => setFiles(current => [...current, ...picked]))}/>;
    }
    await act(() => root.render(<Harness/>));
    const input = container.querySelector('input[aria-label="Choose photos from the gallery"]') as HTMLInputElement;
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
  it('shows descendant totals, navigable box pages and loose entries without nested action clutter', async () => {
    vi.stubGlobal('fetch',vi.fn().mockImplementation(async()=>new Response(JSON.stringify({items:[],count:0}))));
    function Places(){const route=useLocation();const parts=route.pathname.split('/');return <StorageView locationId={parts[1]==='storage'?parts[2]:undefined} boxId={parts[1]==='box'?parts[2]:undefined}/>}
    const summary={...emptySummary,totals:{locations:2,boxes:1,items:4,archived_items:0},locations:{room:{direct_boxes:0,direct_items:1,boxes:1,items:4,archived_items:0},shelf:{direct_boxes:1,direct_items:0,boxes:1,items:3,archived_items:0}},boxes:{box:{items:3,archived_items:0,known_volume_l:0,missing_estimate_count:3}}};
    const router=createMemoryRouter([{path:'*',element:<WorkspaceContext.Provider value={{userId:'test',locations,boxes,summary,revision:0,go:vi.fn(),back:vi.fn(),refresh:async()=>{},notify:vi.fn()}}><Places/></WorkspaceContext.Provider>}],{initialEntries:['/storage']});
    await act(async()=>root.render(<RouterProvider router={router}/>));
    expect(container.textContent).toContain('4 active entries inside');
    expect(container.textContent).toContain('Shelf A');
    expect(container.textContent).not.toContain('Box 10');
    await act(async()=>{await router.navigate('/storage/shelf')});
    expect(container.querySelector('a[href="#/box/box"]')).toBeTruthy();
    expect(container.textContent).toContain('Loose items here');
    await act(async()=>{await router.navigate('/box/box')});
    expect(container.querySelector('a[href="#/box/box/fill"]')?.textContent).toContain('Fill this box');
    expect(container.textContent).toContain('Box contents');
    router.dispose();
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
    const router=createMemoryRouter([{path:'*',element:<WorkspaceContext.Provider value={{userId:'test',locations,boxes,summary:emptySummary,revision:0,go:vi.fn(),back:vi.fn(),refresh:async()=>{},notify:vi.fn()}}><ItemPage item={item} locations={locations} boxes={boxes} onEdit={vi.fn()} onArchive={vi.fn()} onMove={move} photo={path => <img src={path} alt="Test photo"/>}/></WorkspaceContext.Provider>}],{initialEntries:['/item/item']});
    await act(() => root.render(<RouterProvider router={router}/>));
    expect(container.querySelector('.item-hero img')?.getAttribute('src')).toBe('one');
    await act(() => (container.querySelector('[aria-label="View photo 2"]') as HTMLButtonElement).click());
    expect(container.querySelector('.item-hero img')?.getAttribute('src')).toBe('two');
    await act(()=>{([...container.querySelectorAll('button')].find(button=>button.textContent==='Move to another box or location')!).click()});
    const destination=[...container.querySelectorAll('.destination-row')].find(row=>row.querySelector('strong')?.textContent==='Basement') as HTMLButtonElement;
    await act(async()=>{destination.click()});
    expect(move).toHaveBeenCalledWith('l:room');router.dispose();
  });
});
