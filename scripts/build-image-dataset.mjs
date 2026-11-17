#!/usr/bin/env node

import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { createInterface } from 'node:readline';

const inputPath = resolve(process.argv[2] ?? 'data/unsplash/manifest.jsonl');
const outputDirectory = resolve(process.argv[3] ?? 'public/dataset');
const temporaryDirectory = `${outputDirectory}.tmp`;
const CHUNK_SIZE = 500;

/**
 * @typedef {Object} PhotoRecord
 * @property {string} id
 * @property {string} imageUrl
 * @property {number} width
 * @property {number} height
 * @property {string} photographer
 */

/**
 * @param {import('node:stream').Writable} stream
 * @param {string} value
 */
async function writeWithBackpressure(stream, value) {
  if (!stream.write(value)) {
    await once(stream, 'drain');
  }
}

/**
 * @param {Record<string, unknown>} source
 * @param {number} lineNumber
 * @returns {PhotoRecord}
 */
function normalizeRecord(source, lineNumber) {
  const id = typeof source.id === 'string' ? source.id.trim() : '';
  const imageUrl = typeof source.imageUrl === 'string' ? source.imageUrl.trim() : '';
  const width = Number(source.width);
  const height = Number(source.height);

  if (
    !id ||
    !imageUrl ||
    !Number.isSafeInteger(width) ||
    width <= 0 ||
    !Number.isSafeInteger(height) ||
    height <= 0
  ) {
    throw new Error(`Invalid photo record at manifest line ${lineNumber}.`);
  }

  const parsedUrl = new URL(imageUrl);

  if (parsedUrl.protocol !== 'https:' || parsedUrl.hostname !== 'images.unsplash.com') {
    throw new Error(`Unsupported image URL at manifest line ${lineNumber}.`);
  }

  const photographerSource = source.photographer;
  const photographerObject =
    typeof photographerSource === 'object' && photographerSource !== null
      ? /** @type {Record<string, unknown>} */ (photographerSource)
      : null;

  const photographer =
    typeof photographerSource === 'string'
      ? photographerSource.trim()
      : [photographerObject?.firstName, photographerObject?.lastName]
          .filter((part) => typeof part === 'string' && part.trim())
          .join(' ')
          .trim();

  return { id, imageUrl: parsedUrl.toString(), width, height, photographer };
}

async function main() {
  await rm(temporaryDirectory, { recursive: true, force: true });
  await mkdir(temporaryDirectory, { recursive: true });

  const input = createReadStream(inputPath, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  /** @type {PhotoRecord[]} */
  let chunk = [];
  let chunkIndex = 0;
  let total = 0;
  /** @type {import('node:fs').WriteStream | undefined} */
  let output;

  async function flushChunk() {
    if (chunk.length === 0) {
      return;
    }

    const filename = `chunk-${String(chunkIndex).padStart(3, '0')}.json`;
    const path = resolve(temporaryDirectory, filename);

    output = createWriteStream(path, { encoding: 'utf8', flags: 'wx' });

    await writeWithBackpressure(output, JSON.stringify(chunk));
    const finished = once(output, 'finish');

    output.end();
    await finished;

    chunkIndex += 1;
    chunk = [];
  }

  try {
    let lineNumber = 0;

    for await (const line of lines) {
      lineNumber += 1;

      if (!line.trim()) {
        continue;
      }

      /** @type {unknown} */
      let parsed;

      try {
        parsed = JSON.parse(line);
      } catch {
        throw new Error(`Invalid JSON at manifest line ${lineNumber}.`);
      }

      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error(`Invalid photo record at manifest line ${lineNumber}.`);
      }

      chunk.push(normalizeRecord(/** @type {Record<string, unknown>} */ (parsed), lineNumber));

      total += 1;

      if (chunk.length === CHUNK_SIZE) {
        await flushChunk();
      }

      if (total > 0 && total % 5000 === 0) {
        process.stdout.write(`Prepared ${total.toLocaleString()} records\n`);
      }
    }

    await flushChunk();

    if (total === 0) {
      throw new Error('Manifest contains no photo records.');
    }

    const metadata = {
      version: 1,
      total,
      chunkSize: CHUNK_SIZE,
      chunkCount: chunkIndex,
    };

    await writeFile(
      resolve(temporaryDirectory, 'dataset.json'),
      `${JSON.stringify(metadata, null, 2)}\n`,
    );
    await rm(outputDirectory, { recursive: true, force: true });
    await rename(temporaryDirectory, outputDirectory);

    process.stdout.write(
      `\nDataset ready: ${total.toLocaleString()} records in ${chunkIndex} chunks.\n`,
    );
    process.stdout.write(`Output: ${outputDirectory}\n`);
  } catch (error) {
    output?.destroy();
    input.destroy();
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}

main().catch((error) => {
  process.stderr.write(`Image dataset build failed: ${error.message}\n`);

  process.exitCode = 1;
});
