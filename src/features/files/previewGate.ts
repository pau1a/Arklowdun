const INLINE_IMAGE_PREFIX = 'image/';
const INLINE_PDF = 'application/pdf';
const INLINE_TEXT = 'text/plain';

const MAX_TEXT_INLINE_BYTES = 1_000_000; // 1 MB
const MAX_INLINE_BYTES = 5_000_000; // 5 MB

export type PreviewDecision =
  | { kind: 'image' }
  | { kind: 'pdf' }
  | { kind: 'text' }
  | { kind: 'blocked'; reason: PreviewBlockReason; message: string }
  | { kind: 'unavailable'; reason: PreviewBlockReason; message: string };

export type PreviewBlockReason =
  | 'missing-mime'
  | 'mime-blocked'
  | 'file-too-large'
  | 'text-too-large';

export interface PreviewContext {
  mime?: string | null;
  sizeBytes?: number | null;
}

const BLOCK_MESSAGE = 'Preview unavailable — Open Externally';

export function decidePreview(context: PreviewContext): PreviewDecision {
  const mime = context.mime?.toLowerCase() ?? null;
  const size = typeof context.sizeBytes === 'number' ? Math.max(context.sizeBytes, 0) : null;

  if (!mime) {
    return { kind: 'unavailable', reason: 'missing-mime', message: BLOCK_MESSAGE };
  }

  if (size !== null && size > MAX_INLINE_BYTES) {
    return { kind: 'unavailable', reason: 'file-too-large', message: BLOCK_MESSAGE };
  }

  if (mime.startsWith(INLINE_IMAGE_PREFIX)) {
    return { kind: 'image' };
  }

  if (mime === INLINE_PDF) {
    return { kind: 'pdf' };
  }

  if (mime === INLINE_TEXT) {
    if (size !== null && size > MAX_TEXT_INLINE_BYTES) {
      return { kind: 'blocked', reason: 'text-too-large', message: BLOCK_MESSAGE };
    }
    return { kind: 'text' };
  }

  return { kind: 'blocked', reason: 'mime-blocked', message: BLOCK_MESSAGE };
}

export function isPreviewAllowed(decision: PreviewDecision): decision is { kind: 'image' | 'pdf' | 'text' } {
  return decision.kind === 'image' || decision.kind === 'pdf' || decision.kind === 'text';
}

