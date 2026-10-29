export async function copyText(text: string, clipboard: Pick<Clipboard, "writeText"> | undefined): Promise<void> {
  if (!clipboard) throw new Error("Clipboard is unavailable.");
  await clipboard.writeText(text);
}
