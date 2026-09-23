// @vitest-environment node
import { beforeAll, afterAll, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

let db;
const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const c = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
async function setUser(id) {
  await db.exec('reset role; set local role authenticated;');
  await db.query('select set_config($1,$2,true)', ['request.jwt.claim.sub', id]);
}
async function expectDbError(run) { await db.exec('savepoint expected_error'); let failed = false; try { await run(); } catch { failed = true; } if (failed) await db.exec('rollback to savepoint expected_error'); await db.exec('release savepoint expected_error'); expect(failed).toBe(true); }

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`create role anon nologin; create role authenticated nologin;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(bucket_id text,name text,owner_id text,primary key(bucket_id,name)); alter table storage.objects enable row level security;
    alter default privileges in schema public grant select,insert,update,delete on tables to anon;
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select case when strpos(name,'/')=0 then array[]::text[] else string_to_array(regexp_replace(name,'/[^/]+$',''),'/') end $$;
    grant usage on schema public,auth,storage to anon,authenticated;
    grant execute on function auth.uid() to anon,authenticated;
    grant select,insert,update,delete on storage.objects to authenticated;
    insert into auth.users values ('${a}'),('${b}'),('${c}');`);
  const migration = await readFile(new URL('../supabase/migrations/202609230001_initial.sql', import.meta.url), 'utf8');
  await db.exec(migration);
});
afterAll(async () => { await db?.close(); });

it('applies the migration and enforces numbering, ownership, destinations, cycles, stale versions, search, movement, photos, and archive semantics', async () => {
  await db.exec('begin');
  try {
    await setUser(a);
    const { rows: [location] } = await db.query("insert into public.locations(name) values ('Basement shelf') returning id");
    const { rows: [otherLocation] } = await db.query("insert into public.locations(name) values ('Garage') returning id");
    const { rows: [nested] } = await db.query("insert into public.locations(name,parent_id) values ('Rack',$1) returning id", [location.id]);
    await expectDbError(() => db.query('update public.locations set parent_id=$1 where id=$2', [nested.id, location.id]));
    await expectDbError(() => db.query('update public.locations set parent_id=id where id=$1', [location.id]));

    const { rows: [box1] } = await db.query('insert into public.boxes(location_id,description) values ($1,$2) returning id,box_number', [location.id, 'Screws']);
    const { rows: [box2] } = await db.query('insert into public.boxes(location_id) values ($1) returning id,box_number', [location.id]);
    expect([box1.box_number, box2.box_number]).toEqual([1, 2]);
    await expectDbError(() => db.query('insert into public.boxes(location_id,box_number) values ($1,9)', [location.id]));
    await expectDbError(() => db.query('update public.boxes set box_number=9 where id=$1', [box1.id]));

    await setUser(b);
    const { rows: [foreignLocation] } = await db.query("insert into public.locations(name) values ('Private B') returning id");
    await setUser(a);
    await expectDbError(() => db.query('insert into public.boxes(location_id) values ($1)', [foreignLocation.id]));
    await expectDbError(() => db.query("insert into public.items(name,location_id,box_id) values ('Both', $1, $2)", [location.id, box1.id]));
    await expectDbError(() => db.query("insert into public.items(name) values ('Neither')"));
    await expectDbError(() => db.query("insert into public.items(name,location_id,quantity,volume_l) values ('Negative',$1,-1,0)", [location.id]));
    const { rows: [item] } = await db.query("insert into public.items(name,notes,tags,box_id,quantity,volume_l) values ('Ikea shelf accessories','metal screws',ARRAY['ikea'], $1, null, 3) returning id,version,quantity,volume_l", [box1.id]);
    expect(item.quantity).toBeNull(); expect(Number(item.volume_l)).toBe(3);
    const estimate = await db.query('select * from public.box_estimates() where box_id=$1', [box1.id]);
    expect(Number(estimate.rows[0].known_volume_l)).toBe(3); expect(estimate.rows[0].missing_estimate_count).toBe(0);
    await db.query("insert into public.items(name,box_id) values ('unknown volume',$1)", [box1.id]);
    expect((await db.query('select * from public.box_estimates() where box_id=$1', [box1.id])).rows[0].missing_estimate_count).toBe(1);
    const first = await db.query("update public.items set name='Edited' where id=$1 and version=$2 returning version", [item.id, item.version]);
    expect(first.rows).toHaveLength(1);
    const stale = await db.query("update public.items set name='Stale' where id=$1 and version=$2 returning id", [item.id, item.version]);
    expect(stale.rows).toHaveLength(0);
    const search = await db.query("select public.search_item_ids('Basement') as id");
    expect(search.rows.some(row => row.id === item.id)).toBe(true);
    await db.query("insert into public.items(name,location_id) select 'needle record '||n,$1 from generate_series(1,35) n", [location.id]);
    const allMatches = await db.query("select id from public.items where id=any(array(select public.search_item_ids('needle')))");
    expect(allMatches.rows).toHaveLength(35);

    const missingItem = 'aaaaaaaa-0000-4000-8000-000000000000';
    await expectDbError(() => db.query('select public.move_items_atomic($1::uuid[],$2::uuid,$3)', [[item.id, missingItem], box2.id, 'box']));
    expect((await db.query('select box_id from public.items where id=$1', [item.id])).rows[0].box_id).toBe(box1.id);
    await db.query('select public.move_items_atomic($1::uuid[],$2::uuid,$3)', [[item.id], box2.id, 'box']);
    const moved = await db.query('select b.box_number,l.name from public.items i join public.boxes b on b.id=i.box_id join public.locations l on l.id=b.location_id where i.id=$1', [item.id]);
    expect(moved.rows[0]).toMatchObject({ box_number: 2, name: 'Basement shelf' });
    await db.query('update public.boxes set location_id=$1 where id=$2', [otherLocation.id, box2.id]);
    const following = await db.query('select l.name from public.items i join public.boxes b on b.id=i.box_id join public.locations l on l.id=b.location_id where i.id=$1', [item.id]);
    expect(following.rows[0].name).toBe('Garage');
    expect((await db.query('select public.item_ids_at_location($1) as id', [otherLocation.id])).rows.some(row => row.id === item.id)).toBe(true);
    expect((await db.query('select public.item_ids_at_location($1) as id', [location.id])).rows.some(row => row.id === item.id)).toBe(false);
    await db.query('update public.items set quantity=0 where id=$1', [item.id]);
    const volume = await db.query('select quantity,volume_l from public.items where id=$1', [item.id]);
    expect(Number(volume.rows[0].quantity)).toBe(0); expect(Number(volume.rows[0].volume_l)).toBe(3);

    const objectPath = `${a}/${item.id}/photo.jpg`;
    await db.query('insert into storage.objects(bucket_id,name,owner_id) values ($1,$2,$3)', ['inventory-photos', objectPath, a]);
    expect((await db.query('select name from storage.objects where name=$1', [objectPath])).rows).toHaveLength(1);
    await db.query('insert into public.item_photos(item_id,object_path) values ($1,$2)', [item.id, objectPath]);
    await expectDbError(() => db.query('insert into public.item_photos(item_id,object_path) values ($1,$2)', [item.id, `${b}/${item.id}/bad.jpg`]));
    const photo = await db.query('select id from public.item_photos where item_id=$1', [item.id]);
    await db.query('select public.reorder_item_photos($1,$2::uuid[],$3)', [item.id, [photo.rows[0].id], photo.rows[0].id]);
    await db.query('update public.items set archived=true,archived_at=now() where id=$1', [item.id]);
    expect((await db.query('select archived from public.items where id=$1', [item.id])).rows[0].archived).toBe(true);

    await setUser(b);
    expect((await db.query('select id from public.items where id=$1', [item.id])).rows).toHaveLength(0);
    await expectDbError(() => db.query('insert into public.items(name,location_id) values ($1,$2)', ['stolen', location.id]));
    expect((await db.query('select name from storage.objects where name=$1', [objectPath])).rows).toHaveLength(0);
    await expectDbError(() => db.query('insert into storage.objects(bucket_id,name,owner_id) values ($1,$2,$3)', ['inventory-photos', objectPath, b]));
    await db.exec('reset role; set local role anon;');
    expect((await db.query('select id from public.items')).rows).toHaveLength(0);
    await expectDbError(() => db.query("insert into public.locations(name) values ('anon')"));

    await setUser(c);
    const restoreLocation = '66666666-6666-4666-8666-666666666666', restoreBox = '77777777-7777-4777-8777-777777777777', restoreItem = '88888888-8888-4888-8888-888888888888', restorePhoto = '99999999-9999-4999-8999-999999999999';
    const restorePath = `${c}/${restoreItem}/restored.jpg`;
    await db.query('insert into storage.objects(bucket_id,name,owner_id) values ($1,$2,$3)', ['inventory-photos', restorePath, c]);
    const payload = { schema: 'home-storage-inventory', version: 1, data: {
      locations: [{ id: restoreLocation, owner_id: a, name: 'Restored location', parent_id: null, version: 1 }],
      boxes: [{ id: restoreBox, owner_id: a, box_number: 7, location_id: restoreLocation, description: 'Restored box', version: 1 }],
      items: [{ id: restoreItem, owner_id: a, name: 'Restored item', box_id: restoreBox, location_id: null, quantity: null, volume_l: 2, tags: [] }],
      item_photos: [{ id: restorePhoto, owner_id: a, item_id: restoreItem, object_path: restorePath, sort_order: 0, is_cover: true }],
    } };
    const restored = await db.query('select public.restore_inventory($1::jsonb) as counts', [JSON.stringify(payload)]);
    expect(restored.rows[0].counts).toMatchObject({ locations: 1, boxes: 1, items: 1, item_photos: 1 });
    expect((await db.query('select owner_id,box_number from public.boxes where id=$1', [restoreBox])).rows[0]).toMatchObject({ owner_id: c, box_number: 7 });
    const { rows: [nextBox] } = await db.query('insert into public.boxes(location_id) values ($1) returning box_number', [restoreLocation]);
    expect(nextBox.box_number).toBe(8);
    await expectDbError(() => db.query('select public.restore_inventory($1::jsonb)', [JSON.stringify(payload)]));
  } finally { await db.exec('rollback'); }
});
