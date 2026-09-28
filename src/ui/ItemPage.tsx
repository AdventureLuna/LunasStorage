import { useState, type ReactNode } from 'react';
import { ArrowLeft, Archive, Image, MapPin, Pencil } from 'lucide-react';
import type { Box, InventoryRow, Location } from '../lib/types';
import { boxLabel } from '../lib/box-label';
import { address } from '../lib/data';

type Props = {
  item: InventoryRow;
  locations: Location[];
  boxes: Box[];
  photo: (path: string) => ReactNode;
  onEdit: () => void;
  onArchive: () => void;
  onMove: (destination: string) => Promise<void>;
};

export function ItemPage({ item, locations, boxes, photo, onEdit, onArchive, onMove }: Props) {
  const cover = item.item_photos.find(image => image.is_cover) ?? item.item_photos[0];
  const [chosenPhoto, setChosenPhoto] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [destination, setDestination] = useState(item.box_id ? `b:${item.box_id}` : `l:${item.location_id}`);
  const activePhoto = item.item_photos.find(image => image.id === chosenPhoto) ?? cover;
  return <section className="item-page">
    <a className="back-link" href="#/items"><ArrowLeft size={17}/> Back to inventory</a>
    <div className="item-page-layout">
      <div className="item-gallery">
        <div className="item-hero">{activePhoto ? photo(activePhoto.object_path) : <span className="no-item-photo"><Image size={52}/><span>No photo yet</span></span>}</div>
        {item.item_photos.length > 1 && <div className="item-thumbnails" aria-label="Item photos">{item.item_photos.map((image, index) => <button key={image.id} aria-label={`View photo ${index + 1}`} aria-pressed={activePhoto?.id === image.id} onClick={() => setChosenPhoto(image.id)}>{photo(image.object_path)}</button>)}</div>}
      </div>
      <div className="item-information">
        <span className="item-eyebrow">{item.archived ? 'Archived item' : 'In your inventory'}</span>
        <h1>{item.name}</h1>
        <p className="item-page-address"><MapPin size={18}/>{address(item)}</p>
        <div className="meta">{item.tags.map(tag => <em key={tag}>{tag}</em>)}</div>
        <dl className="item-facts"><div><dt>Quantity</dt><dd>{item.quantity === null ? 'Not recorded' : `${item.quantity_approximate ? 'About ' : ''}${item.quantity} ${item.quantity_unit || ''}`}</dd></div>{item.volume_l !== null && <div><dt>Estimated volume</dt><dd>{item.volume_l} L</dd></div>}</dl>
        <div className="item-page-actions"><button className="primary" onClick={onEdit}><Pencil size={17}/> Edit item</button><button onClick={onArchive}><Archive size={17}/>{item.archived ? 'Restore' : 'Archive'}</button></div>
        <section className="item-description"><h2>Notes</h2><p>{item.notes || 'No notes for this item yet.'}</p></section>
        <details className="move-item"><summary>Move to another location or box</summary><label>Destination<select value={destination} onChange={event => setDestination(event.target.value)}>{locations.map(location => <optgroup key={location.id} label={location.name}><option value={`l:${location.id}`}>{location.name} (unboxed)</option>{boxes.filter(box => box.location_id === location.id).map(box => <option key={box.id} value={`b:${box.id}`}>{boxLabel(box)}</option>)}</optgroup>)}</select></label><button disabled={moving || !destination} onClick={async () => { setMoving(true); try { await onMove(destination); } finally { setMoving(false); } }}>{moving ? 'Moving…' : 'Move item'}</button></details>
      </div>
    </div>
  </section>;
}
