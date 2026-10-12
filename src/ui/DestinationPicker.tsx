import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Box as BoxIcon, Folder, Plus, Search } from 'lucide-react';
import { api } from '../lib/api';
import { newId } from '../lib/id';
import { boxLabel } from '../lib/box-label';
import { Sheet, ErrorMessage } from './common';
import { locationPath, message, readPreference, useWorkspace, writePreference } from './model';

export function DestinationPicker({value,onChoose,onClose,locationsOnly=false,excluded=new Set<string>()}:{value:string;onChoose:(value:string)=>void;onClose:()=>void;locationsOnly?:boolean;excluded?:Set<string>}){
  const{locations,boxes,userId,refresh}=useWorkspace();
  const[params,setParams]=useSearchParams();const creating=params.get('create');const setCreating=(type:string|null)=>{const next=new URLSearchParams(params);if(type)next.set('create',type);else next.delete('create');setParams(next)};
  const[search,setSearch]=useState(''),[name,setName]=useState(''),[parent,setParent]=useState(value.startsWith('l:')?value.slice(2):boxes.find(row=>`b:${row.id}`===value)?.location_id||''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const[requestId]=useState(newId);
  const recent=readPreference<string[]>(`recent-destinations:${userId}`,[]);
  const rank=(value:string)=>recent.includes(value)?recent.indexOf(value):1000;
  const results=[...(!locationsOnly?boxes.map(box=>({value:`b:${box.id}`,name:boxLabel(box),path:locationPath(locations,box.location_id),box:true})):[]),...locations.filter(row=>!excluded.has(row.id)).map(row=>({value:`l:${row.id}`,name:row.name,path:locationPath(locations,row.parent_id)||'Top level',box:false}))].filter(row=>`${row.name} ${row.path}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())).sort((a,b)=>(!search?rank(a.value)-rank(b.value):0)||a.name.localeCompare(b.name,undefined,{numeric:true}));
  const choose=(next:string)=>{writePreference(`recent-destinations:${userId}`,[next,...recent.filter(row=>row!==next)].slice(0,8));onChoose(next);onClose()};
  return <Sheet title={creating?`Create ${creating}`:'Choose a destination'} onClose={()=>{if(!busy&&(!name||confirm('Discard the new destination name?')))onClose()}}>
    {creating?<form onSubmit={async event=>{event.preventDefault();setBusy(true);setError('');try{if(creating==='location'){const rows=await api.locationBatch([name],parent||null,requestId);await refresh();choose(`l:${rows[0].id}`)}else{const box=await api.saveBox({id:requestId,location_id:parent,description:name,capacity_l:null});await refresh();choose(`b:${box.id}`)}}catch(error){setError(message(error))}finally{setBusy(false)}}}><button type="button" className="text-button" onClick={()=>setCreating(null)}>← Back to destinations</button><ErrorMessage error={error}/><label>Name<input autoFocus required value={name} onChange={event=>setName(event.target.value)}/></label><label>Inside<select required={creating==='box'} value={parent} onChange={event=>setParent(event.target.value)}><option value="">{creating==='box'?'Choose location':'Top level'}</option>{locations.filter(row=>!excluded.has(row.id)).map(row=><option key={row.id} value={row.id}>{locationPath(locations,row.id)}</option>)}</select></label><button className="primary" disabled={busy}>{busy?'Creating…':'Create and select'}</button></form>:<>
      <div className="search"><Search size={18}/><input autoFocus aria-label="Find a destination" placeholder="Find a box, shelf or room…" value={search} onChange={event=>setSearch(event.target.value)}/></div>
      {locationsOnly&&<button className="destination-row" onClick={()=>choose('')}><Folder/><span><strong>Top level</strong><small>No parent location</small></span></button>}
      <div className="destination-results">{results.map(row=><button className="destination-row" key={row.value} aria-pressed={value===row.value} onClick={()=>choose(row.value)}>{row.box?<BoxIcon/>:<Folder/>}<span><strong>{row.name}</strong><small>{row.path}{!row.box&&!locationsOnly?' · Unboxed':''}{recent.includes(row.value)?' · Recent':''}</small></span></button>)}</div>
      {!results.length&&<p className="hint">No matching destinations. Create one below.</p>}
      <div className="picker-create">{!locationsOnly&&<button onClick={()=>setCreating('box')} disabled={!locations.length}><Plus/> Create box</button>}<button onClick={()=>setCreating('location')}><Plus/> Create location</button></div>
    </>}
  </Sheet>;
}
