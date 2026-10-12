import { useEffect,useRef } from 'react';
import { useBlocker, useSearchParams,useNavigate } from 'react-router-dom';
export function usePanel(){const[params,setParams]=useSearchParams(),navigate=useNavigate();return {panel:params.get('panel'),open:(name:string)=>{const next=new URLSearchParams(params);next.set('panel',name);setParams(next,{state:{inventoryPanel:true}})},close:()=>{if(window.history.state?.usr?.inventoryPanel&&(window.history.state?.idx||0)>0){void navigate(-1);return}const next=new URLSearchParams(params);next.delete('panel');next.delete('create');setParams(next,{replace:true})}}}

export function useUnsaved(dirty:boolean,busy:boolean,allow:React.RefObject<boolean>,onDiscard?:()=>void){
  const discard=useRef(onDiscard);discard.current=onDiscard;
  const blocker=useBlocker(({currentLocation,nextLocation})=>!allow.current&&(busy||(dirty&&currentLocation.pathname!==nextLocation.pathname)));
  useEffect(()=>{if(blocker.state==='blocked'){if(!busy&&confirm('Discard unsaved changes?')){discard.current?.();allow.current=true;blocker.proceed()}else blocker.reset()}},[blocker,busy,allow]);
  useEffect(()=>{const before=(event:BeforeUnloadEvent)=>{if((dirty||busy)&&!allow.current){event.preventDefault();event.returnValue=''}};window.addEventListener('beforeunload',before);return()=>window.removeEventListener('beforeunload',before)},[dirty,busy,allow]);
}
