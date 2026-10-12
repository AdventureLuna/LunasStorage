import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import type { InventoryRow } from '../lib/types';

const mocks = vi.hoisted(() => ({ saveItem: vi.fn(), uploadPhoto: vi.fn(), listItems: vi.fn(), deleteItems: vi.fn() }));
vi.mock('../lib/data', () => ({
  ...mocks,
  address: () => '',
  exportRows: vi.fn(), exportZip: vi.fn(), photoUrl: vi.fn(), setPhotoOrder: vi.fn(), removePhotoRecord: vi.fn(),
}));

vi.mock('../lib/api', () => ({api:{
  deleteItems:mocks.deleteItems,
  authStatus:async()=>({setup_required:false,session:{user:{id:'luna',email:'luna@example.test'}}}),
  locations:async()=>[{id:'shelf',name:'Shelf',parent_id:null,version:1}],
  boxes:async()=>[{id:'box',box_number:1,description:'Box 10',location_id:'shelf',capacity_l:null,version:1}],
  estimates:async()=>[],
}}));
let root: Root;
let container: HTMLDivElement;
const existingItem: InventoryRow = { id: 'existing', version: 4, name: 'Existing brackets', notes: null, tags: [], quantity: null, quantity_unit: null, quantity_approximate: false, volume_l: null, location_id: 'shelf', box_id: null, archived: false, archived_at: null, created_at: '', locations: { id: 'shelf', name: 'Shelf', parent_id: null, version: 1 }, boxes: null, item_photos: [] };
beforeEach(async () => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  history.replaceState({}, '', '#/items');
  localStorage.clear();
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL() { return 'blob:preview'; }
    static revokeObjectURL() {}
  });
  mocks.listItems.mockResolvedValue({ items: [existingItem], count: 1 });
  vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
  mocks.saveItem.mockImplementation(async (_item, version) => ({ id: 'new-item', version: (version ?? 0) + 1 }));
  mocks.uploadPhoto.mockImplementation(async (_id, file) => ({ id: file.name, object_path: file.name, sort_order: 0, is_cover: false }));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => { root.render(<App/>); });
});
afterEach(async () => { await act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

async function click(text: string) {
  const button = [...container.querySelectorAll('button')].find(node => node.textContent?.trim() === text);
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
  const destination = container.querySelector('.item-fields select') as HTMLSelectElement;
  await act(() => { destination.value = 'b:box'; destination.dispatchEvent(new Event('change', { bubbles: true })); });
  const input = container.querySelector('input[aria-label="Choose photos from the gallery"]') as HTMLInputElement;
  let files = [new File(['a'], 'one.jpg', { type: 'image/jpeg' }), new File(['b'], 'two.jpg', { type: 'image/jpeg' })];
  Object.defineProperty(input, 'files', { get: () => files });
  Object.defineProperty(input, 'value', { get: () => '', set: () => { files = []; } });
  await act(() => input.dispatchEvent(new Event('change', { bubbles: true })));
}

it('saves both selected photos and keeps the named box selected for the next item', async () => {
  await prepareItem();
  await click('Save & add another');
  expect(mocks.saveItem.mock.calls[0][0]).toMatchObject({ name: 'Brackets', box_id: 'box', location_id: null });
  expect(mocks.uploadPhoto.mock.calls.map(call => call[1].name)).toEqual(['one.jpg', 'two.jpg']);
  expect((container.querySelector('.item-fields select') as HTMLSelectElement).value).toBe('b:box');
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
  await click('Retry failed photos');
  expect(mocks.saveItem.mock.calls[1][0]).toMatchObject({ id: 'new-item' });
  expect(mocks.saveItem.mock.calls[1][1]).toBe(1);
  expect(mocks.uploadPhoto.mock.calls.map(call => call[1].name)).toEqual(['one.jpg', 'two.jpg', 'one.jpg']);
  expect(container.querySelector('.item-fields')).toBeNull();
});

it('confirms bulk deletion, prevents duplicate actions, and clears selection after success', async () => {
  await act(() => (container.querySelector('[aria-label="Select Existing brackets"]') as HTMLInputElement).click());
  vi.mocked(confirm).mockReturnValueOnce(false);
  await click('Delete selected');
  expect(mocks.deleteItems).not.toHaveBeenCalled();
  let complete!: (value: { deleted: number; photo_cleanup_failures: string[] }) => void;
  mocks.deleteItems.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  await click('Delete selected');
  expect(confirm).toHaveBeenLastCalledWith('Permanently delete 1 selected item and all their photos? This cannot be undone.');
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
  await act(() => (container.querySelector('[aria-label="Select Existing brackets"]') as HTMLInputElement).click());
  await click('Delete selected');
  expect(container.textContent).toContain('This record changed elsewhere');
  expect((container.querySelector('[aria-label="Select Existing brackets"]') as HTMLInputElement).checked).toBe(true);
});
