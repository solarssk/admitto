/** Build an RFC 6266 attachment header without allowing a filename to terminate its quoted value. */
export function attachmentContentDisposition(filename: string): string {
  const safeFilename = filename.replaceAll("\\", String.raw`\\`).replaceAll('"', '\\"');
  return `attachment; filename="${safeFilename}"`;
}
