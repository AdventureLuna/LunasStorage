import { usePanel } from './hooks';
import { useState, type ReactNode } from 'react';
import { ArrowLeft, Archive, Image, MapPin, Pencil } from 'lucide-react';
import type { Box, InventoryRow, Location } from '../lib/types';


import { locationPath, useWorkspace, message } from './model';
import { ErrorMessage } from './common';
import { DestinationPicker } from './DestinationPicker';
import { PhotoViewer } from './PhotoViewer';

type Props = {
  item: InventoryRow;
  locations: Location[];
  boxes: Box[];
  photo: (path: string) => ReactNode;
  onEdit: () => void;
  onArchive: () => void;
  onMove: (destination: string) => Promise<void>;
};

export function ItemPage({ item, locations, photo, onEdit, onArchive, onMove }: Props) {
  const {back}=useWorkspace();const panel=usePanel();const[error,setError]=useState('');
  const cover = item.item_photos.find(image => image.is_cover) ?? item.item_photos[0];
  const [chosenPhoto, setChosenPhoto] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const destination=item.box_id?`b:${item.box_id}`:`l:${item.location_id}`;
  const activePhoto = item.item_photos.find(image => image.id === chosenPhoto) ?? cover;
  return <section className="item-page">
    <button className="back-link" onClick={()=>back('/items')}><ArrowLeft size={17}/> Back</button><ErrorMessage error={error}/>
    <div className="item-page-layout">
      <div className="item-gallery">
        <button className="item-hero" aria-label="Open full-screen photos" onClick={()=>{if(activePhoto)panel.open('photos')}}>{activePhoto ? photo(activePhoto.object_path) : <span className="no-item-photo"><Image size={52}/><span>No photo yet</span></span>}</button>
        {item.item_photos.length > 1 && <div className="item-thumbnails" aria-label="Item photos">{item.item_photos.map((image, index) => <button key={image.id} aria-label={`View photo ${index + 1}`} aria-pressed={activePhoto?.id === image.id} onClick={() => setChosenPhoto(image.id)}>{photo(image.object_path)}</button>)}</div>}
      </div>
      <div className="item-information">
        <span className="item-eyebrow">{item.archived ? 'Archived item' : 'In your inventory'}</span>
        <h1>{item.name}</h1>
        <p className="item-page-address"><MapPin size={18}/>{locationPath(locations,item.boxes?.location_id||item.location_id)}{item.boxes?` ? ${item.boxes.description||'Box '+item.boxes.box_number}`:''}</p>
        <div className="meta">{item.tags.map(tag => <em key={tag}>{tag}</em>)}</div>
        <dl className="item-facts"><div><dt>Quantity</dt><dd>{item.quantity === null ? 'Not recorded' : `${item.quantity_approximate ? 'About ' : ''}${item.quantity} ${item.quantity_unit || ''}`}</dd></div>{item.volume_l !== null && <div><dt>Estimated volume</dt><dd>{item.volume_l} L</dd></div>}</dl>
        <div className="item-page-actions"><button className="primary" onClick={onEdit}><Pencil size={17}/> Edit item</button><button onClick={onArchive}><Archive size={17}/>{item.archived ? 'Restore' : 'Archive'}</button></div>
        <section className="item-description"><h2>Notes</h2><p>{item.notes || 'No notes for this item yet.'}</p></section>
        <button className="move-item" disabled={moving} onClick={()=>panel.open('move-item')}>{moving?'Moving?':'Move to another box or location'}</button>
        {panel.panel==='move-item'&&<DestinationPicker value={destination} onClose={panel.close} onChoose={value=>{setMoving(true);void onMove(value).catch(error=>setError(message(error))).finally(()=>setMoving(false))}}/>}
        {panel.panel==='photos'&&activePhoto&&<PhotoViewer photos={item.item_photos} activeId={activePhoto.id} onChoose={setChosenPhoto} onClose={panel.close}/>}

      </div>
    </div>
  </section>;
}
