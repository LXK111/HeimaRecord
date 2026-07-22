import { Upload } from "lucide-react";
import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { getImportFileError } from "./fileImport";

type FileDropZoneProps = {
  accept: string;
  children: ReactNode;
  className: string;
  dropLabel: string;
  onFile: (file: File) => void | Promise<void>;
  onReject: (message: string) => void;
};

function containsFiles(event: DragEvent<HTMLElement>) {
  return Array.from(event.dataTransfer.types).includes("Files");
}

export function FileDropZone({ accept, children, className, dropLabel, onFile, onReject }: FileDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const dragDepth = useRef(0);

  function handleDragEnter(event: DragEvent<HTMLElement>) {
    if (!containsFiles(event)) return;
    event.preventDefault();
    dragDepth.current += 1;
    setIsDragging(true);
  }

  function handleDragOver(event: DragEvent<HTMLElement>) {
    if (!containsFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleDragLeave(event: DragEvent<HTMLElement>) {
    if (!isDragging) return;
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setIsDragging(false);
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    if (!containsFiles(event)) return;
    event.preventDefault();
    dragDepth.current = 0;
    setIsDragging(false);
    const files = Array.from(event.dataTransfer.files);
    const error = getImportFileError(files, accept);
    if (error) {
      onReject(error);
      return;
    }
    if (files[0]) {
      void Promise.resolve(onFile(files[0])).catch(() => onReject("读取文件失败，请重新拖入。"));
    }
  }

  return (
    <section
      className={`file-drop-zone ${className}${isDragging ? " is-page-dragging" : ""}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {children}
      <div className="file-drop-overlay" role="status" aria-hidden={!isDragging}>
        <Upload size={34} />
        <strong>{dropLabel}</strong>
        <span>松开即可导入</span>
      </div>
    </section>
  );
}
