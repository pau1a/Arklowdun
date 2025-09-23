import createButton from '@ui/Button';
import createModal, { type ModalInstance } from '@ui/Modal';
import type { DbHealthReport } from '@bindings/DbHealthReport';
import type { AppError } from '@store/index';

export type DbHealthPhase = 'idle' | 'pending' | 'error';

export interface DbHealthDrawerProps {
  open: boolean;
  phase: DbHealthPhase;
  report: DbHealthReport | null;
  error?: AppError | null;
  lastUpdated?: number | null;
  onOpenChange?: (open: boolean) => void;
}

export interface DbHealthDrawerInstance {
  root: HTMLDivElement;
  dialog: HTMLDivElement;
  setOpen: (open: boolean) => void;
  update: (next: Partial<DbHealthDrawerProps>) => void;
  isOpen: () => boolean;
}

const BADGE_TONES = [
  'db-health-drawer__badge--ok',
  'db-health-drawer__badge--warn',
  'db-health-drawer__badge--running',
  'db-health-drawer__badge--error',
] as const;

const numberFormatter = new Intl.NumberFormat();

function formatDate(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
}

function formatCheckName(name: string): string {
  if (!name) return 'Check';
  return name
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return '0 ms';
  const safe = Math.max(0, Math.round(ms));
  return `${numberFormatter.format(safe)} ms`;
}

export function createDbHealthDrawer(
  props: DbHealthDrawerProps,
): DbHealthDrawerInstance {
  const titleId = 'db-health-drawer-title';
  const summaryId = 'db-health-drawer-summary';

  let currentOpen = props.open;
  let currentPhase: DbHealthPhase = props.phase;
  let currentReport: DbHealthReport | null = props.report;
  let currentError: AppError | null = props.error ?? null;
  let currentLastUpdated: number | null = props.lastUpdated ?? null;
  let currentOnOpenChange = props.onOpenChange ?? null;

  const summary = document.createElement('p');
  summary.id = summaryId;
  summary.className = 'db-health-drawer__summary';
  summary.hidden = true;

  let modal: ModalInstance;
  const handleOpenChange = (open: boolean) => {
    currentOpen = open;
    if (modal && modal.isOpen() !== open) {
      modal.setOpen(open);
    }
    currentOnOpenChange?.(open);
  };

  modal = createModal({
    open: currentOpen,
    titleId,
    descriptionId: summaryId,
    closeOnOverlayClick: true,
    onOpenChange: handleOpenChange,
  });

  modal.root.classList.add('db-health-drawer__overlay');
  modal.dialog.classList.add('db-health-drawer');
  modal.dialog.dataset.ui = 'db-health-drawer';

  const header = document.createElement('header');
  header.className = 'db-health-drawer__header';

  const heading = document.createElement('div');
  heading.className = 'db-health-drawer__heading';

  const title = document.createElement('h2');
  title.id = titleId;
  title.className = 'db-health-drawer__title';
  title.textContent = 'Database health';

  const statusLine = document.createElement('div');
  statusLine.className = 'db-health-drawer__status';

  const spinner = document.createElement('span');
  spinner.className = 'db-health-drawer__spinner';
  spinner.setAttribute('aria-hidden', 'true');

  const badge = document.createElement('span');
  badge.className = 'db-health-drawer__badge';

  statusLine.append(spinner, badge);

  heading.append(title, statusLine, summary);

  const closeButton = createButton({
    label: 'Close',
    variant: 'ghost',
    size: 'sm',
    className: 'db-health-drawer__close',
    onClick: (event) => {
      event.preventDefault();
      handleOpenChange(false);
    },
  });

  header.append(heading, closeButton);

  const errorAlert = document.createElement('div');
  errorAlert.className = 'db-health-drawer__error';
  errorAlert.setAttribute('role', 'alert');
  errorAlert.hidden = true;

  const sections = document.createElement('div');
  sections.className = 'db-health-drawer__sections';

  const checksSection = document.createElement('section');
  checksSection.className = 'db-health-drawer__section';

  const checksTitle = document.createElement('h3');
  checksTitle.textContent = 'Checks';

  const checkList = document.createElement('ul');
  checkList.className = 'db-health-drawer__checks';

  checksSection.append(checksTitle, checkList);

  const offendersSection = document.createElement('section');
  offendersSection.className = 'db-health-drawer__section';

  const offendersTitle = document.createElement('h3');
  offendersTitle.textContent = 'Violations';

  const offendersEmpty = document.createElement('p');
  offendersEmpty.className = 'db-health-drawer__offenders-empty';
  offendersEmpty.textContent = 'No violations detected.';

  const offendersList = document.createElement('ul');
  offendersList.className = 'db-health-drawer__offenders';

  offendersSection.append(offendersTitle, offendersEmpty, offendersList);

  const metadataSection = document.createElement('section');
  metadataSection.className = 'db-health-drawer__section';

  const metadataTitle = document.createElement('h3');
  metadataTitle.textContent = 'Metadata';

  const metadataList = document.createElement('dl');
  metadataList.className = 'db-health-drawer__metadata';

  metadataSection.append(metadataTitle, metadataList);

  sections.append(checksSection, offendersSection, metadataSection);

  modal.dialog.append(header, errorAlert, sections);

  const applyBadgeTone = (tone: (typeof BADGE_TONES)[number]) => {
    badge.classList.remove(...BADGE_TONES);
    badge.classList.add(tone);
  };

  const syncChecks = () => {
    checkList.innerHTML = '';
    if (!currentReport || !Array.isArray(currentReport.checks)) {
      checksSection.hidden = true;
      return;
    }

    checksSection.hidden = false;
    for (const check of currentReport.checks) {
      const item = document.createElement('li');
      item.className = 'db-health-drawer__check';

      const headerRow = document.createElement('div');
      headerRow.className = 'db-health-drawer__check-header';

      const name = document.createElement('span');
      name.className = 'db-health-drawer__check-name';
      name.textContent = formatCheckName(check.name);

      const status = document.createElement('span');
      status.className = 'db-health-drawer__check-status';
      status.textContent = check.passed ? 'Passed' : 'Failed';
      status.classList.add(
        check.passed
          ? 'db-health-drawer__check-status--ok'
          : 'db-health-drawer__check-status--fail',
      );

      const duration = document.createElement('span');
      duration.className = 'db-health-drawer__check-duration';
      duration.textContent = formatDuration(check.duration_ms);

      headerRow.append(name, status, duration);
      item.appendChild(headerRow);

      if (check.details) {
        const detail = document.createElement('p');
        detail.className = 'db-health-drawer__check-detail';
        detail.textContent = check.details;
        item.appendChild(detail);
      }

      checkList.appendChild(item);
    }
  };

  const syncOffenders = () => {
    offendersList.innerHTML = '';
    if (!currentReport) {
      offendersSection.hidden = true;
      return;
    }

    const offenders = currentReport.offenders ?? [];
    if (!offenders.length) {
      offendersEmpty.hidden = false;
      offendersSection.hidden = false;
      return;
    }

    offendersEmpty.hidden = true;
    offendersSection.hidden = false;

    for (const offender of offenders) {
      const item = document.createElement('li');
      item.className = 'db-health-drawer__offender';

      const headerRow = document.createElement('div');
      headerRow.className = 'db-health-drawer__offender-header';

      const table = document.createElement('span');
      table.className = 'db-health-drawer__offender-table';
      table.textContent = offender.table;

      const rowId = document.createElement('span');
      rowId.className = 'db-health-drawer__offender-rowid';
      rowId.textContent = `row ${numberFormatter.format(offender.rowid)}`;

      headerRow.append(table, rowId);

      const message = document.createElement('p');
      message.className = 'db-health-drawer__offender-message';
      message.textContent = offender.message;

      item.append(headerRow, message);
      offendersList.appendChild(item);
    }
  };

  const syncMetadata = () => {
    metadataList.innerHTML = '';
    if (!currentReport) {
      metadataSection.hidden = true;
      return;
    }

    const rows: Array<[string, string | null]> = [
      ['Schema hash', currentReport.schema_hash || null],
      ['App version', currentReport.app_version || null],
      [
        'Generated at',
        formatDate(currentReport.generated_at) ?? currentReport.generated_at,
      ],
    ];

    for (const [label, value] of rows) {
      if (!value) continue;
      const term = document.createElement('dt');
      term.textContent = label;
      const desc = document.createElement('dd');
      desc.textContent = value;
      metadataList.append(term, desc);
    }

    metadataSection.hidden = metadataList.childElementCount === 0;
  };

  const syncSummary = () => {
    const parts: string[] = [];
    if (currentPhase === 'pending') {
      parts.push(
        currentReport
          ? 'Health check is running. Showing the most recent report.'
          : 'Initial health check is running.',
      );
    }

    if (currentReport?.generated_at) {
      const generated = formatDate(currentReport.generated_at);
      if (generated) parts.push(`Generated ${generated}`);
    }

    if (currentLastUpdated) {
      const updated = formatDate(currentLastUpdated);
      if (updated) parts.push(`Last updated ${updated}`);
    }

    if (currentReport?.offenders?.length) {
      parts.push(
        `${numberFormatter.format(currentReport.offenders.length)} violation(s) detected`,
      );
    }

    if (parts.length === 0 && currentPhase === 'error') {
      parts.push('Unable to retrieve the latest health report.');
    }

    summary.textContent = parts.join(' • ');
    summary.hidden = summary.textContent.trim().length === 0;
  };

  const syncStatus = () => {
    let tone: (typeof BADGE_TONES)[number] = 'db-health-drawer__badge--ok';
    let label = 'Healthy';
    let accent = 'var(--color-accent)';

    if (currentPhase === 'pending') {
      tone = 'db-health-drawer__badge--running';
      label = currentReport ? 'Re-checking…' : 'Checking…';
      accent = 'var(--color-accent)';
    } else if (currentPhase === 'error') {
      tone = 'db-health-drawer__badge--error';
      label = 'Unavailable';
      accent = 'var(--color-danger)';
    } else if (currentReport?.status === 'error') {
      tone = 'db-health-drawer__badge--warn';
      label = 'Needs attention';
      accent = 'var(--color-danger)';
    } else if (tone === 'db-health-drawer__badge--ok') {
      accent = 'var(--color-success)';
    }

    applyBadgeTone(tone);
    badge.textContent = label;
    spinner.hidden = currentPhase !== 'pending';
    modal.dialog.style.setProperty('--db-health-accent', accent);
  };

  const syncError = () => {
    if (currentPhase !== 'error') {
      errorAlert.hidden = true;
      errorAlert.textContent = '';
      return;
    }

    const code = currentError?.code ? ` (${currentError.code})` : '';
    const message = currentError?.message ?? 'Database health report unavailable.';
    errorAlert.textContent = `${message}${code}`;
    errorAlert.hidden = false;
  };

  const sync = () => {
    if (currentOpen !== modal.isOpen()) {
      modal.setOpen(currentOpen);
    }
    syncStatus();
    syncSummary();
    syncError();
    syncChecks();
    syncOffenders();
    syncMetadata();
  };

  sync();

  const instance: DbHealthDrawerInstance = {
    root: modal.root,
    dialog: modal.dialog,
    setOpen(nextOpen: boolean) {
      currentOpen = nextOpen;
      handleOpenChange(nextOpen);
    },
    update(next: Partial<DbHealthDrawerProps>) {
      if (next.phase !== undefined) currentPhase = next.phase;
      if (next.report !== undefined) currentReport = next.report;
      if (next.error !== undefined) currentError = next.error ?? null;
      if (next.lastUpdated !== undefined)
        currentLastUpdated = next.lastUpdated ?? null;
      if (next.onOpenChange !== undefined)
        currentOnOpenChange = next.onOpenChange ?? null;
      if (next.open !== undefined) currentOpen = next.open;
      sync();
    },
    isOpen() {
      return modal.isOpen();
    },
  };

  return instance;
}

export default createDbHealthDrawer;
