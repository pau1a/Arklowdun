import createButton from '@ui/Button';
import createInput, { type InputElement } from '@ui/Input';
import createModal, { type ModalInstance } from '@ui/Modal';

export interface FilesToolbarProps {
  onSelectDirectory: () => void | Promise<void>;
  onCreateFile: (name: string) => void | Promise<void>;
  onCreateFolder: (name: string) => void | Promise<void>;
}

export interface FilesToolbarInstance {
  element: HTMLDivElement;
  setDirectoryAvailable: (available: boolean) => void;
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
  field.append(labelEl, input);
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
  });

  actions.append(cancelButton, submitButton);
  form.appendChild(actions);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const value = input.value.trim();
    if (!value) {
      input.update({ invalid: true });
      input.focus();
      return;
    }
    try {
      await onSubmit(value);
      input.update({ invalid: false });
    } catch {
      input.focus();
    }
  });

  input.addEventListener('input', () => {
    input.update({ invalid: false });
  });

  dialog.append(heading, helper, form);
}

export function createFilesToolbar(props: FilesToolbarProps): FilesToolbarInstance {
  const container = document.createElement('div');
  container.className = 'files__actions';
  container.dataset.ui = 'files-toolbar';

  const selectButton = createButton({
    label: 'Select Directory',
    variant: 'ghost',
    onClick: () => {
      void props.onSelectDirectory();
    },
  });

  const newFolderButton = createButton({
    label: 'New Folder',
    variant: 'ghost',
  });

  const newFileButton = createButton({
    label: 'New File',
    variant: 'ghost',
  });

  container.append(selectButton, newFolderButton, newFileButton);

  let canCreate = true;

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

  const closeFileModal = () => {
    if (!fileModal.isOpen()) return;
    fileModal.setOpen(false);
    fileInput.value = '';
  };

  const closeFolderModal = () => {
    if (!folderModal.isOpen()) return;
    folderModal.setOpen(false);
    folderInput.value = '';
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
  };

  const openFolderModal = () => {
    if (!canCreate) return;
    folderModal.setOpen(true);
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
    openCreateFile: openFileModal,
    openCreateFolder: openFolderModal,
  };
}

export default createFilesToolbar;
