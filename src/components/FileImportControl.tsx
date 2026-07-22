import { useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from "react";
import { getImportFileError } from "./fileImport";

type FileImportControlProps = {
  accept: string;
  icon: ReactNode;
  label: string;
  onFile: (file: File) => void | Promise<void>;
  onReject: (message: string) => void;
};

export function FileImportControl({ accept, icon, label, onFile, onReject }: FileImportControlProps) {
  const [isDragging, setIsDragging] = useState(false);
  const dragDepth = useRef(0);

  function importFiles(files: File[]) {
    if (files.length === 0) return;
    const error = getImportFileError(files, accept);
    if (error) {
      onReject(error);
      return;
    }
    const [file] = files;
    void Promise.resolve(onFile(file)).catch(() => onReject("读取文件失败，请重新选择。"));
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    // 立即清空控件值，确保失败后仍可重新选择同一个文件。
    event.currentTarget.value = "";
    importFiles(files);
  }

  function handleDragEnter(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    event.stopPropagation();
    dragDepth.current += 1;
    setIsDragging(true);
  }

  function handleDragOver(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleDragLeave(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    event.stopPropagation();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setIsDragging(false);
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    event.stopPropagation();
    dragDepth.current = 0;
    setIsDragging(false);
    importFiles(Array.from(event.dataTransfer.files));
  }

  return (
    <label
      className={`file-button${isDragging ? " is-dragging" : ""}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {icon}
      <span>{isDragging ? "松开导入" : label}</span>
      <input type="file" accept={accept} aria-label={label} onChange={handleChange} />
    </label>
  );
}
