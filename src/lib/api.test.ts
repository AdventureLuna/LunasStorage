import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './api';
import { uploadPhoto } from './data';
import { newId } from './id';

afterEach(() => vi.unstubAllGlobals());
describe('local API transport on LAN HTTP', () => {
  it('uses relative API URLs, same-origin sessions and typed stale-edit errors', async () => {
    const transport = vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: 'changed elsewhere' }), { status: 409 }));
    vi.stubGlobal('fetch', transport);
    await expect(api.saveLocation({ name: 'Room', parent_id: null }, { id: 'id', name: 'Room', parent_id: null, version: 3 })).rejects.toBeInstanceOf(ApiError);
    const [url, request] = transport.mock.calls[0];
    expect(url).toBe('/api/locations/id');
    expect(request.credentials).toBe('same-origin');
    expect(request.headers.get('X-Inventory-Client')).toBe('local');
    expect(JSON.parse(request.body).expected_version).toBe(3);
  });
  it('generates UUIDs without the HTTPS-only randomUUID method and reuses photo IDs across an uncertain retry', async () => {
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const transport = vi.fn().mockRejectedValueOnce(new TypeError('connection lost')).mockResolvedValue(new Response(JSON.stringify({ id: 'saved' })));
    vi.stubGlobal('fetch', transport);
    vi.stubGlobal('createImageBitmap', undefined);
    const file = new File(['test image'], 'photo.jpg', { type: 'image/jpeg' });
    await expect(uploadPhoto('item', file)).rejects.toThrow('connection lost');
    await uploadPhoto('item', file);
    expect(transport.mock.calls[0][0]).toBe(transport.mock.calls[1][0]);
    expect(transport.mock.calls[0][0]).toMatch(/^\/api\/items\/item\/photos\?photo_id=/);
  });
});
