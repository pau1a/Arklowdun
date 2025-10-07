import createButton from '@ui/Button';
import createInput, { type InputElement } from '@ui/Input';
import createModal, { type ModalInstance } from '@ui/Modal';
import { validateFilename } from '@features/files/validation';

export interface FilesToolbarProps {
  onSelectDirectory: () => void | Promise<void>;
  onCreateFile: (name: string) => void | Promise<void>;
  onCreateFolder: (name: string) => void | Promise<void>;
}

export interface FilesToolbarInstance {
  element: HTMLDivElement;
  setDirectoryAvailable: (available: boolean) => void;
  setDirectoryContext: (path: string | null) => void;
  openCreateFile: () => void;
  openCreateFolder: () => void;
}

interface ModalFormOptions {
  modal: ModalInstance;
  titleId: string;
  title: string;
  description: string;
  label: string;
  input: InputElement;
  submitLabel: string;
  onSubmit: (value: string) => Promise<void> | void;
  onCancel: () => void;
}

function buildModalForm(options: ModalFormOptions): void {
  const { modal, titleId, title, description, label, input, submitLabel, onSubmit, onCancel } =
    options;
  const dialog = modal.dialog;
  dialog.innerHTML = '';

  const heading = document.createElement('h2');
  heading.id = titleId;
  heading.textContent = title;

  const helper = document.createElement('p');
  helper.className = 'files__modal-helper';
  helper.textContent = description;

  const form = document.createElement('form');
  form.className = 'files__modal-form';

  const field = document.createElement('div');
  field.className = 'files__field';
  const labelEl = document.createElement('label');
  labelEl.textContent = label;
  if (!input.id) {
    input.id = `${titleId}-input`;
  }
  labelEl.htmlFor = input.id;
  const errorMessage = document.createElement('p');
  errorMessage.className = 'files__validation-error';
  errorMessage.id = `${titleId}-error`;
  errorMessage.hidden = true;
  input.setAttribute('aria-describedby', errorMessage.id);
  field.append(labelEl, input, errorMessage);
  form.appendChild(field);

  const actions = document.createElement('div');
  actions.className = 'files__modal-actions';

  const cancelButton = createButton({
    label: 'Cancel',
    variant: 'ghost',
    type: 'button',
    onClick: (event) => {
      event.preventDefault();
      onCancel();
    },
  });

  const submitButton = createButton({
    label: submitLabel,
    variant: 'primary',
    type: 'submit',
    disabled: true,
  });

  actions.append(cancelButton, submitButton);
  form.appendChild(actions);

  let parentPath: string | null = null;

  const setParentPath = (value: string | null) => {
    parentPath = value;
  };

  const setError = (message: string | null) => {
    if (message) {
      errorMessage.textContent = message;
      errorMessage.hidden = false;
    } else {
      errorMessage.textContent = '';
      errorMessage.hidden = true;
    }
  };

  const setInvalid = (invalid: boolean) => {
    input.update({ invalid });
    submitButton.update({ disabled: invalid });
  };

  const evaluate = (opts: { force?: boolean } = {}): boolean => {
    const rawValue = input.value;
    if (!rawValue) {
      setError(opts.force ? 'Enter a name before continuing.' : null);
      setInvalid(true);
      return false;
    }
    const result = validateFilename(rawValue, { parent: parentPath ?? null });
    if (!result.ok) {
      setError(result.error.message);
      setInvalid(true);
      return false;
    }
    setError(null);
    setInvalid(false);
    if (rawValue !== result.normalized) {
      input.value = result.normalized;
    }
    return true;
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!evaluate({ force: true })) {
      input.focus();
      return;
    }
    try {
      await onSubmit(input.value);
      input.update({ invalid: false });
    } catch {
      input.focus();
    }
  });

  input.addEventListener('input', () => {
    evaluate({ force: true });
  });

  submitButton.update({ disabled: true });

  (form as any).__setParentPath = setParentPath;
  (form as any).__resetValidation = () => {
    setError(null);
    setInvalid(true);
  };

  dialog.append(heading, helper, form);
}

export function createFilesToolbar(props: FilesToolbarProps): FilesToolbarInstance {
  const container = document.createElement('div');
  container.className = 'files__actions';
  container.dataset.ui = 'files-toolbar';

  const selectButton = createButton({
    label: 'Select Directory',
    variant: 'ghost',
    className: 'grow-xs',
    onClick: () => {
      void props.onSelectDirectory();
    },
  });

  const newFolderButton = createButton({
    label: 'New Folder',
    variant: 'ghost',
    className: 'grow-xs',
  });

  const newFileButton = createButton({
    label: 'New File',
    variant: 'ghost',
    className: 'grow-xs',
  });

  container.append(selectButton, newFolderButton, newFileButton);

  let canCreate = true;
  let currentPath: string | null = null;

  const fileInput = createInput({
    type: 'text',
    placeholder: 'New file name',
    ariaLabel: 'New file name',
    autoFocus: true,
    required: true,
  });

  const folderInput = createInput({
    type: 'text',
    placeholder: 'New folder name',
    ariaLabel: 'New folder name',
    autoFocus: true,
    required: true,
  });

  const fileModal = createModal({
    open: false,
    titleId: 'files-new-file-title',
    initialFocus: () => fileInput,
    onOpenChange(open) {
      if (!open) closeFileModal();
    },
  });

  const folderModal = createModal({
    open: false,
    titleId: 'files-new-folder-title',
    initialFocus: () => folderInput,
    onOpenChange(open) {
      if (!open) closeFolderModal();
    },
  });

  const resetFormState = (form: HTMLFormElement) => {
    (form as any).__resetValidation?.();
  };

  const applyParentPath = (form: HTMLFormElement) => {
    (form as any).__setParentPath?.(currentPath);
  };

  const closeFileModal = () => {
    if (!fileModal.isOpen()) return;
    fileModal.setOpen(false);
    fileInput.value = '';
    resetFormState(fileModal.dialog.querySelector('form')!);
  };

  const closeFolderModal = () => {
    if (!folderModal.isOpen()) return;
    folderModal.setOpen(false);
    folderInput.value = '';
    resetFormState(folderModal.dialog.querySelector('form')!);
  };

  buildModalForm({
    modal: fileModal,
    titleId: 'files-new-file-title',
    title: 'New File',
    description: 'Enter a name for the new file.',
    label: 'File name',
    input: fileInput,
    submitLabel: 'Create File',
    onSubmit: async (value) => {
      await props.onCreateFile(value);
      closeFileModal();
    },
    onCancel: closeFileModal,
  });

  buildModalForm({
    modal: folderModal,
    titleId: 'files-new-folder-title',
    title: 'New Folder',
    description: 'Enter a name for the new folder.',
    label: 'Folder name',
    input: folderInput,
    submitLabel: 'Create Folder',
    onSubmit: async (value) => {
      await props.onCreateFolder(value);
      closeFolderModal();
    },
    onCancel: closeFolderModal,
  });

  const openFileModal = () => {
    if (!canCreate) return;
    fileModal.setOpen(true);
    applyParentPath(fileModal.dialog.querySelector('form')!);
  };

  const openFolderModal = () => {
    if (!canCreate) return;
    folderModal.setOpen(true);
    applyParentPath(folderModal.dialog.querySelector('form')!);
  };

  newFileButton.addEventListener('click', (event) => {
    event.preventDefault();
    openFileModal();
  });

  newFolderButton.addEventListener('click', (event) => {
    event.preventDefault();
    openFolderModal();
  });

  return {
    element: container,
    setDirectoryAvailable(available: boolean) {
      canCreate = available;
      newFileButton.disabled = !available;
      newFolderButton.disabled = !available;
    },
    setDirectoryContext(path: string | null) {
      currentPath = path;
      applyParentPath(fileModal.dialog.querySelector('form')!);
      applyParentPath(folderModal.dialog.querySelector('form')!);
    },
    openCreateFile: openFileModal,
    openCreateFolder: openFolderModal,
  };
}

export default createFilesToolbar;
