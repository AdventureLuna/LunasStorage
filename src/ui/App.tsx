import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { Archive, FolderTree, Menu, PackagePlus, Plus, Settings2, Download, LogOut } from 'lucide-react';
import { api, type Session } from '../lib/api';
import { exportRows, exportZip } from '../lib/data';
import { boxLabel } from '../lib/box-label';
import type { Box, InventoryRow, Location as Place, StorageSummary } from '../lib/types';
import { WorkspaceContext, emptySummary, message, locationPath, type Workspace } from './model';
import { Catalog } from './Catalog';
import { StorageView } from './StorageView';
import { ItemEditor } from './ItemEditor';
import { PlaceEditor } from './PlaceEditor';
import { ItemPage } from './ItemPage';
import { Photo } from './Photo';
import { clearPhotoCache } from '../lib/photo-cache';
import { Sheet, ErrorMessage } from './common';
import {usePanel} from './hooks';

export default function App(){
  const[session,setSession]=useState<Session|null>(null),[ready,setReady]=useState(false),[setup,setSetup]=useState(false),[error,setError]=useState('');
  useEffect(()=>{let live=true;void api.authStatus().then(result=>{if(live){setSession(result.session);setSetup(result.setup_required)}}).catch(error=>{if(live)setError(message(error))}).finally(()=>{if(live)setReady(true)});const logout=()=>{clearPhotoCache();setSession(null)};window.addEventListener('inventory-auth-expired',logout);return()=>{live=false;window.removeEventListener('inventory-auth-expired',logout)}},[]);
  if(!ready)return <main className="center" role="status">Loading local inventory…</main>;
  if(!session)return <main className="center"><form className="signin" onSubmit={async event=>{event.preventDefault();const form=new FormData(event.currentTarget);if(setup&&form.get('password')!==form.get('confirm')){setError('Passwords must match.');return}try{setSession(await api.login(String(form.get('username')),String(form.get('password')),setup));setSetup(false);setError('')}catch(error){setError(message(error))}}}><div className="brand"><PackagePlus/> LunasStorage</div><h1>{setup?'Create local account':'Welcome back'}</h1>{setup&&<p className="hint">Create the single account on your PC through localhost.</p>}<label>Username<input name="username" required autoComplete="username"/></label><label>Password<input name="password" type="password" required minLength={setup?8:1} autoComplete={setup?'new-password':'current-password'}/></label>{setup&&<label>Repeat password<input name="confirm" type="password" required autoComplete="new-password"/></label>}<button className="primary">{setup?'Create account':'Sign in'}</button><ErrorMessage error={error}/><p className="hint">Forgot your password? Use maintenance.bat reset-password on the PC.</p></form></main>;
  return <Application key={session.user.id} session={session}/>;
}

function Application({session}:{session:Session}){
  const route=useLocation(),navigate=useNavigate(),navigationType=useNavigationType();
  const[locations,setLocations]=useState<Place[]>([]),[boxes,setBoxes]=useState<Box[]>([]),[summary,setSummary]=useState<StorageSummary>(emptySummary),[revision,setRevision]=useState(0),[loading,setLoading]=useState(true),[error,setError]=useState('');const panel=usePanel();
  const[toast,setToast]=useState<{message:string;undo?:()=>Promise<void>}|null>(null);
  const sequence=useRef(0),positions=useRef<Record<string,number>>({}),restoreKey=useRef<string|null>(null),currentKey=useRef(route.pathname+route.search),loaded=useRef(false);
  const refresh=useCallback(async()=>{const request=++sequence.current;try{const[places,containers,counts]=await Promise.all([api.locations(),api.boxes(),api.summary()]);if(request!==sequence.current)return;setLocations(places);setBoxes(containers);setSummary(counts);setRevision(value=>value+1);setError('');loaded.current=true}catch(error){setError(message(error))}finally{if(request===sequence.current)setLoading(false)}},[]);
  useEffect(()=>{void refresh()},[refresh]);
  useEffect(()=>{try{positions.current=JSON.parse(sessionStorage.getItem('inventory-scroll')||'{}')}catch{/* Fresh navigation history. */}const save=()=>{positions.current[currentKey.current]=window.scrollY;try{sessionStorage.setItem('inventory-scroll',JSON.stringify(positions.current))}catch{/* In-memory positions are sufficient. */}};window.addEventListener('pagehide',save);window.addEventListener('popstate',save);return()=>{window.removeEventListener('pagehide',save);window.removeEventListener('popstate',save)}},[]);
  useLayoutEffect(()=>{const key=route.pathname+route.search;if(currentKey.current!==key){const previousPath=currentKey.current.split('?')[0];if(previousPath===route.pathname)positions.current[currentKey.current]=window.scrollY;currentKey.current=key;if(navigationType==='POP'){restoreKey.current=key;requestAnimationFrame(()=>window.scrollTo(0,positions.current[key]||0))}else if(previousPath!==route.pathname)window.scrollTo(0,0)}},[route.pathname,route.search,navigationType]);
  useEffect(()=>{const ready=()=>{if(restoreKey.current===currentKey.current){requestAnimationFrame(()=>window.scrollTo(0,positions.current[currentKey.current]||0));restoreKey.current=null}};window.addEventListener('inventory-content-ready',ready);return()=>window.removeEventListener('inventory-content-ready',ready)},[]);
  useEffect(()=>{const viewport=window.visualViewport;if(!viewport)return;const update=()=>{document.documentElement.style.setProperty('--keyboard-offset',`${Math.max(0,window.innerHeight-viewport.height-viewport.offsetTop)}px`);const active=document.activeElement;if(active instanceof HTMLInputElement||active instanceof HTMLTextAreaElement)requestAnimationFrame(()=>active.scrollIntoView({block:'nearest'}))};viewport.addEventListener('resize',update);viewport.addEventListener('scroll',update);update();return()=>{viewport.removeEventListener('resize',update);viewport.removeEventListener('scroll',update);document.documentElement.style.removeProperty('--keyboard-offset')}},[]);
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(null),12000);return()=>clearTimeout(timer)},[toast]);
  const go=(path:string,replace=false)=>{positions.current[currentKey.current]=window.scrollY;void navigate(path,{replace,state:path.includes('panel=')?{inventoryPanel:true}:undefined})};
  const back=(fallback='/items')=>{positions.current[currentKey.current]=window.scrollY;if((window.history.state?.idx||0)>0)void navigate(-1);else void navigate(fallback,{replace:true})};
  const workspace:Workspace={userId:session.user.id,locations,boxes,summary,revision,refresh,go,back,notify:(text,undo)=>setToast({message:text,undo})};
  const parts=route.pathname.split('/').filter(Boolean),kind=parts[0]||'items',id=parts[1],editor=kind==='new'||parts[2]==='edit'||parts[2]==='fill';
  let body;
  if(kind==='new'&&id==='item')body=<ItemEditor key={route.pathname} destination={new URLSearchParams(route.search).get('destination')||undefined}/>;
  else if(kind==='new'&&(id==='location'||id==='box'))body=<PlaceEditor key={route.pathname} kind={id} parentId={new URLSearchParams(route.search).get('parent')||undefined}/>;
  else if(kind==='box'&&parts[2]==='fill')body=<ItemEditor key={route.pathname} fillBoxId={id}/>;
  else if(kind==='item'&&parts[2]==='edit')body=<ItemEditor key={route.pathname} itemId={id}/>;
  else if((kind==='storage'||kind==='box')&&parts[2]==='edit')body=<PlaceEditor key={route.pathname} kind={kind==='box'?'box':'location'} id={id}/>;
  else if(kind==='item'&&id)body=<ItemScreen itemId={id} workspace={workspace}/>;
  else if(kind==='storage')body=<StorageView key={route.pathname} locationId={id}/>;
  else if(kind==='box'&&id)body=<StorageView key={route.pathname} boxId={id}/>;
  else if(kind==='settings')body=<Settings username={session.user.email}/>;
  else body=<Catalog key="inventory"/>;
  const active=kind==='storage'||kind==='box'?'storage':kind==='settings'?'settings':'items';
  let add:{path:string;label:string}|null=null;
  if(!editor){if(kind==='items'||!parts.length)add={path:'/new/item',label:'Add item'};else if(kind==='storage')add=id?{path:`/storage/${id}?panel=add-here`,label:'Add here'}:{path:'/new/location',label:'Location'};else if(kind==='box')add={path:`/new/item?destination=b:${id}`,label:'Add item'}}
  return <WorkspaceContext.Provider value={workspace}><div className={`app mobile-redesign${editor?' editing':''}`} onClick={event=>{const link=(event.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#/"]');if(link&&!event.defaultPrevented&&!event.ctrlKey&&!event.metaKey&&event.button===0){event.preventDefault();go(link.getAttribute('href')!.slice(1))}}}>
    {!editor&&<><header className="app-header"><button className="icon" aria-label="Open more navigation" onClick={()=>panel.open('more')}><Menu/></button><a className="brand" href="#/items"><PackagePlus/><span>LunasStorage</span></a><span className="account-name">{session.user.email}</span></header><aside className="desktop-nav"><NavLinks active={active}/></aside></>}
    <main><ErrorMessage error={editor?'':error}/>{error&&!editor&&<button className="text-button" onClick={()=>void refresh()}>Reconnect to the PC</button>}{loading&&!loaded.current?<p className="empty" role="status">Loading your storage…</p>:body}</main>
    {!editor&&<><nav className="bottom-nav" aria-label="Main navigation"><NavLinks active={active}/></nav>{add&&<a className="floating-add button primary" href={`#${add.path}`}><Plus size={20}/>{add.label}</a>}</>}
    {panel.panel==='more'&&<Sheet title="More" drawer onClose={panel.close}><div className="menu-options"><a className="button" href="#/settings">Settings, backups & account</a><a className="button" href="#/storage">All locations</a><a className="button" href="#/items">Your inventory</a></div></Sheet>}
    {toast&&<div className="toast" role="status"><span>{toast.message}</span>{toast.undo&&<button onClick={async()=>{try{await toast.undo!();setToast({message:'Action undone'})}catch(error){setToast({message:message(error)})}}}>Undo</button>}<button className="icon" aria-label="Dismiss message" onClick={()=>setToast(null)}>×</button></div>}
  </div></WorkspaceContext.Provider>;
}

function NavLinks({active}:{active:string}){return <><a href="#/items" aria-current={active==='items'?'page':undefined}><Archive/><span>Items</span></a><a href="#/storage" aria-current={active==='storage'?'page':undefined}><FolderTree/><span>Locations</span></a><a href="#/settings" aria-current={active==='settings'?'page':undefined}><Settings2/><span>More</span></a></>}

function ItemScreen({itemId,workspace}:{itemId:string;workspace:Workspace}){
  const[item,setItem]=useState<InventoryRow|null>(null),[error,setError]=useState('');
  useEffect(()=>{let live=true;void api.item(itemId).then(row=>{if(live){setItem(row);setError('')}}).catch(error=>{if(live)setError(message(error))});return()=>{live=false}},[itemId,workspace.revision]);
  if(!item)return <div className="empty"><ErrorMessage error={error}/><a href="#/items">Back to inventory</a>{!error&&<p role="status">Loading item…</p>}</div>;
  return <><ErrorMessage error={error}/><ItemPage item={item} locations={workspace.locations} boxes={workspace.boxes} photo={path=><Photo key={path} path={path}/>} onEdit={()=>workspace.go(`/item/${item.id}/edit`)} onArchive={()=>{void api.archive(item).then(async updated=>{setItem(updated);await workspace.refresh();workspace.notify(updated.archived?'Item archived':'Item restored',async()=>{await api.archive(updated);await workspace.refresh()})}).catch(error=>setError(message(error)))}} onMove={async destination=>{await api.move([item.id],destination.slice(2),destination.startsWith('b:')?'box':'location');await workspace.refresh();workspace.notify('Item moved')}}/></>;
}

function download(blob:Blob,name:string){const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),60000)}
const csv=(value:unknown)=>`"${String(value??'').replaceAll('"','""')}"`;
function Settings({username}:{username:string}){
  const[error,setError]=useState(''),[status,setStatus]=useState(''),[busy,setBusy]=useState(false);
  async function exportFile(kind:'json'|'csv'|'zip'){let writable:FileSystemWritableFileStream|undefined;setBusy(true);setError('');try{if(kind==='zip'){const picker=(window as Window&{showSaveFilePicker?:(options:{suggestedName:string})=>Promise<FileSystemFileHandle>}).showSaveFilePicker;if(picker){const handle=await picker.call(window,{suggestedName:'lunas-storage-backup.zip'});writable=await handle.createWritable()}const blob=await exportZip(setStatus,writable);if(blob)download(blob,'lunas-storage-backup.zip')}else{const archive=await exportRows();if(kind==='json')download(new Blob([JSON.stringify(archive,null,2)],{type:'application/json'}),'storage-inventory-v1.json');else{const rows=archive.data.items as Array<Record<string,unknown>>,places=archive.data.locations as Place[],boxes=archive.data.boxes as Box[];const content=['name,address,tags,quantity,unit,volume_l,notes,archived,id',...rows.map(row=>{const box=boxes.find(value=>value.id===row.box_id),place=places.find(value=>value.id===(box?.location_id||row.location_id));return [row.name,`${locationPath(places,box?.location_id||(typeof row.location_id==='string'?row.location_id:null))||place?.name||''}${box?' · '+boxLabel(box):''}`,(row.tags as string[]).join(';'),row.quantity,row.quantity_unit,row.volume_l,row.notes,row.archived,row.id].map(csv).join(',')})].join('\r\n');download(new Blob([content],{type:'text/csv'}),'storage-inventory.csv')}}setStatus('Download ready.')}catch(error){await writable?.abort().catch(()=>{});if(error instanceof DOMException&&error.name==='AbortError')setStatus('Backup cancelled.');else setError(message(error))}finally{setBusy(false)}}
  return <section><div className="page-heading"><h1>More</h1></div><ErrorMessage error={error}/><div className="setting-card"><h2>Backup your inventory</h2><p>The full backup includes the SQLite database and photos. JSON and CSV are useful for review.</p><button disabled={busy} className="primary" onClick={()=>void exportFile('zip')}><Download/> Full local backup</button><div className="actions"><button disabled={busy} onClick={()=>void exportFile('json')}>JSON</button><button disabled={busy} onClick={()=>void exportFile('csv')}>CSV</button></div>{status&&<p role="status">{status}</p>}</div><div className="setting-card"><h2>Account</h2><p>{username}</p><button onClick={()=>void api.logout().catch(error=>setError(message(error)))}><LogOut/> Sign out</button></div><div className="setting-card"><h2>Using your storage</h2><p>Open Locations to organize rooms, shelves and boxes. Use Fill this box to keep adding items to the same destination. Unknown quantities stay separate from out-of-stock entries.</p><p>Camera capture uses your phone's camera picker. Chrome may choose its own camera. Gallery selection remains available.</p></div></section>;
}
