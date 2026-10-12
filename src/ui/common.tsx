import { useEffect, useRef, type ReactNode } from 'react';
import { ArrowLeft, X } from 'lucide-react';
import { useWorkspace } from './model';


export function Sheet({title,onClose,children,wide=false,drawer=false}:{title:string;onClose:()=>void;children:ReactNode;wide?:boolean;drawer?:boolean}){
  const ref=useRef<HTMLElement>(null),closeRef=useRef(onClose);closeRef.current=onClose;
  useEffect(()=>{const previous=document.activeElement as HTMLElement|null;const overflow=document.body.style.overflow;document.body.style.overflow='hidden';(ref.current?.querySelector<HTMLElement>('[autofocus]')||ref.current?.querySelector<HTMLElement>('input')||ref.current?.querySelector<HTMLElement>('button'))?.focus();
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();closeRef.current()}if(event.key==='Tab'){const nodes=Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]')||[]);const first=nodes[0],last=nodes[nodes.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}}};document.addEventListener('keydown',key);return()=>{document.body.style.overflow=overflow;document.removeEventListener('keydown',key);previous?.focus()}},[]);
  const touch=useRef<{x:number;y:number}|null>(null);
  return <div className={`scrim${drawer?' drawer-scrim':''}`} onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}}><section ref={ref} className={`sheet${wide?' wide':''}${drawer?' nav-drawer':''}`} onTouchStart={event=>{if(drawer)touch.current={x:event.touches[0].clientX,y:event.touches[0].clientY}}} onTouchEnd={event=>{const start=touch.current,end=event.changedTouches[0];if(drawer&&start&&start.x-end.clientX>80&&start.x-end.clientX>Math.abs(start.y-end.clientY)*1.5)onClose();touch.current=null}} role="dialog" aria-modal="true" aria-label={title}><header className="sheet-header"><h2>{title}</h2><button className="icon" aria-label={`Close ${title}`} onClick={onClose}><X/></button></header>{children}</section></div>;
}


export function FormHeader({title,context,children}:{title:string;context?:string;children?:ReactNode}){const{back}=useWorkspace();return <header className="form-header"><button className="icon" aria-label="Back" onClick={()=>back()}><ArrowLeft/></button><div><h1>{title}</h1>{context&&<p>{context}</p>}</div>{children}</header>}
export function ErrorMessage({error}:{error:string}){return error?<div className="alert" role="alert">{error}</div>:null}
