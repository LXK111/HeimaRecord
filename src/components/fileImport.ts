export function acceptsFile(file: Pick<File, "name" | "type">, accept: string) {
  const fileName = file.name.toLowerCase();
  const mimeType = file.type.toLowerCase();
  return accept
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean)
    .some((token) => {
      if (token.startsWith(".")) return fileName.endsWith(token);
      if (token.endsWith("/*")) return mimeType.startsWith(token.slice(0, -1));
      return Boolean(mimeType) && mimeType === token;
    });
}

export function getImportFileError(files: File[], accept: string) {
  if (files.length === 0) return "";
  if (files.length > 1) return "一次只能导入一个文件。";
  if (!acceptsFile(files[0], accept)) {
    return `不支持文件“${files[0].name}”，请检查文件类型。`;
  }
  return "";
}
