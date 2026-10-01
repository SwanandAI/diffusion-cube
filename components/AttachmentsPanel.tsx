'use client';

import { useRef, useState } from 'react';
import { PendingAttachment } from '@/components/ChatPanel';
import { ATTACH_ACCEPT } from '@/lib/extract-text';

interface Props {
  attachments: PendingAttachment[];
  uploadedFileNames?: string[];
  onAttachFiles: (files: File[]) => void;
  onRemoveAttachment: (id: string) => void;
  // Contributor flow passes CONTRIBUTOR_ATTACH_ACCEPT (toolkit-asset-only types).
  accept?: string;
  // Contributor flow: file name → toolkit asset id, for uploads the
  // contributor agreed to share (the only uploads ever stored). Those get a
  // Download link; every other upload was read in the browser and never kept.
  viewableFiles?: Record<string, string>;
}

export default function AttachmentsPanel({ attachments, uploadedFileNames = [], onAttachFiles, onRemoveAttachment, accept = ATTACH_ACCEPT, viewableFiles }: Props) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length) onAttachFiles(files);
  }

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current++;
    if (e.dataTransfer.types.includes('Files')) setIsDragging(true);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setIsDragging(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length) onAttachFiles(files);
  }

  return (
    <div className="flex flex-col h-full">
      <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-ink-soft mb-3">Files</p>

      <div
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`rounded-lg border-2 border-dashed p-4 text-center cursor-pointer transition-colors ${
          isDragging ? 'border-coral bg-coral-soft' : 'border-navy/15 hover:border-navy/30'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={accept}
          className="hidden"
          onChange={handleFileChange}
        />
        <p className="text-xs text-ink-soft">📎 Attach files, or drag and drop</p>
      </div>

      {attachments.length > 0 && (
        <div className="flex flex-col gap-1 mt-3">
          {attachments.map((a) => (
            <div
              key={a.id}
              className={`flex items-center justify-between gap-2 text-xs rounded-lg px-2.5 py-1.5 border ${
                a.state === 'error'
                  ? 'border-coral/40 text-coral bg-coral-soft'
                  : 'border-navy/15 text-ink-soft bg-white'
              }`}
            >
              <span className="truncate">
                {a.state === 'reading' ? '⏳' : a.state === 'error' ? '⚠️' : '📎'} {a.name}
                {a.state === 'error' && a.error ? ` — ${a.error}` : ''}
              </span>
              <button
                type="button"
                onClick={() => onRemoveAttachment(a.id)}
                disabled={a.state === 'reading'}
                className="flex-shrink-0 text-ink-soft hover:text-navy disabled:opacity-30"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {uploadedFileNames.length > 0 && (
        <div className="flex flex-col gap-1 mt-3 overflow-y-auto">
          <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-ink-soft/70">Shared in this chat</p>
          {[...new Set(uploadedFileNames)].map((name) => {
            const assetId = viewableFiles?.[name];
            return (
              <div
                key={name}
                className="flex items-center justify-between gap-2 text-xs rounded-lg px-2.5 py-1.5 border border-navy/10 text-ink-soft bg-paper-dim"
              >
                <span className="truncate">✓ {name}</span>
                {assetId ? (
                  <a
                    href={`/api/toolkit-assets/${assetId}/download`}
                    download
                    className="flex-shrink-0 font-medium text-navy underline underline-offset-2 transition hover:text-coral"
                  >
                    Download
                  </a>
                ) : viewableFiles ? (
                  <span
                    className="flex-shrink-0 text-[10px] text-ink-soft/70"
                    title="Only files you agreed to share as toolkit assets are stored. Other uploads are read once and not kept."
                  >
                    Not stored
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
