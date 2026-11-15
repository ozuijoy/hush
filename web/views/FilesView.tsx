import { useRef, useState, type DragEvent } from 'react';
import { api, downloadFile, uploadFile } from '../lib/api';
import { fileKind, formatBytes, formatRelative } from '../lib/format';
import type { FileItem, User } from '../lib/types';
import { DownloadIcon, EyeIcon, PlusIcon, TrashIcon } from '../components/Icons';
import { FilePreview, canPreview, type PreviewableFile } from '../components/FilePreview';
import {
  Button,
  EmptyState,
  FileGlyph,
  IconButton,
  Modal,
  Spinner,
  cx,
} from '../components/ui';
import { useToast } from '../components/Toast';

export function FilesView({
  files,
  totalBytes,
  storageDriver,
  maxUploadBytes,
  user,
  onRefresh,
}: {
  files: FileItem[];
  totalBytes: number;
  storageDriver: 's3' | 'pg';
  maxUploadBytes: number;
  user: User;
  onRefresh: () => Promise<void>;
}) {
  const [uploading, setUploading] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [confirm, setConfirm] = useState<FileItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const runUpload = async (list: File[]) => {
    if (!list.length) return;
    const accepted: File[] = [];
    for (const file of list) {
      if (file.size > maxUploadBytes) {
        toast(`${file.name} 超過 ${formatBytes(maxUploadBytes)} 上限。`, 'error');
      } else if (file.size === 0) {
        toast(`${file.name} 是空檔案。`, 'error');
      } else {
        accepted.push(file);
      }
    }
    if (!accepted.length) return;

    setUploading((current) => [...current, ...accepted.map((file) => file.name)]);
    let done = 0;
    for (const file of accepted) {
      try {
        await uploadFile(file);
        done += 1;
      } catch (caught) {
        toast(caught instanceof Error ? caught.message : '上傳失敗。', 'error');
      } finally {
        setUploading((current) => {
          const index = current.indexOf(file.name);
          return index === -1 ? current : [...current.slice(0, index), ...current.slice(index + 1)];
        });
      }
    }
    await onRefresh();
    if (done) toast(`已上傳 ${done} 個檔案。`, 'success');
    if (input.current) input.current.value = '';
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    void runUpload(Array.from(event.dataTransfer.files));
  };

  const [previewing, setPreviewing] = useState<PreviewableFile | null>(null);

  const download = async (file: PreviewableFile) => {
    try {
      await downloadFile({ createdAt: '', uploader: null, ...file });
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : '無法取得下載網址。', 'error');
    }
  };

  const removeFile = async () => {
    if (!confirm) return;
    setDeleting(true);
    try {
      await api.deleteFile(confirm.id);
      toast('檔案已移除。', 'success');
      setConfirm(null);
      await onRefresh();
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : '移除失敗。', 'error');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section className="flex h-full min-h-0 flex-col">
      <header className="border-b border-white/[0.06] px-4 py-5 lg:px-8">
        <div className="mx-auto flex max-w-4xl items-end justify-between gap-4">
          <div>
            <p className="text-[10.5px] font-medium uppercase tracking-[0.16em] text-white/25">檔案庫</p>
            <h1 className="mt-1 text-[22px] font-semibold tracking-[-0.02em] text-white">內部檔案</h1>
            <p className="mt-1 text-[12.5px] text-white/40">所有成員都能下載，只有管理員可以移除。</p>
          </div>
          <Button onClick={() => input.current?.click()} disabled={uploading.length > 0}>
            {uploading.length > 0 ? <Spinner size={14} /> : <PlusIcon size={16} />}
            上傳檔案
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 lg:px-8">
        <div className="mx-auto max-w-4xl space-y-5">
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: '檔案', value: String(files.length) },
              { label: '總容量', value: formatBytes(totalBytes) },
              { label: '儲存方式', value: storageDriver === 's3' ? '物件儲存' : '資料庫' },
            ].map((stat) => (
              <div key={stat.label} className="panel px-4 py-3">
                <p className="text-[10.5px] uppercase tracking-[0.12em] text-white/30">{stat.label}</p>
                <p className="mt-1 truncate text-[15px] font-semibold text-white/85">{stat.value}</p>
              </div>
            ))}
          </div>

          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => input.current?.click()}
            className={cx(
              'cursor-pointer rounded-2xl border border-dashed px-5 py-6 text-center transition',
              dragging
                ? 'border-[#7c6cff]/60 bg-[#7c6cff]/[0.08]'
                : 'border-white/[0.1] bg-white/[0.015] hover:border-white/[0.18] hover:bg-white/[0.03]',
            )}
          >
            <input
              ref={input}
              type="file"
              multiple
              hidden
              onChange={(event) => void runUpload(Array.from(event.target.files ?? []))}
            />
            <p className="text-[13px] text-white/60">
              把檔案拖到這裏，或<span className="text-[#b3a8ff]"> 選擇檔案</span>
            </p>
            <p className="mt-1 text-[11px] text-white/30">
              單檔上限 {formatBytes(maxUploadBytes)}
              {storageDriver === 's3' ? ' · 直接上傳到物件儲存' : ' · Postgres 直存模式'}
            </p>
          </div>

          {uploading.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {uploading.map((name) => (
                <span
                  key={name}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11.5px] text-white/55"
                >
                  <Spinner size={12} /> {name}
                </span>
              ))}
            </div>
          ) : null}

          {files.length === 0 ? (
            <div className="panel">
              <EmptyState
                icon={<PlusIcon size={20} />}
                title="還沒有檔案"
                description="上傳第一份文件、圖片或壓縮檔，所有成員都能在同一個地方取得。"
              />
            </div>
          ) : (
            <ul className="panel divide-y divide-white/[0.05] overflow-hidden">
              {files.map((file) => (
                <li key={file.id} className="group flex items-center gap-3 px-4 py-3.5 transition hover:bg-white/[0.025]">
                  <FileGlyph kind={fileKind(file.name, file.mime)} size={40} />
                  <div className="min-w-0 flex-1">
                    {canPreview(file) ? (
                      <button
                        type="button"
                        onClick={() => setPreviewing(file)}
                        className="block max-w-full truncate text-left text-[13.5px] font-medium text-white/85 hover:text-white hover:underline"
                      >
                        {file.name}
                      </button>
                    ) : (
                      <p className="truncate text-[13.5px] font-medium text-white/85">{file.name}</p>
                    )}
                    <p className="mt-0.5 truncate text-[11px] text-white/35">
                      {formatBytes(file.size)} · {file.uploader?.name ?? '已移除的成員'} ·{' '}
                      {formatRelative(file.createdAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1 opacity-70 transition group-hover:opacity-100">
                    {canPreview(file) ? (
                      <IconButton label="預覽" onClick={() => setPreviewing(file)}>
                        <EyeIcon size={16} />
                      </IconButton>
                    ) : null}
                    <IconButton label="下載" onClick={() => void download(file)}>
                      <DownloadIcon size={16} />
                    </IconButton>
                    {user.role === 'admin' ? (
                      <IconButton label="移除檔案" onClick={() => setConfirm(file)}>
                        <TrashIcon size={16} />
                      </IconButton>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <FilePreview file={previewing} onClose={() => setPreviewing(null)} onDownload={(file) => void download(file)} />

      <Modal
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        title="移除這個檔案？"
        description={`「${confirm?.name ?? ''}」會從檔案庫與聊天室中消失，成員將無法再下載。`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              取消
            </Button>
            <Button variant="danger" loading={deleting} onClick={() => void removeFile()}>
              移除檔案
            </Button>
          </>
        }
      />
    </section>
  );
}