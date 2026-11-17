#!/usr/bin/env node

import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { once } from 'node:events';
import { parse } from 'csv-parse';

const inputPath = resolve(process.argv[2] ?? 'data/unsplash/photos.tsv');
const outputPath = resolve(process.argv[3] ?? 'data/unsplash/manifest.jsonl');
const temporaryPath = `${outputPath}.tmp`;

const REQUIRED_COLUMNS = [
  'photo_id',
  'photo_url',
  'photo_image_url',
  'photo_width',
  'photo_height',
  'photographer_username',
  'photographer_first_name',
  'photographer_last_name',
  'photo_description',
  'blur_hash',
];

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function positiveInteger(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }

  const number = Number(value);

  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

/**
 * @param {unknown} value
 * @param {string} field
 * @param {number} rowNumber
 * @param {{ required?: boolean }} [options]
 * @returns {string}
 */
function httpsUrl(value, field, rowNumber, { required = false } = {}) {
  const input = typeof value === 'string' ? value.trim() : '';

  if (!input && !required) {
    return '';
  }

  if (!input) {
    throw new Error(`Row ${rowNumber}: missing ${field}`);
  }

  let url;

  try {
    url = new URL(input);
  } catch {
    throw new Error(`Row ${rowNumber}: invalid ${field}: ${input}`);
  }

  if (url.protocol !== 'https:') {
    throw new Error(`Row ${rowNumber}: ${field} must use HTTPS`);
  }

  return url.toString();
}

/**
 * @param {import('node:stream').Writable} stream
 * @param {string} line
 */
async function writeLine(stream, line) {
  if (!stream.write(line)) {
    await once(stream, 'drain');
  }
}

async function main() {
  await mkdir(dirname(outputPath), { recursive: true });
  await rm(temporaryPath, { force: true });

  const input = createReadStream(inputPath);
  const parser = input.pipe(
    parse({
      bom: true,
      columns: true,
      delimiter: '\t',
      skip_empty_lines: true,
      relax_column_count: false,
    }),
  );

  const output = createWriteStream(temporaryPath, {
    encoding: 'utf8',
    flags: 'wx',
  });

  let checkedHeader = false;
  let rowNumber = 1;
  let written = 0;
  let skipped = 0;
  let duplicates = 0;
  const seenIds = new Set();

  try {
    for await (const row of parser) {
      rowNumber += 1;

      if (!checkedHeader) {
        const missing = REQUIRED_COLUMNS.filter((column) => !Object.hasOwn(row, column));

        if (missing.length) {
          throw new Error(`Missing TSV columns: ${missing.join(', ')}`);
        }

        checkedHeader = true;
      }

      const id = row.photo_id?.trim();
      const width = positiveInteger(row.photo_width);
      const height = positiveInteger(row.photo_height);

      if (!id || !width || !height || !row.photo_image_url?.trim()) {
        skipped += 1;

        continue;
      }

      if (seenIds.has(id)) {
        duplicates += 1;

        continue;
      }

      const record = {
        id,
        url: httpsUrl(row.photo_url, 'photo_url', rowNumber),
        imageUrl: httpsUrl(row.photo_image_url, 'photo_image_url', rowNumber, {
          required: true,
        }),
        width,
        height,
        photographer: {
          username: row.photographer_username?.trim() ?? '',
          firstName: row.photographer_first_name?.trim() ?? '',
          lastName: row.photographer_last_name?.trim() ?? '',
        },
        description: row.photo_description ?? '',
        blurHash: row.blur_hash?.trim() ?? '',
      };

      await writeLine(output, `${JSON.stringify(record)}\n`);
      seenIds.add(id);

      written += 1;

      if (written % 5000 === 0) {
        process.stdout.write(`Written ${written.toLocaleString()} records\n`);
      }
    }

    if (!checkedHeader) {
      throw new Error('Input TSV is empty or has no header.');
    }

    output.end();
    await once(output, 'finish');
    await rename(temporaryPath, outputPath);

    process.stdout.write(
      `\nDone\nWritten: ${written}\nSkipped: ${skipped}\nDuplicates: ${duplicates}\nOutput: ${outputPath}\n`,
    );
  } catch (error) {
    input.destroy();
    parser.destroy();
    output.destroy();
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

main().catch((error) => {
  process.stderr.write(`Dataset preparation failed: ${error.message}\n`);

  process.exitCode = 1;
});
