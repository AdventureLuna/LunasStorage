import { createContext, useContext } from 'react';
import type { Box, Location, StorageSummary } from '../lib/types';

export type Workspace = {
  userId:string; locations:Location[]; boxes:Box[]; summary:StorageSummary; revision:number;
  refresh:()=>Promise<void>; go:(path:string,replace?:boolean)=>void; back:(fallback?:string)=>void;
  notify:(message:string,undo?:()=>Promise<void>)=>void;
};
export const emptySummary:StorageSummary={totals:{locations:0,boxes:0,items:0,archived_items:0},locations:{},boxes:{}};
export const WorkspaceContext=createContext<Workspace|null>(null);
export function useWorkspace(){const value=useContext(WorkspaceContext);if(!value)throw Error('Workspace provider is missing');return value;}
export function locationPath(locations:Location[],id:string|null):string {
  const names:string[]=[],seen=new Set<string>();let current=locations.find(row=>row.id===id);
  while(current&&!seen.has(current.id)){seen.add(current.id);names.unshift(current.name);current=locations.find(row=>row.id===current?.parent_id)}
  return names.join(' › ');
}
export function destinationLabel(locations:Location[],boxes:Box[],value:string){
  const box=boxes.find(row=>value===`b:${row.id}`);if(box)return box.description?.trim()||`Box ${box.box_number}`;
  return locations.find(row=>value===`l:${row.id}`)?.name||'Choose a box or location';
}
export function readPreference<T>(key:string,fallback:T):T{try{return JSON.parse(localStorage.getItem(key)||'null')??fallback}catch{return fallback}}
export function writePreference(key:string,value:unknown){try{localStorage.setItem(key,JSON.stringify(value))}catch{/* Preferences remain usable in memory. */}}
export function message(error:unknown){return error instanceof TypeError?'The PC is unreachable. Check your Wi-Fi and that the server is running. Your input is still here.':error instanceof Error?error.message:String(error)}
