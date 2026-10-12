import { usePanel, useUnsaved } from './hooks';
import { useRef, useState } from 'react';
import { newId } from '../lib/id';
import { api } from '../lib/api';
import { boxLabel } from '../lib/box-label';
import { locationAndDescendants } from '../lib/location-tree';
import { DestinationPicker } from './DestinationPicker';
import { ErrorMessage, FormHeader } from './common';
import { locationPath, message, useWorkspace } from './model';

export function PlaceEditor({kind,id,parentId}:{kind:'location'|'box';id?:string;parentId?:string}){
  const{locations,boxes,refresh,go,notify}=useWorkspace();const current=kind==='box'?boxes.find(row=>row.id===id):locations.find(row=>row.id===id);
  const original=useRef(current),requestId=useRef(newId()),allow=useRef(false);
  const initial={name:kind==='box'&&current&&'box_number'in current?boxLabel(current):(current&&'name'in current?current.name:''),parent:current?('location_id'in current?current.location_id:current.parent_id||''):parentId||'',capacity:current&&'capacity_l'in current&&current.capacity_l!==null?String(current.capacity_l):'',icon:current&&'icon'in current?current.icon||'folder':'folder',color:current&&'color'in current?current.color||'sage':'sage'};
  const[form,setForm]=useState(initial),[baseline,setBaseline]=useState(initial),[many,setMany]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');const panel=usePanel();
  const dirty=JSON.stringify(form)!==JSON.stringify(baseline);useUnsaved(dirty,busy,allow);
  const excluded=kind==='location'&&id?locationAndDescendants(locations,id):new Set<string>();
  const duplicate=kind==='location'?locations.some(row=>row.id!==id&&row.parent_id===(form.parent||null)&&row.name.toLocaleLowerCase()===form.name.trim().toLocaleLowerCase()):boxes.some(row=>row.id!==id&&row.location_id===form.parent&&boxLabel(row).toLocaleLowerCase()===form.name.trim().toLocaleLowerCase());
  async function save(next:'open'|'another'|'fill'){
    if(busy)return;if(!form.name.trim()){setError('Enter a name.');return}if(kind==='box'&&!form.parent){setError('Choose a location for this box.');return}if(duplicate&&!confirm('A place with this name already exists here. Create another anyway?'))return;
    setBusy(true);setError('');try{
      let target:string;
      if(kind==='box'){const box=await api.saveBox({id:id||requestId.current,location_id:form.parent,description:form.name.trim(),capacity_l:form.capacity?Number(form.capacity):null},original.current&&'box_number'in original.current?original.current:null);target=`/box/${box.id}`}
      else if(original.current&&'name'in original.current){const row=await api.saveLocation({name:form.name.trim(),parent_id:form.parent||null,icon:form.icon,color:form.color},original.current);target=`/storage/${row.id}`}
      else{const names=(many?form.name.split('\n'):[form.name]).map(name=>name.trim()).filter(Boolean);const rows=await api.locationBatch(names,form.parent||null,requestId.current,{icon:form.icon,color:form.color});target=`/storage/${rows[0].id}`}
      await refresh();notify(`${many?'Locations':kind==='box'?'Box':'Location'} saved`);
      if(next==='another'&&!id){const clean={...form,name:'',capacity:''};setForm(clean);setBaseline(clean);requestId.current=newId()}
      else{allow.current=true;go(next==='fill'&&kind==='box'?`${target}/fill`:target,true)}
    }catch(error){setError(message(error))}finally{setBusy(false)}
  }
  if(id&&!current&&!original.current)return <div className="empty">This place is unavailable. <a href="#/storage">Back to locations</a></div>;
  return <section className="form-page"><FormHeader title={`${id?'Edit':'New'} ${kind}`} context={locationPath(locations,form.parent)||'Top level'}/><div className="form-body"><ErrorMessage error={error}/><fieldset disabled={busy} className="item-fields">
    <label>{kind==='box'?'Box name':'Location name'} *{many?<textarea autoFocus required placeholder="One location name per line" value={form.name} onChange={event=>setForm({...form,name:event.target.value})}/>:<input autoFocus required maxLength={500} placeholder={kind==='box'?'Box 10 or Christmas decorations':'Basement, shelf or drawer'} value={form.name} onChange={event=>setForm({...form,name:event.target.value})}/>}</label>
    <label>Inside{kind==='box'?' *':''}<button type="button" className="destination-context" onClick={()=>panel.open('parent')}>{locationPath(locations,form.parent)||'Top level'}<span>Change</span></button></label>
    {duplicate&&<p className="hint">This name already exists in the selected location. You can choose another name or confirm the duplicate.</p>}
    {kind==='box'?<details><summary>Optional capacity</summary><label>Capacity (litres)<input type="number" min="0" step="any" value={form.capacity} onChange={event=>setForm({...form,capacity:event.target.value})}/></label></details>:<>
      {!id&&<label className="check"><input type="checkbox" checked={many} onChange={event=>setMany(event.target.checked)}/> Add several sibling locations</label>}
      <details><summary>Appearance (optional)</summary><label>Icon<select value={form.icon} onChange={event=>setForm({...form,icon:event.target.value})}><option value="folder">Folder</option><option value="home">Room</option><option value="shelf">Shelf</option><option value="drawer">Drawer</option></select></label><label>Color<select value={form.color} onChange={event=>setForm({...form,color:event.target.value})}><option value="sage">Sage</option><option value="blue">Blue</option><option value="amber">Amber</option><option value="rose">Rose</option></select></label></details>
    </>}
  </fieldset></div><footer className="form-footer"><button disabled={busy} className="primary" onClick={()=>void save('open')}>{busy?'Saving…':id?'Save changes':`Create ${many?'locations':kind}`}</button>{!id&&<button disabled={busy} onClick={()=>void save(kind==='box'?'fill':'another')}>{kind==='box'?'Create & start filling':'Create & add another'}</button>}</footer>
    {panel.panel==='parent'&&<DestinationPicker locationsOnly excluded={excluded} value={form.parent?`l:${form.parent}`:''} onChoose={value=>setForm({...form,parent:value.slice(2)})} onClose={panel.close}/>}
  </section>;
}
