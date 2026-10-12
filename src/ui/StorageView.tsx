import { Fragment, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Archive, Box as BoxIcon, ChevronRight, Folder, Home, Layers, MoreHorizontal, Pin, Plus, Search } from 'lucide-react';
import type { Location, Box } from '../lib/types';
import { api } from '../lib/api';
import { boxLabel } from '../lib/box-label';
import { Catalog } from './Catalog';
import { ErrorMessage, Sheet } from './common';
import {usePanel} from './hooks';
import { locationPath, message, readPreference, useWorkspace, writePreference } from './model';

export function PlaceIcon({location}:{location:Location}){const icons:Record<string,typeof Folder>={home:Home,shelf:Layers,drawer:Archive,folder:Folder};const key=location.icon||'folder';const Icon=Object.hasOwn(icons,key)?icons[key]:Folder;return <span className="storage-row-icon" data-color={location.color||'sage'}><Icon/></span>}

export function StorageView({locationId,boxId}:{locationId?:string;boxId?:string}){
  const{locations,boxes,summary,userId,go,refresh,notify}=useWorkspace();const[params,setParams]=useSearchParams();
  const[search,setSearch]=useState(''),[expanded,setExpanded]=useState<Set<string>>(()=>new Set(readPreference<string[]>(`tree:${userId}`,locations.filter(row=>!row.parent_id).map(row=>row.id)))),[pins,setPins]=useState<string[]>(()=>readPreference(`pins:${userId}`,[]));
  const[mode,setMode]=useState<'overview'|'browse'>(()=>readPreference(`storage-mode:${userId}`,'overview'));
  const[error,setError]=useState('');const panel=usePanel();const menu=panel.panel==='place-options';const setMenu=(value:boolean)=>value?panel.open('place-options'):panel.close();
  const box=boxes.find(row=>row.id===boxId),current=locations.find(row=>row.id===(locationId||box?.location_id));
  const key=box?`b:${box.id}`:current?`l:${current.id}`:'';
  const pin=(value:string)=>{const next=pins.includes(value)?pins.filter(row=>row!==value):[...pins,value];setPins(next);writePreference(`pins:${userId}`,next)};
  const toggle=(id:string)=>{const next=new Set(expanded);if(next.has(id))next.delete(id);else next.add(id);setExpanded(next);writePreference(`tree:${userId}`,[...next])};
  const descendants=locations.filter(row=>row.parent_id===(current?.id||null)).sort((a,b)=>a.name.localeCompare(b.name));
  const currentBoxes=boxes.filter(row=>row.location_id===current?.id).sort((a,b)=>boxLabel(a).localeCompare(boxLabel(b),undefined,{numeric:true}));
  function boxRow(row:Box,depth=0){const count=summary.boxes[row.id];return <div className="outline-row" key={row.id} style={{'--tree-depth':Math.min(depth,4)} as React.CSSProperties}><span className="storage-row-icon box"><BoxIcon/></span><a href={`#/box/${row.id}`} className="storage-row-label"><strong>{boxLabel(row)}</strong><small>{count?.items||0} active entries{count?.archived_items?` · ${count.archived_items} archived`:''}</small></a><button className="icon" aria-label={`Pin ${boxLabel(row)}`} aria-pressed={pins.includes(`b:${row.id}`)} onClick={()=>pin(`b:${row.id}`)}><Pin size={17}/></button></div>}
  function placeRow(row:Location,depth=0,tree=false){const count=summary.locations[row.id];const hasChildren=locations.some(child=>child.parent_id===row.id)||boxes.some(box=>box.location_id===row.id);return <Fragment key={row.id}><div className="outline-row" style={{'--tree-depth':Math.min(depth,4)} as React.CSSProperties}>{tree&&<button className="icon branch-toggle" disabled={!hasChildren} aria-label={`${expanded.has(row.id)?'Collapse':'Expand'} ${row.name}`} aria-expanded={expanded.has(row.id)} onClick={()=>toggle(row.id)}><ChevronRight className={expanded.has(row.id)?'rotated':''}/></button>}<PlaceIcon location={row}/><a href={`#/storage/${row.id}`} className="storage-row-label"><strong>{row.name}</strong><small>{count?.boxes||0} boxes · {count?.items||0} active entries inside{count?.archived_items?` \u00b7 ${count.archived_items} archived`:''}{search?` · ${locationPath(locations,row.parent_id)||'Top level'}`:''}</small></a><button className="icon" aria-label={`Pin ${row.name}`} aria-pressed={pins.includes(`l:${row.id}`)} onClick={()=>pin(`l:${row.id}`)}><Pin size={17}/></button></div>{tree&&expanded.has(row.id)&&<>{locations.filter(child=>child.parent_id===row.id).sort((a,b)=>a.name.localeCompare(b.name)).map(child=>placeRow(child,depth+1,true))}{boxes.filter(box=>box.location_id===row.id).map(box=>boxRow(box,depth+1))}</>}</Fragment>}
  const ancestors:Location[]=[];let ancestor=current;while(ancestor&&!ancestors.some(row=>row.id===ancestor!.id)){ancestors.unshift(ancestor);ancestor=locations.find(row=>row.id===ancestor?.parent_id)}
  async function remove(){if(!key||!confirm(`Delete ${box?boxLabel(box):current!.name}? It must be empty.`))return;setMenu(false);try{if(box)await api.deleteBox(box);else await api.deleteLocation(current!);await refresh();go(current?.parent_id?`/storage/${current.parent_id}`:'/storage',true);notify('Empty place deleted')}catch(error){setError(`${message(error)} Open its contents below to move or delete them first.`)}}
  if((locationId&&!current)||(boxId&&!box))return <div className="empty"><h1>Place unavailable</h1><a href="#/storage">All locations</a></div>;
  return <section className="storage-browser">
    <nav className="breadcrumbs" aria-label="Location path"><a href="#/storage"><Home size={16}/> All locations</a>{ancestors.map(row=><span key={row.id}><ChevronRight size={14}/><a href={`#/storage/${row.id}`}>{row.name}</a></span>)}{box&&<span><ChevronRight size={14}/>{boxLabel(box)}</span>}</nav>
    <div className="storage-heading"><div><h1>{box?boxLabel(box):current?.name||'Locations'}</h1><p>{box?locationPath(locations,box.location_id):current?`${summary.locations[current.id]?.boxes||0} boxes · ${summary.locations[current.id]?.items||0} active entries inside`:`${summary.totals.locations} locations · ${summary.totals.boxes} boxes · ${summary.totals.items} active entries`}</p></div>{current&&<div className="actions"><button className="icon" aria-label="Pin this place" aria-pressed={pins.includes(key)} onClick={()=>pin(key)}><Pin/></button><button className="icon" aria-label="Place options" onClick={()=>setMenu(true)}><MoreHorizontal/></button></div>}</div>
    <ErrorMessage error={error}/>
    {box?<><div className="box-fill-banner"><div><strong>Pack this box</strong><p>Add photos and names continuously.</p></div><a className="button primary" href={`#/box/${box.id}/fill`}><Plus size={18}/> Fill this box</a></div><details className="box-estimates"><summary>Space estimates and capacity</summary><p>{summary.boxes[box.id]?.known_volume_l||0} L known volume · {summary.boxes[box.id]?.missing_estimate_count||0} entries without estimates{box.capacity_l!==null?` · ${box.capacity_l} L capacity`:''}</p></details><Catalog base={{box:box.id}} title="Box contents" compact/></>:current?<>
      <div className="storage-create"><a className="button" href={`#/new/box?parent=${current.id}`}><Plus size={16}/> Add box</a><a className="button" href={`#/new/location?parent=${current.id}`}><Plus size={16}/> Sub-location</a><a className="button" href={`#/items?location=${current.id}&scope=all`}>View all entries inside</a></div>
      {descendants.length>0&&<section className="storage-section"><h2>Sub-locations</h2><div className="storage-rows">{descendants.map(row=>placeRow(row))}</div></section>}
      {currentBoxes.length>0&&<section className="storage-section"><h2>Boxes here</h2><div className="storage-rows">{currentBoxes.map(row=>boxRow(row))}</div></section>}
      <Catalog base={{location:current.id,loose:true,subtree:false}} title="Loose items here" compact/>
    </>:<>
      <div className="search"><Search/><input aria-label="Find a location or box" placeholder="Find a room, shelf or box…" value={search} onChange={event=>setSearch(event.target.value)}/></div>
      <div className="segmented"><button aria-pressed={mode==='overview'} onClick={()=>{setMode('overview');writePreference(`storage-mode:${userId}`,'overview')}}>Overview</button><button aria-pressed={mode==='browse'} onClick={()=>{setMode('browse');writePreference(`storage-mode:${userId}`,'browse')}}>Browse</button></div>
      {!search&&pins.length>0&&<section className="storage-section"><h2>Pinned places</h2><div className="storage-rows">{pins.map(value=>{const place=locations.find(row=>value===`l:${row.id}`);const box=boxes.find(row=>value===`b:${row.id}`);return place?placeRow(place):box?boxRow(box):null})}</div></section>}
      {search?<div className="storage-rows">{locations.filter(row=>locationPath(locations,row.id).toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(row=>placeRow(row))}{boxes.filter(row=>`${boxLabel(row)} ${locationPath(locations,row.location_id)}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(row=>boxRow(row))}</div>:<>
        {mode==='overview'&&<div className="actions tree-controls"><button className="text-button" onClick={()=>{const next=new Set(locations.map(row=>row.id));setExpanded(next);writePreference(`tree:${userId}`,[...next])}}>Expand all</button><button className="text-button" onClick={()=>{setExpanded(new Set());writePreference(`tree:${userId}`,[])}}>Collapse all</button></div>}
        <div className="storage-rows">{descendants.map(row=>placeRow(row,0,mode==='overview'))}</div>
      </>}
      {!locations.length&&<div className="storage-blank"><Folder size={32}/><h2>Start with a location</h2><p>A room, cupboard or shelf is a good starting point.</p></div>}
      <a className="button primary storage-root-add" href="#/new/location"><Plus/> Add location</a>
    </>}
    {menu&&<Sheet title="Place options" onClose={()=>setMenu(false)}><div className="menu-options"><a className="button" href={box?`#/box/${box.id}/edit`:`#/storage/${current!.id}/edit`}>Edit name, parent and details</a><button className="danger-button" onClick={()=>void remove()}>Delete empty {box?'box':'location'}</button></div></Sheet>}
    {params.get('panel')==='add-here'&&current&&<Sheet title="Add here" onClose={()=>{const next=new URLSearchParams(params);next.delete('panel');setParams(next,{replace:true})}}><div className="menu-options"><a className="button" href={`#/new/item?destination=l:${current.id}`}>Item stored here</a><a className="button" href={`#/new/box?parent=${current.id}`}>Box</a><a className="button" href={`#/new/location?parent=${current.id}`}>Sub-location</a></div></Sheet>}
  </section>;
}
