import { useEffect, useState } from 'react';
import { Camera, ImagePlus, X } from 'lucide-react';

type Props = {
  files: File[];
  disabled: boolean;
  onFiles: (files: File[]) => void;
  onRemove: (index: number) => void;
  onCamera: () => void;
};

export function PhotoPicker({ files, disabled, onFiles, onRemove, onCamera }: Props) {
  return <section aria-label="Add photos">
    <div className="upload-options">
      <button type="button" disabled={disabled} className="upload-card" onClick={onCamera}>
        <Camera/><span><strong>Take a photo</strong><small>Use the rear camera</small></span>
      </button>
      <label className="upload-card">
        <ImagePlus/><span><strong>Choose photos</strong><small>Select several at once</small></span>
        <input aria-label="Choose photos from the gallery" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={disabled}
          onChange={event => {
            // Snapshot the FileList before resetting the picker. React may defer state updates.
            const picked = Array.from(event.currentTarget.files ?? []);
            event.currentTarget.value = '';
            if (picked.length) onFiles(picked);
          }}/>
      </label>
    </div>
    {files.length > 0 && <>
      <p className="hint">{files.length} photo{files.length === 1 ? '' : 's'} waiting to upload</p>
      <div className="pending-photos">{files.map((file, index) => <PendingPhoto key={`${index}:${file.name}:${file.lastModified}`} file={file} disabled={disabled} onRemove={() => onRemove(index)}/>)}</div>
    </>}
  </section>;
}

function PendingPhoto({ file, disabled, onRemove }: { file: File; disabled: boolean; onRemove: () => void }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return <figure className="pending-photo">
    <img src={url || undefined} alt={file.name}/>
    <button type="button" className="icon" disabled={disabled} aria-label={`Remove pending photo ${file.name}`} onClick={onRemove}><X size={16}/></button>
    <figcaption title={file.name}>{file.name}</figcaption>
  </figure>;
}
