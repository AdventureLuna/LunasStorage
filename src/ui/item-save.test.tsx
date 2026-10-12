import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import type { InventoryRow } from '../lib/types';
import {createMemoryRouter,RouterProvider} from 'react-router-dom';

const mocks = vi.hoisted(() => ({ saveItem: vi.fn(), uploadPhoto: vi.fn(), listItems: vi.fn(), deleteItems: vi.fn(),locations:vi.fn(),locationBatch:vi.fn() }));
vi.mock('../lib/data', () => ({
  ...mocks,
  address: () => '',
  exportRows: vi.fn(), exportZip: vi.fn(), photoUrl: vi.fn(), setPhotoOrder: vi.fn(), removePhotoRecord: vi.fn(),
}));

vi.mock('../lib/api', () => ({api:{
  deleteItems:mocks.deleteItems,
  authStatus:async()=>({setup_required:false,session:{user:{id:'luna',email:'luna@example.test'}}}),
  locations:mocks.locations,
  locationBatch:mocks.locationBatch,
  boxes:async()=>[{id:'box',box_number:1,description:'Box 10',location_id:'shelf',capacity_l:null,version:1}],
  estimates:async()=>[],
  summary:async()=>({totals:{locations:1,boxes:1,items:1,archived_items:0},locations:{shelf:{direct_boxes:1,direct_items:1,boxes:1,items:1,archived_items:0}},boxes:{box:{items:0,archived_items:0,known_volume_l:0,missing_estimate_count:0}}}),
}}));
let root: Root;
let router:ReturnType<typeof createMemoryRouter>;
let container: HTMLDivElement;
const existingItem: InventoryRow = { id: 'existing', version: 4, name: 'Existing brackets', notes: null, tags: [], quantity: null, quantity_unit: null, quantity_approximate: false, volume_l: null, location_id: 'shelf', box_id: null, archived: false, archived_at: null, created_at: '', locations: { id: 'shelf', name: 'Shelf', parent_id: null, version: 1 }, boxes: null, item_photos: [] };
beforeEach(async () => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  history.replaceState({}, '', '#/items');
  localStorage.clear();sessionStorage.clear();
  vi.stubGlobal('fetch',vi.fn().mockImplementation(async()=>new Response(new Blob(['image'],{type:'image/jpeg'}))));
  vi.stubGlobal('scrollTo',vi.fn());
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL() { return 'blob:preview'; }
    static revokeObjectURL() {}
  });
  mocks.listItems.mockResolvedValue({ items: [existingItem], count: 1 });
  mocks.locations.mockResolvedValue([{id:'shelf',name:'Shelf',parent_id:null,version:1}]);
  vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
  mocks.saveItem.mockImplementation(async (_item, version) => ({ id: 'new-item', version: (version ?? 0) + 1 }));
  mocks.uploadPhoto.mockImplementation(async (_id, file) => ({ id: file.name, object_path: file.name, sort_order: 0, is_cover: false }));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  router=createMemoryRouter([{path:'*',element:<App/>}],{initialEntries:['/items']});
  await act(async () => { root.render(<RouterProvider router={router}/>); });
});
afterEach(async () => { await act(() => root.unmount()); container.remove(); router.dispose();vi.unstubAllGlobals(); });

async function click(text: string) {
  const button = [...container.querySelectorAll<HTMLElement>('button,a')].find(node => node.textContent?.trim() === text||node.getAttribute('aria-label')===text);
  expect(button, `Button: ${text}`).toBeTruthy();
  await act(async () => { button!.click(); });
}
async function prepareItem() {
  await click('Add item');
  const name = container.querySelector('input[placeholder="e.g. Ikea shelf accessories"]') as HTMLInputElement;
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(name, 'Brackets');
    name.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('Change');
  const destination=[...container.querySelectorAll('.destination-row')].find(row=>row.querySelector('strong')?.textContent==='Box 10') as HTMLButtonElement;
  await act(()=>destination.click());
  const input = container.querySelector('input[aria-label="Choose photos from the gallery"]') as HTMLInputElement;
  let files = [new File(['a'], 'one.jpg', { type: 'image/jpeg' }), new File(['b'], 'two.jpg', { type: 'image/jpeg' })];
  Object.defineProperty(input, 'files', { get: () => files });
  Object.defineProperty(input, 'value', { get: () => '', set: () => { files = []; } });
  await act(() => input.dispatchEvent(new Event('change', { bubbles: true })));
}

it('saves both selected photos and keeps the named box selected for the next item', async () => {
  await prepareItem();
  await click('Save & next');
  expect(mocks.saveItem.mock.calls[0][0]).toMatchObject({ name: 'Brackets', box_id: 'box', location_id: null });
  expect(mocks.uploadPhoto.mock.calls.map(call => call[1].name)).toEqual(['one.jpg', 'two.jpg']);
  expect(container.querySelector('.destination-context strong')?.textContent).toContain('Box 10');
  expect((container.querySelector('input[placeholder="e.g. Ikea shelf accessories"]') as HTMLInputElement).value).toBe('');
  expect(container.querySelectorAll('.pending-photo')).toHaveLength(0);
});

it('keeps upload errors visible after refresh and retries only failed photos on the saved item', async () => {
  mocks.uploadPhoto.mockRejectedValueOnce(new Error('Network interrupted'));
  await prepareItem();
  await click('Save item');
  expect(container.textContent).toContain('Network interrupted');
  expect(container.querySelectorAll('.pending-photo')).toHaveLength(1);
  expect(container.querySelector('.pending-photo figcaption')?.textContent).toBe('one.jpg');
  await click('Retry remaining photos');
  await click('Save item');
  expect(mocks.saveItem.mock.calls[1][0]).toMatchObject({ id: 'new-item' });
  expect(mocks.saveItem.mock.calls[1][1]).toBe(1);
  expect(mocks.uploadPhoto.mock.calls.map(call => call[1].name)).toEqual(['one.jpg', 'two.jpg', 'one.jpg']);
  expect(container.querySelector('.item-fields')).toBeNull();
});

it('confirms bulk deletion, prevents duplicate actions, and clears selection after success', async () => {
  await click('Select');
  await act(() => (container.querySelector('[aria-label="Select Existing brackets"]') as HTMLInputElement).click());
  vi.mocked(confirm).mockReturnValueOnce(false);
  await click('Delete selected');
  expect(mocks.deleteItems).not.toHaveBeenCalled();
  let complete!: (value: { deleted: number; photo_cleanup_failures: string[] }) => void;
  mocks.deleteItems.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  await click('Delete selected');
  expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining('Permanently delete 1 selected item and all their photos? This cannot be undone.'));
  expect(vi.mocked(confirm).mock.calls.at(-1)?.[0]).toContain('Existing brackets');
  expect(mocks.deleteItems).toHaveBeenCalledWith([{ id: 'existing', version: 4 }]);
  expect((container.querySelector('[aria-label="Select Existing brackets"]') as HTMLInputElement).disabled).toBe(true);
  expect([...container.querySelectorAll('.bulk button')].every(button => (button as HTMLButtonElement).disabled)).toBe(true);
  mocks.listItems.mockResolvedValue({ items: [], count: 0 });
  await act(async () => { complete({ deleted: 1, photo_cleanup_failures: [] }); });
  expect(container.querySelector('.bulk')).toBeNull();
  expect(container.textContent).not.toContain('Existing brackets');
});

it('keeps selected items and displays a stale-deletion error', async () => {
  mocks.deleteItems.mockRejectedValueOnce(new Error('This record changed elsewhere'));
  await click('Select');
  await act(() => (container.querySelector('[aria-label="Select Existing brackets"]') as HTMLInputElement).click());
  await click('Delete selected');
  expect(container.textContent).toContain('This record changed elsewhere');
  expect((container.querySelector('[aria-label="Select Existing brackets"]') as HTMLInputElement).checked).toBe(true);
});

it('fills a box continuously, counts the saved entry once through retries, and clears photos for the next item', async () => {
  await act(async()=>{await router.navigate('/box/box/fill')});
  const name=container.querySelector('[aria-label="Item name"]') as HTMLInputElement;
  await act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(name,'Tools');name.dispatchEvent(new Event('input',{bubbles:true}))});
  const input=container.querySelector('[aria-label="Choose photos from the gallery"]') as HTMLInputElement;
  Object.defineProperty(input,'files',{value:[new File(['a'],'one.jpg',{type:'image/jpeg'})]});
  await act(()=>input.dispatchEvent(new Event('change',{bubbles:true})));
  mocks.uploadPhoto.mockRejectedValueOnce(new Error('Upload interrupted'));
  await click('Save & next');
  expect(container.querySelector('.filling-progress')?.textContent).toContain('1 added this session');
  await click('Retry remaining photos');
  expect(container.querySelector('.filling-progress')?.textContent).toContain('1 added this session');
  await click('Save & next');
  expect((container.querySelector('[aria-label="Item name"]') as HTMLInputElement).value).toBe('');
  expect(container.querySelector('.destination-context')?.textContent).toContain('Box 10');
  expect(container.querySelectorAll('.pending-photo')).toHaveLength(0);
  expect(container.querySelectorAll('.saved-photo')).toHaveLength(0);
});

it('does not prompt for an inherited destination, but protects and then discards actual edits', async () => {
  localStorage.setItem('inventory-destination:luna','b:box');
  await click('Add item');
  await click('Back');
  expect(confirm).not.toHaveBeenCalled();
  await click('Add item');
  const name=container.querySelector('[aria-label="Item name"]') as HTMLInputElement;
  await act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(name,'Unsaved name');name.dispatchEvent(new Event('input',{bubbles:true}))});
  vi.mocked(confirm).mockReturnValueOnce(false);
  await click('Back');
  expect((container.querySelector('[aria-label="Item name"]') as HTMLInputElement).value).toBe('Unsaved name');
  vi.mocked(confirm).mockReturnValueOnce(true);
  await click('Back');
  await click('Add item');
  expect((container.querySelector('[aria-label="Item name"]') as HTMLInputElement).value).toBe('');
});

it('keeps the item draft during failed inline creation and returns with the created destination', async () => {
  await click('Add item');
  const name=container.querySelector('[aria-label="Item name"]') as HTMLInputElement;
  await act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(name,'Brackets');name.dispatchEvent(new Event('input',{bubbles:true}))});
  await click('Change');await click('Create location');
  const locationName=container.querySelector('[role="dialog"] input') as HTMLInputElement;
  await act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(locationName,'New cupboard');locationName.dispatchEvent(new Event('input',{bubbles:true}))});
  mocks.locationBatch.mockRejectedValueOnce(new Error('Creation interrupted'));
  await click('Create and select');
  expect(locationName.value).toBe('New cupboard');
  expect(name.value).toBe('Brackets');
  const newPlace={id:'cupboard',name:'New cupboard',parent_id:null,version:1};
  mocks.locationBatch.mockResolvedValueOnce([newPlace]);mocks.locations.mockResolvedValue([{id:'shelf',name:'Shelf',parent_id:null,version:1},newPlace]);
  await click('Create and select');
  expect(container.querySelector('.destination-context')?.textContent).toContain('New cupboard');
  expect((container.querySelector('[aria-label="Item name"]') as HTMLInputElement).value).toBe('Brackets');
  expect(mocks.locationBatch.mock.calls[0][2]).toBe(mocks.locationBatch.mock.calls[1][2]);
});
