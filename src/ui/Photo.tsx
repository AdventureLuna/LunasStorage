import { useEffect, useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';

import { photoCache } from '../lib/photo-cache';
const {cache,urls,epoch}=photoCache();
export function Photo({path,size=320,alt='Inventory photo',interactive=false}:{path:string;size?:number;alt?:string;interactive?:boolean}){
  const[url,setUrl]=useState(''),[failed,setFailed]=useState(false),[retry,setRetry]=useState(0);
  useEffect(()=>{let live=true;const currentEpoch=epoch();setFailed(false);const key=`${path}:${size}`;let request=cache.get(key);if(!request){request=fetch(`/api/photos/file?path=${encodeURIComponent(path)}&size=${size}`,{credentials:'same-origin',cache:'no-store'}).then(response=>{if(!response.ok)throw Error('Photo unavailable');return response.blob()}).then(blob=>{if(currentEpoch!==epoch())throw Error('Session ended');const url=URL.createObjectURL(blob);urls.add(url);return url});cache.set(key,request)}void request.then(url=>{if(live)setUrl(url)}).catch(()=>{if(cache.get(key)===request)cache.delete(key);if(live)setFailed(true)});return()=>{live=false}},[path,size,retry]);
  return url?<img className="photo-thumb" src={url} alt={alt} loading="lazy"/>:failed&&interactive?<button className="photo-placeholder" onClick={event=>{event.preventDefault();event.stopPropagation();setRetry(value=>value+1)}} aria-label={`Retry ${alt}`}><ImageIcon size={24}/> Retry photo</button>:<span className="photo-placeholder"><ImageIcon size={24}/>{failed?'Photo unavailable':'Loading photo…'}</span>;
}
