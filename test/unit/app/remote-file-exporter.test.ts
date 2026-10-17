import { describe, expect, it, vi } from 'vitest';
import { ObservableValue } from '@/core';
import type { DocumentId } from '@/document';
import type { DownloadFile } from '@/app/app-session';
import { createRemoteFileExporter } from '@/app/remote-file-exporter';

// A test id; real ones come from the catalog of the server.
const DOC = 'doc-1' as DocumentId;
const STEP = new Uint8Array([1, 2, 3]);
const JSON_FILE = new TextEncoder().encode('{"format":"tinycad"}');

function setup(pendingAtStart = 0) {
  const pending = new ObservableValue(pendingAtStart);
  const downloads: DownloadFile[] = [];
  const exportStep = vi.fn(() => Promise.resolve({ content: STEP, fileName: 'Bracket.step' }));
  const exportFile = vi.fn(() =>
    Promise.resolve({ content: JSON_FILE, fileName: 'Bracket.tinycad.json' }),
  );
  const exporter = createRemoteFileExporter({
    session: { pending: pending.asObservable(), exportStep },
    documents: { exportFile },
    docId: DOC,
    download: (file) => downloads.push(file),
  });
  return { pending, downloads, exportStep, exportFile, exporter };
}

/** Lets the microtasks of the exporter run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('createRemoteFileExporter', () => {
  it('exports STEP from the session once the queue is empty', async () => {
    const h = setup(2);
    const done = h.exporter.exportStep([]);
    await flush();
    expect(h.exportStep).not.toHaveBeenCalled();
    h.pending.set(1);
    await flush();
    expect(h.exportStep).not.toHaveBeenCalled();
    h.pending.set(0);
    await done;
    expect(h.exportStep).toHaveBeenCalledTimes(1);
    expect(h.downloads).toEqual([{ name: 'Bracket.step', mime: 'model/step', data: STEP }]);
  });

  it('exports the document file of the server, always with history', async () => {
    const h = setup();
    await expect(h.exporter.exportDocument()).resolves.toEqual({ withHistory: true });
    expect(h.exportFile).toHaveBeenCalledWith('doc-1');
    expect(h.downloads).toEqual([
      { name: 'Bracket.tinycad.json', mime: 'application/json', data: JSON_FILE },
    ]);
  });

  it('waits for the queue before the document file too', async () => {
    const h = setup(1);
    const done = h.exporter.exportDocument();
    await flush();
    expect(h.exportFile).not.toHaveBeenCalled();
    h.pending.set(0);
    await done;
    expect(h.exportFile).toHaveBeenCalledTimes(1);
  });

  it('hands the download a copy over its own buffer', async () => {
    const h = setup();
    await h.exporter.exportStep([]);
    const data = h.downloads[0]?.data;
    expect(data).not.toBe(STEP);
    expect(data).toBeInstanceOf(Uint8Array);
  });

  it('passes a failure of the server on', async () => {
    const h = setup();
    h.exportStep.mockRejectedValueOnce(new Error('NO_BODIES'));
    await expect(h.exporter.exportStep([])).rejects.toThrow('NO_BODIES');
    expect(h.downloads).toEqual([]);
  });
});
