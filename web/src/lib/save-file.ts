// Saving a file the app made (an export). In a browser it is an ordinary
// download; in the Android app a download link does nothing, so Android's own
// "save to" screen is opened instead (FileSaverPlugin.java).

import { Capacitor, registerPlugin } from '@capacitor/core';

const FileSaver = registerPlugin<{ save(options: { name: string; mime: string; text: string }): Promise<{ saved: boolean }> }>('FileSaver');

/** Returns false if the user backed out without saving. */
export async function saveFile(name: string, mime: string, text: string): Promise<boolean> {
  if (Capacitor.isNativePlatform()) return (await FileSaver.save({ name, mime, text })).saved;
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
