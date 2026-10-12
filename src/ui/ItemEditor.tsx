import { usePanel, useUnsaved } from './hooks';
import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal, Check } from 'lucide-react';
import { api } from '../lib/api';
import { newId } from '../lib/id';
import { saveItem, uploadPhoto, setPhotoOrder, removePhotoRecord, photoRequestId } from '../lib/data';
import { lastDestination, rememberDestination } from '../lib/destination';
import type { InventoryRow, Photo as PhotoRecord } from '../lib/types';
import { DestinationPicker } from './DestinationPicker';
import { PhotoPicker } from './PhotoPicker';
import { Photo } from './Photo';
import { ErrorMessage, FormHeader, Sheet } from './common';
import { destinationLabel, locationPath, message, useWorkspace } from './model';

type Fields={name:string;destination:string;notes:string;tags:string;quantity:string;unit:string;approx:boolean;volume:string};
type Queued={file:File;state:'ready'|'uploading'|'saved'|'error';error?:string};
const clean=(destination:string):Fields=>({name:'',destination,notes:'',tags:'',quantity:'',unit:'',approx:false,volume:''});
const fields=(item:InventoryRow):Fields=>({name:item.name,destination:item.box_id?`b:${item.box_id}`:`l:${item.location_id}`,notes:item.notes||'',tags:item.tags.join(', '),quantity:item.quantity===null?'':String(item.quantity),unit:item.quantity_unit||'',approx:item.quantity_approximate,volume:item.volume_l===null?'':String(item.volume_l)});

export function ItemEditor({itemId,fillBoxId,destination}:{itemId?:string;fillBoxId?:string;destination?:string}){
  const{userId,locations,boxes,summary,refresh,go,notify}=useWorkspace();
  const initial=clean(destination|| (fillBoxId?`b:${fillBoxId}`:lastDestination(userId,locations,boxes)));
  const[form,setForm]=useState<Fields>(initial),[baseline,setBaseline]=useState<Fields>(initial),[queue,setQueue]=useState<Queued[]>([]),[savedPhotos,setSavedPhotos]=useState<PhotoRecord[]>([]),[item,setItem]=useState<InventoryRow|null>(null),[loading,setLoading]=useState(!!itemId),[busy,setBusy]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState(''),[sessionCount,setSessionCount]=useState(0),[repeat,setRepeat]=useState(false),[photoMenu,setPhotoMenu]=useState<string|null>(null);
  const metadata=useRef<{id:string;version:number}|null>(null),creationId=useRef(newId()),allow=useRef(false),saving=useRef(false);
  const[validation,setValidation]=useState<Partial<Record<'name'|'destination'|'quantity'|'volume',string>>>({});
  const draftKey=`item-draft:${userId}:${itemId||fillBoxId||'new'}`,initialized=useRef(false);const panel=usePanel();
  const pending=queue.filter(row=>row.state!=='saved');const dirty=JSON.stringify(form)!==JSON.stringify(baseline)||pending.length>0;
  useUnsaved(dirty,busy,allow,()=>sessionStorage.removeItem(draftKey));
  useEffect(()=>{let live=true;const restore=(remote?:InventoryRow)=>{if(!live)return;let cached:null|{form:Fields;baseline:Fields;creationId:string;metadata:{id:string;version:number}|null;photoCount:number;sessionCount:number}=null;try{cached=JSON.parse(sessionStorage.getItem(draftKey)||'null')}catch{/* Fresh form. */}if(remote){setItem(remote);setForm(fields(remote));setBaseline(fields(remote));metadata.current={id:remote.id,version:remote.version};setSavedPhotos(remote.item_photos)}if(cached){setForm(cached.form);setBaseline(cached.baseline);creationId.current=cached.creationId;metadata.current=cached.metadata||metadata.current;setSessionCount(cached.sessionCount||0);setStatus(cached.photoCount?'Restored your text draft. Please reselect any unsaved photos.':'Restored your draft.');if(cached.metadata&&!remote)void api.item(cached.metadata.id).then(row=>{if(live)setSavedPhotos(row.item_photos)}).catch(()=>{})}initialized.current=true;setLoading(false)};if(itemId)void api.item(itemId).then(restore).catch(error=>{if(live){setError(message(error));setLoading(false)}});else restore();return()=>{live=false}},[itemId,draftKey]);
  useEffect(()=>{if(!initialized.current||allow.current)return;try{if(!dirty){sessionStorage.removeItem(draftKey);return}sessionStorage.setItem(draftKey,JSON.stringify({form,baseline,creationId:creationId.current,metadata:metadata.current,photoCount:pending.length,sessionCount}))}catch{/* Current draft stays in memory. */}},[form,baseline,dirty,draftKey,pending.length,sessionCount]);
  const box=boxes.find(row=>form.destination===`b:${row.id}`),place=box?.location_id||form.destination.slice(2);
  function chooseDestination(value:string){setForm(current=>({...current,destination:value}));rememberDestination(userId,value);if(fillBoxId)setSessionCount(0)}
  function mark(file:File,state:Queued['state'],error?:string){setQueue(current=>current.map(row=>row.file===file?{...row,state,error}:row))}
  const finish=(saved=false)=>{if(!saved&&dirty&&!confirm('Discard unsaved changes?'))return;allow.current=true;sessionStorage.removeItem(draftKey);go(itemId?`/item/${itemId}`:(fillBoxId||destination)&&box?`/box/${box.id}`:'/items',true)};
  async function save(mode:'next'|'close'|'stay',onlyFile?:File){
    if(saving.current)return;const errors:typeof validation={};if(!form.name.trim())errors.name='Enter an item name.';if(!form.destination||(box===undefined&&form.destination.startsWith('b:'))||(!box&&!locations.some(row=>`l:${row.id}`===form.destination)))errors.destination='Choose an available box or location.';
    for(const key of ['quantity','volume'] as const){if(form[key]!==''&&(!Number.isFinite(Number(form[key]))||Number(form[key])<0))errors[key]='Use a number of zero or more.'}
    setValidation(errors);if(Object.keys(errors).length){setError('Check the highlighted fields.');const first=Object.keys(errors)[0];const input=document.querySelector<HTMLElement>(`[data-field="${first}"]`);const details=input?.closest('details');if(details)details.open=true;input?.focus();input?.scrollIntoView?.({block:'center'});return}
    saving.current=true;setBusy(true);setError('');let failures=0;
    try{
      const firstSave=!metadata.current;
      const record=await saveItem({id:metadata.current?.id||creationId.current,name:form.name.trim(),notes:form.notes||null,tags:form.tags.split(',').map(value=>value.trim()).filter(Boolean),quantity:form.quantity===''?null:Number(form.quantity),quantity_unit:form.unit||null,quantity_approximate:form.approx,volume_l:form.volume===''?null:Number(form.volume),box_id:box?.id||null,location_id:box?null:form.destination.slice(2),archived:item?.archived||false,archived_at:item?.archived_at||null},metadata.current?.version);
      metadata.current={id:record.id,version:record.version};setBaseline({...form});rememberDestination(userId,form.destination);if(firstSave&&fillBoxId)setSessionCount(value=>value+1);setStatus('Item saved.');
      const uploads=pending.filter(row=>!onlyFile||row.file===onlyFile);
      for(let index=0;index<uploads.length;index++){
        const file=uploads[index].file;mark(file,'uploading');setStatus(`Item saved · uploading photo ${index+1} of ${uploads.length}`);
        try{const photo=await uploadPhoto(record.id,file);setSavedPhotos(current=>current.some(row=>row.id===photo.id)?current:[...current,photo]);mark(file,'saved')}
        catch(error){let recovered:PhotoRecord|undefined;try{recovered=(await api.item(record.id)).item_photos.find(row=>row.id===photoRequestId(file))}catch{/* Retry keeps the same request ID. */}if(recovered){setSavedPhotos(current=>current.some(row=>row.id===recovered!.id)?current:[...current,recovered!]);mark(file,'saved')}else{failures++;mark(file,'error',message(error))}}
      }
      const remaining=failures+(onlyFile?pending.length-uploads.length:0);
      await refresh();setStatus(remaining?`Item saved. ${remaining} photos need attention.`:'Item and photos saved.');
      if(remaining){setError('Your item is saved. Retry the remaining photos or explicitly continue without them.');return}
      notify(`${form.name.trim()} added to ${destinationLabel(locations,boxes,form.destination)}`);
      if(mode==='next'){const next={...clean(form.destination),tags:repeat?form.tags:'',unit:repeat?form.unit:''};setForm(next);setBaseline(next);metadata.current=null;creationId.current=newId();setQueue([]);setSavedPhotos([]);setItem(null);sessionStorage.removeItem(draftKey)}else if(mode==='close')finish(true);
    }catch(error){setError(message(error))}finally{saving.current=false;setBusy(false)}
  }
  async function order(next:PhotoRecord[],cover?:string){try{await setPhotoOrder(metadata.current!.id,next.map(row=>row.id),cover||next.find(row=>row.is_cover)?.id||next[0].id);setSavedPhotos(next.map((row,index)=>({...row,sort_order:index,is_cover:row.id===(cover||next.find(row=>row.is_cover)?.id||next[0].id)})));panel.close()}catch(error){setError(message(error))}}
  const activePhoto=savedPhotos.find(row=>row.id===photoMenu);
  if(loading)return <div className="empty" role="status">Loading item…</div>;
  if(itemId&&!item)return <section className="form-page"><FormHeader title="Edit item"/><div className="form-body"><ErrorMessage error={error}/><p>The saved item could not be loaded. Any saved text draft is retained.</p><button disabled={busy} onClick={async()=>{setBusy(true);try{const saved=await api.item(itemId);setItem(saved);setForm(fields(saved));setBaseline(fields(saved));metadata.current={id:saved.id,version:saved.version};setSavedPhotos(saved.item_photos);initialized.current=true;setError('')}catch(error){setError(message(error))}finally{setBusy(false)}}}>Retry loading item</button></div></section>;
  return <section className="form-page"><FormHeader title={fillBoxId?`Fill ${destinationLabel(locations,boxes,form.destination)}`:itemId?'Edit item':'Add item'} context={locationPath(locations,place)}><button disabled={busy} onClick={()=>finish()}>Done</button></FormHeader>
    <div className="form-body"><div className="destination-context"><div><strong>Adding to {destinationLabel(locations,boxes,form.destination)}</strong><small>{locationPath(locations,place)}</small></div><button disabled={busy} onClick={()=>panel.open('destination')}>Change</button></div>
    {fillBoxId&&<p className="filling-progress"><Check size={16}/>{sessionCount} added this session · {box?summary.boxes[box.id]?.items||0:0} active entries in this box</p>}
    <ErrorMessage error={error}/>
    {error&&metadata.current&&<button type="button" className="text-button" disabled={busy} onClick={async()=>{if(dirty&&!confirm('Reload the saved item and discard unsaved edits and pending photos?'))return;try{const saved=await api.item(metadata.current!.id);setItem(saved);setForm(fields(saved));setBaseline(fields(saved));metadata.current={id:saved.id,version:saved.version};setSavedPhotos(saved.item_photos);setQueue([]);setError('');setValidation({});sessionStorage.removeItem(draftKey)}catch(error){setError(message(error))}}}>Reload saved item</button>}
    {validation.destination&&<p className="field-error" role="alert">{validation.destination}</p>}
    <fieldset className="item-fields" disabled={busy}>
      <PhotoPicker files={pending.map(row=>row.file)} states={pending.map(row=>({state:row.state,error:row.error}))} disabled={busy} onFiles={files=>setQueue(current=>[...current,...files.map(file=>({file,state:'ready' as const}))])} onRemove={index=>setQueue(current=>current.filter(row=>row.file!==pending[index].file))} onRetry={index=>void save('stay',pending[index].file)}/>
      {savedPhotos.length>0&&<section className="saved-photos"><p className="hint">{savedPhotos.length} saved photos · drag to reorder or open photo options</p><div className="saved-photo-grid">{savedPhotos.map((photo,index)=><div className="saved-photo" key={photo.id} draggable onDragStart={event=>event.dataTransfer.setData('text/plain',photo.id)} onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();const from=savedPhotos.findIndex(row=>row.id===event.dataTransfer.getData('text/plain'));if(from<0)return;const next=[...savedPhotos];const[moved]=next.splice(from,1);next.splice(index,0,moved);void order(next)}}><Photo path={photo.object_path} alt={`Saved photo ${index+1}`}/>{photo.is_cover&&<span className="cover-badge">Cover</span>}<button className="icon" aria-label={`Photo ${index+1} options`} onClick={()=>{setPhotoMenu(photo.id);panel.open('photo-actions')}}><MoreHorizontal/></button></div>)}</div></section>}
      <label>Name *<input data-field="name" aria-label="Item name" aria-invalid={!!validation.name} aria-describedby={validation.name?'item-name-error':undefined} placeholder="e.g. Ikea shelf accessories" value={form.name} onChange={event=>{setForm({...form,name:event.target.value});setValidation(current=>({...current,name:undefined}))}}/>{validation.name&&<small id="item-name-error" className="field-error">{validation.name}</small>}</label>
      <details className="optional-details"><summary>Quantity, tags, notes & volume</summary>
        <div className="two"><label>Quantity<input data-field="quantity" aria-invalid={!!validation.quantity} type="number" min="0" step="any" placeholder="Unknown" value={form.quantity} onChange={event=>{setForm({...form,quantity:event.target.value});setValidation(current=>({...current,quantity:undefined}))}}/>{validation.quantity&&<small className="field-error">{validation.quantity}</small>}</label><label>Unit<input placeholder="pieces" value={form.unit} onChange={event=>setForm({...form,unit:event.target.value})}/></label></div><label className="check"><input type="checkbox" checked={form.approx} onChange={event=>setForm({...form,approx:event.target.checked})}/> Approximate quantity</label>
        <label>Tags<input placeholder="Separate tags with commas" value={form.tags} onChange={event=>setForm({...form,tags:event.target.value})}/></label><label>Notes<textarea value={form.notes} onChange={event=>setForm({...form,notes:event.target.value})}/></label><label>Total entry volume (litres)<input data-field="volume" aria-invalid={!!validation.volume} type="number" min="0" step="any" value={form.volume} onChange={event=>{setForm({...form,volume:event.target.value});setValidation(current=>({...current,volume:undefined}))}}/>{validation.volume&&<small className="field-error">{validation.volume}</small>}</label>
        {fillBoxId&&<label className="check"><input type="checkbox" checked={repeat} onChange={event=>setRepeat(event.target.checked)}/> Repeat tags and unit for this filling session</label>}
      </details>
    </fieldset>{status&&<p className="success" role="status">{status}</p>}
    {metadata.current&&pending.some(row=>row.state==='error')&&<button disabled={busy} className="text-button" onClick={()=>{if(confirm('Keep the saved item and discard only the remaining pending photos?'))finish(true)}}>Keep item without pending photos</button>}
    </div><footer className="form-footer"><button disabled={busy} className="primary" onClick={()=>void save(pending.some(row=>row.state==='error')?'stay':fillBoxId?'next':'close')}>{busy?'Saving...':pending.some(row=>row.state==='error')?'Retry remaining photos':fillBoxId?'Save & next':'Save item'}</button><button disabled={busy} onClick={()=>void save(fillBoxId?'close':'next')}>{fillBoxId?'Save & close':'Save & next'}</button></footer>
    {panel.panel==='destination'&&<DestinationPicker value={form.destination} onChoose={chooseDestination} onClose={panel.close}/>}
    {panel.panel==='photo-actions'&&activePhoto&&<Sheet title="Photo options" onClose={panel.close}><div className="menu-options"><button onClick={()=>void order(savedPhotos,activePhoto.id)}>Make cover</button>{[-1,1].map(direction=>{const index=savedPhotos.indexOf(activePhoto),target=index+direction;return <button key={direction} disabled={target<0||target>=savedPhotos.length} onClick={()=>{const next=[...savedPhotos];[next[index],next[target]]=[next[target],next[index]];void order(next)}}>{direction<0?'Move earlier':'Move later'}</button>})}<button className="danger-button" onClick={async()=>{if(!confirm('Remove this saved photo?'))return;try{const warning=await removePhotoRecord(activePhoto.id);setSavedPhotos(current=>current.filter(row=>row.id!==activePhoto.id));if(warning)setError(warning);panel.close()}catch(error){setError(message(error))}}}>Remove photo</button></div></Sheet>}
  </section>;
}
