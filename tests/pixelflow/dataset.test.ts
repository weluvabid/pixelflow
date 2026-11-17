import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const datasetDirectory = join(process.cwd(), 'public', 'dataset');

test('published dataset metadata matches its chunk files and record count', async () => {
  const metadata = JSON.parse(await readFile(join(datasetDirectory, 'dataset.json'), 'utf8')) as {
    version: number;
    total: number;
    chunkSize: number;
    chunkCount: number;
  };

  assert.equal(metadata.version, 1);
  assert.equal(metadata.chunkSize, 500);
  assert.ok(metadata.total > 0);
  assert.equal(Math.ceil(metadata.total / metadata.chunkSize), metadata.chunkCount);

  let total = 0;
  const ids = new Set<string>();

  for (let index = 0; index < metadata.chunkCount; index += 1) {
    const filename = `chunk-${String(index).padStart(3, '0')}.json`;
    const records = JSON.parse(await readFile(join(datasetDirectory, filename), 'utf8')) as {
      id: string;
      imageUrl: string;
      width: number;
      height: number;
      photographer: string;
    }[];

    const expectedLength = Math.min(
      metadata.chunkSize,
      metadata.total - index * metadata.chunkSize,
    );
    assert.equal(records.length, expectedLength, `${filename} has the expected length`);

    for (const record of records) {
      assert.ok(record.id);
      assert.ok(record.imageUrl.startsWith('https://images.unsplash.com/'));
      assert.ok(Number.isSafeInteger(record.width) && record.width > 0);
      assert.ok(Number.isSafeInteger(record.height) && record.height > 0);
      assert.equal(typeof record.photographer, 'string');
      assert.ok(!ids.has(record.id), `duplicate photo id: ${record.id}`);
      ids.add(record.id);
    }

    total += records.length;
  }

  assert.equal(total, metadata.total);
});
