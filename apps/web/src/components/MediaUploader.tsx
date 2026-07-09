'use client';

import { useState, useRef } from 'react';
import { createClient } from '@/src/lib/supabase/client';

const ALLOWED_MIME_TYPES = [
  'image/jpeg', 'image/png',
  'video/mp4',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',       // xlsx
];
const ALLOWED_EXTENSIONS = '.jpg,.jpeg,.png,.mp4,.pdf,.docx,.xlsx';
const MAX_SIZE_BYTES = 16 * 1024 * 1024; // 16 MB

export interface MediaAttachment {
  id: string;
  storage_path: string;
  original_name: string;
  mime_type: string;
  file_size_bytes: number;
  caption: string | null;
}

interface MediaUploaderProps {
  value?: MediaAttachment | null;
  onChange: (attachment: MediaAttachment | null) => void;
  caption?: string;
  onCaptionChange?: (caption: string) => void;
}

function fileIcon(mimeType: string) {
  if (mimeType.startsWith('image/')) return '🖼️';
  if (mimeType.startsWith('video/')) return '🎬';
  if (mimeType === 'application/pdf') return '📄';
  return '📎';
}

export default function MediaUploader({ value, onChange, caption = '', onCaptionChange }: MediaUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError]         = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setError('');

    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      setError('Format file tidak didukung. Gunakan JPEG, PNG, MP4, PDF, DOCX, atau XLSX.');
      return;
    }
    if (file.size > MAX_SIZE_BYTES) {
      setError(`Ukuran file melebihi batas 16 MB (${(file.size / 1024 / 1024).toFixed(1)} MB).`);
      return;
    }

    setUploading(true);
    try {
      const supabase = createClient();
      const ext      = file.name.split('.').pop() ?? 'bin';
      const path     = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('media-attachments')
        .upload(path, file, { contentType: file.type });

      if (uploadError) throw new Error(uploadError.message);

      const { data: record, error: insertError } = await supabase
        .from('media_attachments')
        .insert({
          storage_path:   path,
          original_name:  file.name,
          mime_type:      file.type,
          file_size_bytes: file.size,
          caption:        caption || null,
        })
        .select()
        .single();

      if (insertError) throw new Error(insertError.message);
      onChange(record as MediaAttachment);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload gagal');
    } finally {
      setUploading(false);
    }
  }

  async function handleRemove() {
    if (!value) return;
    const supabase = createClient();
    await supabase.storage.from('media-attachments').remove([value.storage_path]);
    await supabase.from('media_attachments').delete().eq('id', value.id);
    onChange(null);
  }

  if (value) {
    return (
      <div className="border border-gray-200 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{fileIcon(value.mime_type)}</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">{value.original_name}</p>
            <p className="text-xs text-gray-400">{(value.file_size_bytes / 1024).toFixed(0)} KB</p>
          </div>
          <button
            type="button"
            onClick={handleRemove}
            className="text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50 transition-colors"
          >
            Hapus
          </button>
        </div>
        {/* Image preview */}
        {value.mime_type.startsWith('image/') && (
          <MediaPreview storagePath={value.storage_path} />
        )}
        {/* Caption */}
        {onCaptionChange && (
          <div>
            <label className="block text-xs text-gray-500 mb-1">Caption (opsional)</label>
            <input
              type="text"
              value={caption}
              onChange={(e) => onCaptionChange(e.target.value)}
              placeholder="Tuliskan keterangan media…"
              className="block w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div
        className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
          uploading ? 'border-green-300 bg-green-50' : 'border-gray-300 hover:border-green-400'
        }`}
        onClick={() => !uploading && fileRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
      >
        {uploading ? (
          <p className="text-sm text-green-700">Mengupload…</p>
        ) : (
          <>
            <p className="text-2xl mb-1">📎</p>
            <p className="text-sm text-gray-600">Klik atau seret file media</p>
            <p className="text-xs text-gray-400 mt-0.5">JPEG · PNG · MP4 · PDF · DOCX · XLSX · maks. 16 MB</p>
          </>
        )}
        <input
          ref={fileRef}
          type="file"
          accept={ALLOWED_EXTENSIONS}
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

/** Fetches a signed URL from Supabase Storage and renders the image */
function MediaPreview({ storagePath }: { storagePath: string }) {
  const [url, setUrl] = useState('');

  useState(() => {
    (async () => {
      const supabase = createClient();
      const { data } = await supabase.storage
        .from('media-attachments')
        .createSignedUrl(storagePath, 3600);
      if (data?.signedUrl) setUrl(data.signedUrl);
    })();
  });

  if (!url) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="preview" className="max-h-40 rounded-lg object-contain border border-gray-100" />;
}
