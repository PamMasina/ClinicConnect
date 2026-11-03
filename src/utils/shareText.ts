import { Platform, Share } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

export async function shareOrDownloadText(filename: string, text: string): Promise<void> {
  if (Platform.OS === 'web') {
    const g = globalThis as any;
    const blob = new g.Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = g.URL.createObjectURL(blob);
    const a = g.document.createElement('a');
    a.href = url;
    a.download = filename;
    g.document.body.appendChild(a);
    a.click();
    a.remove();
    g.URL.revokeObjectURL(url);
    return;
  }
  await Share.share({ title: filename, message: text });
}

function loadPdfLibs(): { Print: any; Sharing: any; printToFile: any } {
  let Print: any;
  let Sharing: any;
  try {
    Print = require('expo-print');
    Sharing = require('expo-sharing');
  } catch {
    throw new Error(
      'PDF libraries not installed. Run:\n\nnpx expo install expo-print expo-sharing\n\nThen restart the app with:\nnpx expo start -c'
    );
  }

  const printToFile =
    Print.printToFileAsync || (Print.default && Print.default.printToFileAsync);

  if (typeof printToFile !== 'function') {
    throw new Error(
      'expo-print is installed but printToFileAsync is missing.\n\nStop the app and run:\nnpx expo install expo-print expo-sharing\nnpx expo start -c'
    );
  }
  return { Print, Sharing, printToFile };
}

function makeSafeName(pdfName: string): string {
  // Spaces, slashes, colons etc. produce an invalid file:// URI.
  return (
    pdfName.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'document.pdf'
  );
}

/** Open the native print preview (iOS can view / save-as-PDF from here). */
export async function viewPdf(html: string): Promise<void> {
  const { Print } = loadPdfLibs();
  const printAsync = Print.printAsync || (Print.default && Print.default.printAsync);
  if (typeof printAsync !== 'function') {
    throw new Error('Viewing is not available on this device.');
  }
  await printAsync({ html });
}

async function sharePdfIos(pdfName: string, html: string): Promise<void> {
  const { Print, Sharing, printToFile } = loadPdfLibs();

  // On iOS the file expo-print writes is already readable by the share sheet,
  // so no base64 round trip is needed.
  const { uri } = await printToFile({ html });
  let shareUri: string = uri;

  // Give the file a proper name so Files / Mail show "prescription-xxxx.pdf".
  try {
    const dir = FileSystem.cacheDirectory || FileSystem.documentDirectory;
    if (dir) {
      const target = `${dir}${makeSafeName(pdfName)}`;
      await FileSystem.deleteAsync(target, { idempotent: true });
      await FileSystem.copyAsync({ from: uri, to: target });
      shareUri = target;
    }
  } catch (copyErr) {
    console.warn('[PDF] Could not rename PDF, sharing original file:', copyErr);
  }

  try {
    const shareAsync = Sharing.shareAsync || (Sharing.default && Sharing.default.shareAsync);
    if (typeof shareAsync !== 'function') throw new Error('Sharing is not available.');
    await shareAsync(shareUri, {
      mimeType: 'application/pdf',
      UTI: 'com.adobe.pdf',
      dialogTitle: 'Save or share',
    });
  } catch (shareErr) {
    console.warn('[PDF] Share sheet failed on iOS, opening print preview instead:', shareErr);
    // The native preview lets the user view the PDF and save it from the share icon.
    const printAsync = Print.printAsync || (Print.default && Print.default.printAsync);
    if (typeof printAsync !== 'function') throw shareErr;
    await printAsync({ html });
  }
}

async function sharePdfAndroid(pdfName: string, html: string): Promise<void> {
  const { Sharing, printToFile } = loadPdfLibs();

  // expo-print writes outside the app sandbox on Android (especially Expo Go),
  // so ask for base64 and write our own copy into the cache dir.
  const { uri: tempUri, base64: printedBase64 } = await printToFile({
    html,
    base64: true,
  });

  const safeName = makeSafeName(pdfName);
  const baseDir = FileSystem.cacheDirectory || FileSystem.documentDirectory;
  if (!baseDir) {
    throw new Error('No writable directory available to store the PDF.');
  }
  const shareableUri = `${baseDir}${safeName}`;

  await FileSystem.deleteAsync(shareableUri, { idempotent: true });

  const base64: string =
    printedBase64 ||
    (await FileSystem.readAsStringAsync(tempUri, {
      encoding: FileSystem.EncodingType.Base64,
    }));
  await FileSystem.writeAsStringAsync(shareableUri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const written = await FileSystem.getInfoAsync(shareableUri);
  if (!written.exists) {
    throw new Error('Could not save the PDF before sharing.');
  }

  const isAvailableFn =
    Sharing.isAvailableAsync ||
    (Sharing.default && Sharing.default.isAvailableAsync);
  const shareAsyncFn =
    Sharing.shareAsync || (Sharing.default && Sharing.default.shareAsync);

  const canShare = typeof isAvailableFn === 'function' ? await isAvailableFn() : false;

  if (canShare && typeof shareAsyncFn === 'function') {
    await shareAsyncFn(shareableUri, {
      mimeType: 'application/pdf',
      dialogTitle: 'Save or share',
      UTI: 'com.adobe.pdf',
    });
  } else {
    await Share.share({ title: pdfName, url: shareableUri });
  }
}

async function sharePdfWeb(pdfName: string, html: string): Promise<void> {
  const { printToFile } = loadPdfLibs();
  const { uri: tempUri } = await printToFile({ html });
  const g = globalThis as any;
  try {
    const response = await fetch(tempUri);
    const blob = await response.blob();
    const url = g.URL.createObjectURL(blob);
    const a = g.document.createElement('a');
    a.href = url;
    a.download = pdfName;
    g.document.body.appendChild(a);
    a.click();
    a.remove();
    g.URL.revokeObjectURL(url);
  } catch {
    g.window.open(tempUri, '_blank');
  }
}

export async function shareOrDownloadPdf(filename: string, html: string): Promise<void> {
  const pdfName = filename.toLowerCase().endsWith('.pdf') ? filename : `${filename}.pdf`;

  try {
    if (Platform.OS === 'web') {
      await sharePdfWeb(pdfName, html);
    } else if (Platform.OS === 'ios') {
      await sharePdfIos(pdfName, html);
    } else {
      await sharePdfAndroid(pdfName, html);
    }
  } catch (e) {
    // Callers fall back to plain text on failure; log the real reason first.
    console.warn(`[PDF] Failed on ${Platform.OS}:`, e);
    throw e;
  }
}