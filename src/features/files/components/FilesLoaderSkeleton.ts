export interface FilesLoaderSkeletonOptions {
  rows?: number;
}

export function createFilesLoaderSkeleton(
  options: FilesLoaderSkeletonOptions = {},
): HTMLDivElement {
  const rows = Math.max(1, options.rows ?? 6);
  const container = document.createElement('div');
  container.className = 'files__loader-skeleton';
  container.dataset.ui = 'loading';
  for (let index = 0; index < rows; index += 1) {
    const row = document.createElement('div');
    row.className = 'files__loader-row';
    container.appendChild(row);
  }
  return container;
}

export default createFilesLoaderSkeleton;
