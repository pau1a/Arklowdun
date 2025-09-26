import createButton from '@ui/Button';
import createModal, { type ModalInstance } from '@ui/Modal';
import type { DbHealthReport } from '@bindings/DbHealthReport';
import type { AppError } from '@store/index';
import { recoveryText } from '@strings/recovery';

export type DbHealthPhase = 'idle' | 'pending' | 'error';

export interface DbHealthDrawerProps {
  open: boolean;
  phase: DbHealthPhase;
  report: DbHealthReport | null;
  error?: AppError | null;
  lastUpdated?: number | null;
  onOpenChange?: (open: boolean) => void;
  onRecheck?: () => void | Promise<void>;
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
  if (!name) return recoveryText('db.health.drawer.check_default');
  return name
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) {
    return recoveryText('db.health.drawer.duration', {
      value: numberFormatter.format(0),
    });
  }
  const safe = Math.max(0, Math.round(ms));
  return recoveryText('db.health.drawer.duration', {
    value: numberFormatter.format(safe),
  });
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
  let currentOnRecheck = props.onRecheck ?? null;

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
  title.textContent = recoveryText('db.health.drawer.title');

  const statusLine = document.createElement('div');
  statusLine.className = 'db-health-drawer__status';

  const spinner = document.createElement('span');
  spinner.className = 'db-health-drawer__spinner';
  spinner.setAttribute('aria-hidden', 'true');

  const badge = document.createElement('span');
  badge.className = 'db-health-drawer__badge';

  statusLine.append(spinner, badge);

  heading.append(title, statusLine, summary);

  const controls = document.createElement('div');
  controls.className = 'db-health-drawer__controls';

  const recheckButton = createButton({
    label: recoveryText('db.health.drawer.recheck'),
    variant: 'primary',
    size: 'sm',
    className: 'db-health-drawer__recheck',
  });

  const closeButton = createButton({
    label: recoveryText('db.common.close'),
    variant: 'ghost',
    size: 'sm',
    className: 'db-health-drawer__close',
    onClick: (event) => {
      event.preventDefault();
      handleOpenChange(false);
    },
  });

  controls.append(recheckButton, closeButton);
  header.append(heading, controls);

  let recheckInFlight = false;

  const syncControls = () => {
    const hasHandler = typeof currentOnRecheck === 'function';
    if (!hasHandler) {
      recheckButton.hidden = true;
      recheckButton.update({
        disabled: true,
        label: recoveryText('db.health.drawer.recheck'),
      });
      return;
    }

    recheckButton.hidden = false;
    const baseLabel = currentReport
      ? recoveryText('db.health.drawer.recheck_again')
      : recoveryText('db.health.drawer.recheck');
    const pendingLabel = currentReport
      ? recoveryText('db.health.drawer.rechecking')
      : recoveryText('db.health.drawer.checking');
    const disable = recheckInFlight || currentPhase === 'pending';
    recheckButton.update({
      label: disable ? pendingLabel : baseLabel,
      disabled: disable,
    });
  };

  const triggerRecheck = async () => {
    if (typeof currentOnRecheck !== 'function') return;
    if (recheckInFlight) return;
    recheckInFlight = true;
    syncControls();
    try {
      await currentOnRecheck();
    } catch {
      // Errors are surfaced through store state updates.
    } finally {
      recheckInFlight = false;
      syncControls();
    }
  };

  recheckButton.addEventListener('click', (event) => {
    event.preventDefault();
    void triggerRecheck();
  });

  const errorAlert = document.createElement('div');
  errorAlert.className = 'db-health-drawer__error';
  errorAlert.setAttribute('role', 'alert');
  errorAlert.hidden = true;

  const sections = document.createElement('div');
  sections.className = 'db-health-drawer__sections';

  const checksSection = document.createElement('section');
  checksSection.className = 'db-health-drawer__section';

  const checksTitle = document.createElement('h3');
  checksTitle.textContent = recoveryText('db.health.drawer.checks');

  const checkList = document.createElement('ul');
  checkList.className = 'db-health-drawer__checks';

  checksSection.append(checksTitle, checkList);

  const offendersSection = document.createElement('section');
  offendersSection.className = 'db-health-drawer__section';

  const offendersTitle = document.createElement('h3');
  offendersTitle.textContent = recoveryText('db.health.drawer.violations');

  const offendersEmpty = document.createElement('p');
  offendersEmpty.className = 'db-health-drawer__offenders-empty';
  offendersEmpty.textContent = recoveryText('db.health.drawer.no_violations');

  const offendersList = document.createElement('ul');
  offendersList.className = 'db-health-drawer__offenders';

  offendersSection.append(offendersTitle, offendersEmpty, offendersList);

  const metadataSection = document.createElement('section');
  metadataSection.className = 'db-health-drawer__section';

  const metadataTitle = document.createElement('h3');
  metadataTitle.textContent = recoveryText('db.health.drawer.metadata');

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
      status.textContent = check.passed
        ? recoveryText('db.health.drawer.check_passed')
        : recoveryText('db.health.drawer.check_failed');
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
      rowId.textContent = recoveryText('db.health.drawer.row', {
        id: numberFormatter.format(offender.rowid),
      });

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
      [
        recoveryText('db.health.drawer.metadata_schema_hash'),
        currentReport.schema_hash || null,
      ],
      [
        recoveryText('db.health.drawer.metadata_app_version'),
        currentReport.app_version || null,
      ],
      [
        recoveryText('db.health.drawer.metadata_generated_at'),
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
          ? recoveryText('db.health.drawer.summary_running_existing')
          : recoveryText('db.health.drawer.summary_running_initial'),
      );
    }

    if (currentReport?.generated_at) {
      const generated = formatDate(currentReport.generated_at);
      if (generated)
        parts.push(
          recoveryText('db.health.description.generated', {
            timestamp: generated,
          }),
        );
    }

    if (currentLastUpdated) {
      const updated = formatDate(currentLastUpdated);
      if (updated)
        parts.push(
          recoveryText('db.health.description.updated', {
            timestamp: updated,
          }),
        );
    }

    if (currentReport?.offenders?.length) {
      parts.push(
        recoveryText('db.health.description.violations', {
          count: numberFormatter.format(currentReport.offenders.length),
        }),
      );
    }

    if (parts.length === 0 && currentPhase === 'error') {
      parts.push(recoveryText('db.health.drawer.summary_unavailable'));
    }

    summary.textContent = parts.join(' • ');
    summary.hidden = summary.textContent.trim().length === 0;
  };

  const syncStatus = () => {
    let tone: (typeof BADGE_TONES)[number] = 'db-health-drawer__badge--ok';
    let label = recoveryText('db.health.drawer.status_healthy');
    let accent = 'var(--color-accent)';

    if (currentPhase === 'pending') {
      tone = 'db-health-drawer__badge--running';
      label = currentReport
        ? recoveryText('db.health.drawer.rechecking')
        : recoveryText('db.health.drawer.checking');
      accent = 'var(--color-accent)';
    } else if (currentPhase === 'error') {
      tone = 'db-health-drawer__badge--error';
      label = recoveryText('db.health.drawer.status_unavailable');
      accent = 'var(--color-danger)';
    } else if (currentReport?.status === 'error') {
      tone = 'db-health-drawer__badge--warn';
      label = recoveryText('db.health.drawer.status_attention');
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
    const message =
      currentError?.message ?? recoveryText('db.health.status.unavailable');
    errorAlert.textContent = `${message}${code}`;
    errorAlert.hidden = false;
  };

  const sync = () => {
    if (currentOpen !== modal.isOpen()) {
      modal.setOpen(currentOpen);
    }
    syncStatus();
    syncControls();
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
      if (next.onRecheck !== undefined)
        currentOnRecheck = next.onRecheck ?? null;
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
