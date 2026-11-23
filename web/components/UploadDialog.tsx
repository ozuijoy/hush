import { useEffect, useState } from 'react';
import { fileKind, formatBytes } from '../lib/format';
import { Button, FileGlyph, Modal } from './ui';

export const DESCRIPTION_MAX = 1000;

/**
 * 上傳前填寫描述：每個檔案都必須有描述或備註才能送出。
 * 多個檔案時可以一鍵把第一個的描述套用到全部。
 */
export function UploadDialog({
  files,
  onCancel,
  onConfirm,
}: {
  files: File[] | null;
  onCancel: () => void;
  onConfirm: (descriptions: string[]) => void;
}) {
  const [descriptions, setDescriptions] = useState<string[]>([]);

  useEffect(() => {
    setDescriptions(files ? files.map(() => '') : []);
  }, [files]);

  if (!files) return null;

  const ready =
    descriptions.length === files.length &&
    descriptions.every((text) => text.trim().length > 0 && text.trim().length <= DESCRIPTION_MAX);

  const setAt = (index: number, value: string) =>
    setDescriptions((current) => current.map((text, i) => (i === index ? value : text)));

  return (
    <Modal
      open
      onClose={onCancel}
      title={files.length > 1 ? `上傳 ${files.length} 個檔案` : '上傳檔案'}
      description="每個檔案都要附上描述或備註，方便其他成員知道這是什麼。"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            取消
          </Button>
          <Button onClick={() => onConfirm(descriptions.map((text) => text.trim()))} disabled={!ready}>
            上傳
          </Button>
        </>
      }
    >
      <div className="max-h-[50vh] space-y-4 overflow-y-auto pr-1">
        {files.map((file, index) => (
          <div key={`${file.name}-${index}`}>
            <div className="mb-1.5 flex items-center gap-2.5">
              <FileGlyph kind={fileKind(file.name, file.type)} size={30} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-white/85">{file.name}</p>
                <p className="text-[11px] text-white/35">{formatBytes(file.size)}</p>
              </div>
              {index === 0 && files.length > 1 ? (
                <button
                  type="button"
                  className="shrink-0 text-[11.5px] text-[#a99bff] hover:underline disabled:opacity-40"
                  disabled={!descriptions[0]?.trim()}
                  onClick={() => setDescriptions((current) => current.map(() => current[0]))}
                >
                  套用到全部
                </button>
              ) : null}
            </div>
            <textarea
              value={descriptions[index] ?? ''}
              onChange={(event) => setAt(index, event.target.value)}
              rows={2}
              maxLength={DESCRIPTION_MAX}
              autoFocus={index === 0}
              placeholder="描述或備註（必填），例如：11 月報價單，請週五前確認"
              className="field w-full resize-none py-2 text-[13.5px] leading-relaxed"
            />
          </div>
        ))}
      </div>
    </Modal>
  );
}
