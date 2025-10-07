import test from 'node:test';
import { strict as assert } from 'node:assert';

import {
  decidePreview,
  isPreviewAllowed,
} from '../src/features/files/previewGate.ts';

test('allows inline images', () => {
  const decision = decidePreview({ mime: 'image/png', sizeBytes: 120_000 });
  assert.equal(decision.kind, 'image');
  assert.equal(isPreviewAllowed(decision), true);
});

test('allows pdf preview', () => {
  const decision = decidePreview({ mime: 'application/pdf', sizeBytes: 2_000_000 });
  assert.equal(decision.kind, 'pdf');
});

test('allows small text files', () => {
  const decision = decidePreview({ mime: 'text/plain', sizeBytes: 50_000 });
  assert.equal(decision.kind, 'text');
});

test('blocks oversized text files', () => {
  const decision = decidePreview({ mime: 'text/plain', sizeBytes: 2_000_000 });
  assert.equal(decision.kind, 'blocked');
  assert.equal(decision.reason, 'text-too-large');
  assert.equal(isPreviewAllowed(decision), false);
});

test('blocks missing mime', () => {
  const decision = decidePreview({ mime: null, sizeBytes: 10 });
  assert.equal(decision.kind, 'unavailable');
  assert.equal(decision.reason, 'missing-mime');
});

test('blocks unknown types', () => {
  const decision = decidePreview({ mime: 'application/x-msdownload', sizeBytes: 1000 });
  assert.equal(decision.kind, 'blocked');
  assert.equal(decision.reason, 'mime-blocked');
});

test('blocks very large files regardless of type', () => {
  const decision = decidePreview({ mime: 'image/png', sizeBytes: 7_000_000 });
  assert.equal(decision.kind, 'unavailable');
  assert.equal(decision.reason, 'file-too-large');
});

