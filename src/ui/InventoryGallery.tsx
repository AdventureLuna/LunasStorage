import { Archive, Image, MapPin } from 'lucide-react';
import type { ReactNode } from 'react';
import type { InventoryRow } from '../lib/types';
import { address } from '../lib/data';

type Props = {
  rows: InventoryRow[];
  selected: string[];
  onSelect: (id: string, selected: boolean) => void;
  onArchive: (row: InventoryRow) => void;
  photo: (path: string) => ReactNode;
};

export function InventoryGallery({ rows, selected, onSelect, onArchive, photo }: Props) {
  return <div className="inventory-grid">{rows.map(row => {
    const cover = row.item_photos.find(image => image.is_cover) ?? row.item_photos[0];
    return <article className={`inventory-card${selected.includes(row.id) ? ' selected' : ''}`} key={row.id}>
      <div className="inventory-image">
        <a href={`#/item/${row.id}`} aria-label={`View ${row.name}`}>{cover ? photo(cover.object_path) : <span className="no-item-photo"><Image size={36}/><span>No photo yet</span></span>}</a>
        <label className="card-select"><input aria-label={`Select ${row.name}`} type="checkbox" checked={selected.includes(row.id)} onChange={event => onSelect(row.id, event.target.checked)}/></label>
        {row.item_photos.length > 1 && <span className="photo-count"><Image size={13}/>{row.item_photos.length}</span>}
      </div>
      <div className="inventory-card-body">
        <a className="inventory-card-title" href={`#/item/${row.id}`}>{row.name}</a>
        <p className="card-address"><MapPin size={14}/>{address(row)}</p>
        <div className="meta">{row.tags.slice(0, 3).map(tag => <em key={tag}>{tag}</em>)}{row.tags.length > 3 && <span>+{row.tags.length - 3}</span>}</div>
        <div className="card-footer"><span>{row.quantity === null ? 'Quantity not set' : row.quantity === 0 ? 'Out of stock' : `${row.quantity_approximate ? '~' : ''}${row.quantity} ${row.quantity_unit || 'available'}`}</span><button className="icon" aria-label={`${row.archived ? 'Restore' : 'Archive'} ${row.name}`} title={row.archived ? 'Restore' : 'Archive'} onClick={() => onArchive(row)}><Archive size={16}/></button></div>
      </div>
    </article>;
  })}</div>;
}
