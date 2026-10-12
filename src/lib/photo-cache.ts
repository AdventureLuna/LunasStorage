const cache=new Map<string,Promise<string>>();
const urls=new Set<string>();
let epoch=0;
export function clearPhotoCache(){epoch++;for(const url of urls)URL.revokeObjectURL(url);urls.clear();cache.clear()}

export function photoCache(){return {cache,urls,epoch:()=>epoch}}
