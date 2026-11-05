export function makeUrl(bytes: Uint8Array, type: string): string {
  return URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
}

export function triggerDownload(url: string, fileName: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
