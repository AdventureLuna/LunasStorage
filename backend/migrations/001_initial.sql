CREATE TABLE account (id INTEGER PRIMARY KEY CHECK(id=1), username TEXT NOT NULL, password_hash TEXT NOT NULL);
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, expires_at REAL NOT NULL);
CREATE TABLE login_attempts (address TEXT PRIMARY KEY, attempts INTEGER NOT NULL, first_at REAL NOT NULL);
CREATE TABLE locations (
 id TEXT PRIMARY KEY, owner_id TEXT, name TEXT NOT NULL CHECK(length(trim(name))>0),
 parent_id TEXT REFERENCES locations(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 version INTEGER NOT NULL CHECK(version>0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE counters (id INTEGER PRIMARY KEY CHECK(id=1), next_number INTEGER NOT NULL CHECK(next_number>0));
INSERT INTO counters VALUES(1,1);
CREATE TABLE boxes (
 id TEXT PRIMARY KEY, owner_id TEXT, box_number INTEGER NOT NULL UNIQUE CHECK(box_number>0),
 location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
 description TEXT, capacity_l REAL CHECK(capacity_l>=0), version INTEGER NOT NULL CHECK(version>0),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TRIGGER immutable_box_number BEFORE UPDATE OF box_number ON boxes
 WHEN NEW.box_number<>OLD.box_number BEGIN SELECT RAISE(ABORT,'Box number is immutable'); END;
CREATE TABLE items (
 id TEXT PRIMARY KEY, owner_id TEXT, name TEXT NOT NULL CHECK(length(trim(name))>0), notes TEXT,
 tags TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(tags) AND json_type(tags)='array'),
 quantity REAL CHECK(quantity>=0), quantity_unit TEXT, quantity_approximate INTEGER NOT NULL CHECK(quantity_approximate IN(0,1)),
 volume_l REAL CHECK(volume_l>=0), location_id TEXT REFERENCES locations(id) ON DELETE RESTRICT,
 box_id TEXT REFERENCES boxes(id) ON DELETE RESTRICT, archived INTEGER NOT NULL CHECK(archived IN(0,1)), archived_at TEXT,
 version INTEGER NOT NULL CHECK(version>0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 CHECK((location_id IS NOT NULL)+(box_id IS NOT NULL)=1), CHECK((archived=1 AND archived_at IS NOT NULL) OR (archived=0 AND archived_at IS NULL)));
CREATE TABLE item_photos (
 id TEXT PRIMARY KEY, owner_id TEXT, item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
 object_path TEXT NOT NULL UNIQUE, sort_order INTEGER NOT NULL CHECK(sort_order>=0),
 is_cover INTEGER NOT NULL CHECK(is_cover IN(0,1)), created_at TEXT NOT NULL);
CREATE INDEX items_created ON items(created_at DESC,id);
CREATE INDEX items_box ON items(box_id);
CREATE INDEX items_location ON items(location_id);
CREATE INDEX photos_item ON item_photos(item_id,sort_order);
CREATE INDEX location_parent ON locations(parent_id);
CREATE TABLE import_jobs (id TEXT PRIMARY KEY, completed_at TEXT NOT NULL, report TEXT NOT NULL);
