// 03:30: delete uploaded files no ticket refers to any more, once they are a day
// old (younger files may belong to an upload still in progress).
import { readdir, stat, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Ticket } from '../models/Ticket.js';
import { env } from '../config/env.js';

export const name = 'attachmentCleanup';
export const schedule = '30 3 * * *';

export async function run(now = new Date()) {
  const dir = resolve(env.uploadDir);
  let files;
  try {
    files = await readdir(dir);
  } catch {
    return { scanned: 0, deleted: 0, note: `upload dir ${dir} does not exist` };
  }

  const referenced = new Set(
    (await Ticket.distinct('attachments.filename')).filter(Boolean),
  );
  let deleted = 0;
  for (const f of files) {
    if (referenced.has(f)) continue;
    const full = join(dir, f);
    const info = await stat(full);
    if (info.isFile() && now - info.mtimeMs > 24 * 60 * 60 * 1000) {
      await unlink(full);
      deleted += 1;
    }
  }
  return { scanned: files.length, deleted };
}
