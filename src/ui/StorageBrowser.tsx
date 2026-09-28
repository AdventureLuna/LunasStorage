import { useState } from 'react';
import { Box as BoxIcon, ChevronRight, Folder, Home, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import type { Box, Location } from '../lib/types';
import { boxLabel } from '../lib/box-label';

type Props = {
  locations: Location[];
  boxes: Box[];
  estimates: Record<string, { known_volume_l: number; missing_estimate_count: number }>;
  onNewLocation: (parentId: string | null) => void;
  onEditLocation: (location: Location) => void;
  onDeleteLocation: (location: Location) => void;
  onNewBox: (locationId: string) => void;
  onEditBox: (box: Box) => void;
  onDeleteBox: (box: Box) => void;
  onContents: (box: Box) => void;
  onAddItem: (box: Box) => void;
};

export function StorageBrowser(props: Props) {
  const { locations, boxes, estimates } = props;
  const [locationId, setLocationId] = useState<string | null>(null);
  const [expandedBox, setExpandedBox] = useState<string | null>(null);
  const current = locations.find(location => location.id === locationId);
  const parentId = current?.id ?? null;
  const children = locations.filter(location => location.parent_id === parentId).sort((a, b) => a.name.localeCompare(b.name));
  const visibleBoxes = boxes.filter(box => box.location_id === parentId).sort((a, b) => boxLabel(a).localeCompare(boxLabel(b), undefined, { numeric: true }));
  const ancestors: Location[] = [];
  let ancestor = current;
  while (ancestor && !ancestors.some(location => location.id === ancestor!.id)) {
    ancestors.unshift(ancestor);
    const nextId: string | null = ancestor.parent_id;
    ancestor = locations.find(location => location.id === nextId);
  }
  const navigate = (id: string | null) => { setLocationId(id); setExpandedBox(null); };

  return <section className="storage-browser">
    <nav className="breadcrumbs" aria-label="Location path">
      <button onClick={() => navigate(null)} aria-current={!current ? 'page' : undefined}><Home size={16}/> All locations</button>
      {ancestors.map(location => <span key={location.id}><ChevronRight size={14}/><button onClick={() => navigate(location.id)} aria-current={location.id === current?.id ? 'page' : undefined}>{location.name}</button></span>)}
    </nav>
    <div className="storage-heading">
      <div><h1>{current?.name ?? 'Storage'}</h1><p>{current ? 'Open a box to fill it or see what is inside.' : 'Choose a location to explore its shelves and boxes.'}</p></div>
      {current && <details className="location-menu"><summary aria-label="Location options"><MoreHorizontal/></summary><div>
        <button onClick={() => props.onEditLocation(current)}><Pencil size={16}/> Edit location</button>
        <button className="danger-button" onClick={() => props.onDeleteLocation(current)}><Trash2 size={16}/> Delete location</button>
      </div></details>}
    </div>
    <div className="storage-create">
      <button onClick={() => props.onNewLocation(parentId)}><Plus size={17}/>{current ? 'Add sub-location' : 'Add location'}</button>
      {current && <button className="primary" onClick={() => props.onNewBox(current.id)}><Plus size={17}/> Add box</button>}
    </div>
    {children.length > 0 && <section className="storage-section" aria-label="Locations">
      <h2>{current ? 'Sub-locations' : 'Locations'} <span>{children.length}</span></h2>
      <div className="storage-rows">{children.map(location => {
        const childCount = locations.filter(child => child.parent_id === location.id).length;
        const boxCount = boxes.filter(box => box.location_id === location.id).length;
        return <button className="folder-row" key={location.id} onClick={() => navigate(location.id)}>
          <span className="storage-row-icon"><Folder/></span><span className="storage-row-label"><strong>{location.name}</strong><small>{boxCount} {boxCount === 1 ? 'box' : 'boxes'}{childCount ? ` · ${childCount} sub-locations` : ''}</small></span><ChevronRight size={19}/>
        </button>;
      })}</div>
    </section>}
    {current && visibleBoxes.length > 0 && <section className="storage-section" aria-label="Boxes">
      <h2>Boxes <span>{visibleBoxes.length}</span></h2>
      <div className="storage-rows">{visibleBoxes.map(box => <div className="storage-box" key={box.id}>
        <button className="folder-row" aria-expanded={expandedBox === box.id} aria-controls={`box-actions-${box.id}`} onClick={() => setExpandedBox(expandedBox === box.id ? null : box.id)}>
          <span className="storage-row-icon box"><BoxIcon/></span><span className="storage-row-label"><strong>{boxLabel(box)}</strong></span><ChevronRight className={expandedBox === box.id ? 'rotated' : ''} size={19}/>
        </button>
        {expandedBox === box.id && <div className="box-expanded" id={`box-actions-${box.id}`}>
          <div className="box-primary-actions"><button className="primary" onClick={() => props.onAddItem(box)}><Plus size={16}/> Fill this box</button><button onClick={() => props.onContents(box)}>View items</button></div>
          <div className="box-secondary-actions"><button className="text-button" onClick={() => props.onEditBox(box)}><Pencil size={15}/> Edit</button><button className="text-button danger-button" onClick={() => props.onDeleteBox(box)}><Trash2 size={15}/> Delete</button></div>
          <details className="box-estimates"><summary>Space estimates</summary><p>{Number(estimates[box.id]?.known_volume_l ?? 0).toLocaleString()} L of recorded item volume · {estimates[box.id]?.missing_estimate_count ?? 0} items without an estimate{box.capacity_l !== null ? ` · ${box.capacity_l} L capacity` : ''}</p></details>
        </div>}
      </div>)}</div>
    </section>}
    {children.length === 0 && visibleBoxes.length === 0 && <div className="storage-blank"><Folder size={32}/><h2>{current ? 'Ready to fill' : 'Start with a location'}</h2><p>{current ? 'Add a box or a sub-location here.' : 'Add a room, cupboard or shelf, then put boxes inside it.'}</p></div>}
  </section>;
}
