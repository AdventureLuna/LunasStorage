import type { Box, InventoryRow, Item, Location, Photo } from './types';
export type Session = { user: { id: string; email: string } };
export type ItemQuery = { search: string; location: string; box: string; tag: string; archived: boolean; out: boolean; page: number; pageSize?: number };
export type Estimate = { box_id: string; known_volume_l: number; missing_estimate_count: number };
export type Export = { schema: string; version: number; exported_at: string; data: Record<string, unknown[]> };
export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}
export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('X-Inventory-Client', 'local');
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const response = await fetch(`/api${path}`, { ...options, headers, credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: `Server returned ${response.status}` }));
    if (response.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('inventory-auth-expired'));
    throw new ApiError(typeof error.detail === 'string' ? error.detail : JSON.stringify(error.detail), response.status);
  }
  return response.json() as Promise<T>;
}
const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });
const id = encodeURIComponent;
export const api = {
  authStatus: () => request<{ setup_required: boolean; session: Session | null }>('/auth/status'),
  login: (username: string, password: string, setup = false) => request<Session>(`/auth/${setup ? 'setup' : 'login'}`, json('POST', { username, password })),
  logout: async () => { await request('/auth/logout', { method: 'POST' }); window.dispatchEvent(new Event('inventory-auth-expired')); },
  locations: () => request<Location[]>('/locations'),
  saveLocation: (body: { name: string; parent_id: string | null }, current?: Location | null) => request<Location>(current ? `/locations/${id(current.id)}` : '/locations', json(current ? 'PUT' : 'POST', { ...body, expected_version: current?.version })),
  deleteLocation: (location: Location) => request(`/locations/${id(location.id)}?version=${location.version}`, { method: 'DELETE' }),
  boxes: () => request<Box[]>('/boxes'),
  saveBox: (body: { location_id: string; description: string | null; capacity_l: number | null }, current?: Box | null) => request<Box>(current ? `/boxes/${id(current.id)}` : '/boxes', json(current ? 'PUT' : 'POST', { ...body, expected_version: current?.version })),
  deleteBox: (box: Box) => request(`/boxes/${id(box.id)}?version=${box.version}`, { method: 'DELETE' }),
  estimates: () => request<Estimate[]>('/box-estimates'),
  listItems: (query: ItemQuery) => request<{ items: InventoryRow[]; count: number }>(`/items?${new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]))}`),
  item: (itemId: string) => request<InventoryRow>(`/items/${id(itemId)}`),
  saveItem: (item: Partial<Item> & { name: string }, expected?: number) => request<InventoryRow>(expected !== undefined ? `/items/${id(item.id!)}` : '/items', json(expected !== undefined ? 'PUT' : 'POST', { ...item, expected_version: expected })),
  archive: (item: InventoryRow) => request<InventoryRow>(`/items/${id(item.id)}/archive`, json('POST', { archived: !item.archived, expected_version: item.version })),
  deleteItems: (items: Array<{ id: string; version: number }>) => request<{ deleted: number; photo_cleanup_failures: string[] }>('/items/delete', json('POST', { items })),
  move: (itemIds: string[], destinationId: string, destinationType: 'box' | 'location') => request<{ moved: number }>('/moves', json('POST', { item_ids: itemIds, destination_id: destinationId, destination_type: destinationType })),
  photoOrder: (itemId: string, orderedIds: string[], coverId: string) => request(`/items/${id(itemId)}/photo-order`, json('PUT', { ordered_photo_ids: orderedIds, cover_photo_id: coverId })),
  deletePhoto: (photoId: string) => request<{ warning: string | null }>(`/photos/${id(photoId)}`, { method: 'DELETE' }),
  uploadPhoto: (itemId: string, photoId: string, blob: Blob) => {
    const body = new FormData(); body.append('file', blob, 'photo.jpg');
    return request<Photo>(`/items/${id(itemId)}/photos?photo_id=${id(photoId)}`, { method: 'POST', body });
  },
  export: () => request<Export>('/export'),
};
