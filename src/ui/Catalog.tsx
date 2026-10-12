import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, SlidersHorizontal, LayoutGrid, List, Trash2, X } from 'lucide-react';
import { api, type ItemQuery } from '../lib/api';
import { listItems } from '../lib/data';
import type { InventoryRow } from '../lib/types';
import { boxLabel } from '../lib/box-label';
import { InventoryGallery } from './InventoryGallery';
import { DestinationPicker } from './DestinationPicker';
import { Sheet, ErrorMessage } from './common';
import { locationPath, message, readPreference, useWorkspace, writePreference } from './model';

type Filters={location:string;box:string;tag:string;archived:boolean;out:boolean;scope:string;sort:'newest'|'name'};
const empty:Filters={location:'',box:'',tag:'',archived:false,out:false,scope:'all',sort:'newest'};

export function Catalog({base={},title='Inventory',compact=false}:{base?:Partial<ItemQuery>;title?:string;compact?:boolean}){
  const{locations,boxes,userId,revision,refresh,notify}=useWorkspace();const[params,setParams]=useSearchParams();
  const[search,setSearch]=useState(params.get('q')||''),[rows,setRows]=useState<InventoryRow[]>([]),[count,setCount]=useState(0),[loading,setLoading]=useState(true),[error,setError]=useState(''),[loadError,setLoadError]=useState('');
  const[selection,setSelection]=useState<Record<string,number>>({}),[selecting,setSelecting]=useState(false),[busy,setBusy]=useState(false);
  const[view,setView]=useState(()=>readPreference<'grid'|'list'>(`catalog-view:${userId}`,'grid'));
  const filters:Filters={location:params.get('location')||'',box:params.get('box')||'',tag:params.get('tag')||'',archived:params.get('archived')==='true',out:params.get('out')==='true',scope:params.get('scope')||'all',sort:params.get('sort')==='name'?'name':'newest'};
  const[editingFilters,setEditingFilters]=useState<Filters>(filters);
  const panel=params.get('panel'),pages=Math.max(1,Math.min(20,Number(params.get('n'))||1));
  const searchValue=params.get('q')||'';const filtersKey=JSON.stringify({...filters,search:searchValue,...base});const queryKey=JSON.stringify({...filters,search:searchValue,pages,...base});
  const selected=Object.keys(selection);
  const setPanel=(value:string|null)=>{const next=new URLSearchParams(params);if(value)next.set('panel',value);else next.delete('panel');setParams(next,{replace:!value})};
  const apply=(value:Filters,q=search)=>{const next=new URLSearchParams(params);next.delete('panel');next.delete('n');for(const[key,item]of Object.entries(value)){if(item&&item!==empty[key as keyof Filters])next.set(key,String(item));else next.delete(key)}if(q)next.set('q',q);else next.delete('q');setParams(next,{replace:true});window.scrollTo(0,0)};
  useEffect(()=>{const timer=setTimeout(()=>{if(search!==(params.get('q')||'')){const next=new URLSearchParams(params);next.delete('n');if(search)next.set('q',search);else next.delete('q');setParams(next,{replace:true})}},250);return()=>clearTimeout(timer)},[search,params,setParams]);
  useEffect(()=>{setSearch(searchValue)},[searchValue]);
  useEffect(()=>{setSelection({});setSelecting(false)},[filtersKey]);
  useEffect(()=>{let live=true;const input=JSON.parse(queryKey);const {pages,...query}=input;setLoading(true);setLoadError('');void Promise.all(Array.from({length:pages},(_,page)=>listItems({search:'',location:'',box:'',tag:'',archived:false,out:false,...query,subtree:query.subtree??query.scope==='all',page,pageSize:30}))).then(results=>{if(!live)return;setRows([...new Map(results.flatMap(result=>result.items).map(row=>[row.id,row])).values()]);setCount(results[0].count);requestAnimationFrame(()=>window.dispatchEvent(new Event('inventory-content-ready')))}).catch(error=>{if(live)setLoadError(message(error))}).finally(()=>{if(live)setLoading(false)});return()=>{live=false}},[queryKey,revision]);
  const active=Object.entries(filters).filter(([key,value])=>value!==empty[key as keyof Filters]&&value&&key!=='sort'&&key!=='scope');
  const chips=active.map(([key,value])=>({key,label:key==='location'?locationPath(locations,String(value)):key==='box'?boxLabel(boxes.find(box=>box.id===value)||{box_number:0,description:'Box'}):key==='archived'?'Archived':key==='out'?'Out of stock':String(value)}));
  const shownIds=useMemo(()=>rows.map(row=>row.id),[rows]);
  async function deleteSelection(){const names=rows.filter(row=>selected.includes(row.id)).slice(0,3).map(row=>row.name.slice(0,60));if(!confirm(`Permanently delete ${selected.length} selected ${selected.length===1?'item':'items'} and all their photos? This cannot be undone.\n\n${names.join(', ')}${selected.length>names.length?' and more':''}`))return;setBusy(true);try{const result=await api.deleteItems(selected.map(id=>({id,version:selection[id]})));setSelection({});setSelecting(false);await refresh();notify(result.photo_cleanup_failures.length?'Items deleted; some photo files need cleanup with maintenance.bat verify --cleanup.':`${result.deleted} items deleted`)}catch(error){setError(message(error));await refresh()}finally{setBusy(false)}}
  return <section className={compact?'catalog compact':'catalog'}>
    <div className="page-heading"><div><h1>{title}</h1><p>{count} {count===1?'entry':'entries'}{base.loose?' stored directly here':''}</p></div><button onClick={()=>{setSelecting(!selecting);setSelection({});setError('')}}>{selecting?'Cancel selection':'Select'}</button></div>
    <div className="catalog-search"><div className="search"><Search/><input aria-label="Search inventory" placeholder="Search items, boxes, locations…" value={search} onChange={event=>setSearch(event.target.value)}/>{search&&<button className="icon" aria-label="Clear search" onClick={()=>{setSearch('');apply(filters,'')}}><X size={16}/></button>}</div><button aria-label="Open filters" onClick={()=>{setEditingFilters(filters);setPanel('filters')}}><SlidersHorizontal size={18}/> Filters{active.length>0?` · ${active.length}`:''}</button><button className="icon" aria-label={view==='grid'?'Show list view':'Show grid view'} onClick={()=>{const next=view==='grid'?'list':'grid';setView(next);writePreference(`catalog-view:${userId}`,next)}}>{view==='grid'?<List/>:<LayoutGrid/>}</button></div>
    {chips.length>0&&<div className="filter-chips">{chips.map(chip=><button key={chip.key} onClick={()=>apply({...filters,[chip.key]:empty[chip.key as keyof Filters]})}>{chip.label}<X size={14}/></button>)}<button className="text-button" onClick={()=>{setSearch('');apply(empty,'')}}>Clear filters</button></div>}
    <ErrorMessage error={error||loadError}/>
    {selecting&&<button className="text-button" disabled={busy} onClick={()=>setSelection(Object.fromEntries(rows.map(row=>[row.id,row.version])))}>Select all {shownIds.length} shown</button>}
    <InventoryGallery rows={rows} selected={selected} disabled={busy} showSelection={selecting} showArchive={false} list={view==='list'} onSelect={(id,checked)=>setSelection(current=>{const next={...current};if(checked)next[id]=rows.find(row=>row.id===id)!.version;else delete next[id];return next})} onArchive={()=>{}} photo={path=><CatalogPhoto path={path}/>}/>
    {loading&&<p className="hint" role="status">Loading inventory…</p>}
    {!rows.length&&!loading&&!error&&!loadError&&<div className="empty"><h2>{search||active.length?'No matching items':'Ready for your first item'}</h2><p>{search||active.length?'Try a different search or clear the filters.':'Add an item to this place to get started.'}</p>{(search||active.length>0)&&<button onClick={()=>{setSearch('');apply(empty,'')}}>Clear search and filters</button>}</div>}
    {rows.length<count&&<div className="load-more"><p>{rows.length} of {count} entries shown</p><button disabled={loading} onClick={()=>{const next=new URLSearchParams(params);next.set('n',String(pages+1));setParams(next,{replace:true})}}>Load more</button></div>}
    {selecting&&<div className="selection-toolbar bulk"><strong>{selected.length} selected</strong><button disabled={busy||!selected.length} onClick={()=>setPanel('bulk-move')}>Move</button><button className="danger-button" disabled={busy||!selected.length} onClick={()=>void deleteSelection()}><Trash2 size={16}/>{busy?'Working…':'Delete selected'}</button><button disabled={busy} onClick={()=>{setSelecting(false);setSelection({});setError('')}}>Cancel</button></div>}
    {panel==='bulk-move'&&<DestinationPicker value="" onClose={()=>setPanel(null)} onChoose={value=>{setBusy(true);void api.move(selected,value.slice(2),value.startsWith('b:')?'box':'location').then(async()=>{setSelection({});setSelecting(false);await refresh();notify('Selected items moved')}).catch(error=>setError(message(error))).finally(()=>setBusy(false))}}/>}
    {panel==='filters'&&<Sheet title="Filter inventory" onClose={()=>setPanel(null)}><form onSubmit={event=>{event.preventDefault();apply(editingFilters)}}>
      {!base.box&&!base.location&&<label>Location<select value={editingFilters.location} onChange={event=>setEditingFilters({...editingFilters,location:event.target.value})}><option value="">All locations</option>{locations.map(row=><option key={row.id} value={row.id}>{locationPath(locations,row.id)}</option>)}</select></label>}
      {(editingFilters.location||base.location)&&!base.loose&&<label>Location scope<select value={editingFilters.scope} onChange={event=>setEditingFilters({...editingFilters,scope:event.target.value})}><option value="all">Including sub-locations</option><option value="direct">This location only</option></select></label>}
      {!base.box&&!base.loose&&<label>Box<select value={editingFilters.box} onChange={event=>setEditingFilters({...editingFilters,box:event.target.value})}><option value="">All boxes</option>{boxes.map(row=><option key={row.id} value={row.id}>{boxLabel(row)} · {locationPath(locations,row.location_id)}</option>)}</select></label>}
      <label>Tag<input value={editingFilters.tag} onChange={event=>setEditingFilters({...editingFilters,tag:event.target.value})}/></label><label>Sort<select value={editingFilters.sort} onChange={event=>setEditingFilters({...editingFilters,sort:event.target.value as Filters['sort']})}><option value="newest">Recently added</option><option value="name">Name A–Z</option></select></label>
      <label className="check"><input type="checkbox" checked={editingFilters.archived} onChange={event=>setEditingFilters({...editingFilters,archived:event.target.checked})}/> Show archived entries</label><label className="check"><input type="checkbox" checked={editingFilters.out} onChange={event=>setEditingFilters({...editingFilters,out:event.target.checked})}/> Out of stock only</label><div className="form-actions"><button type="button" onClick={()=>setEditingFilters(empty)}>Clear</button><button className="primary">Apply filters</button></div>
    </form></Sheet>}
  </section>;
}
import { Photo as CatalogPhoto } from './Photo';
