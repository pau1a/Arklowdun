import { beforeEach, describe, expect, test, vi } from 'vitest';

const reminderSchedulerMock = {
  init: vi.fn(),
  cancelAll: vi.fn(),
  scheduleMany: vi.fn(),
  rescheduleForPet: vi.fn(),
};

vi.mock('@features/pets/reminderScheduler', () => ({ reminderScheduler: reminderSchedulerMock }));

const getHouseholdIdForCalls = vi.fn(async () => 'hh');
vi.mock('../../src/db/household', () => ({ getHouseholdIdForCalls }));

const pageInstances: any[] = [];
vi.mock('@features/pets/PetsPage', () => {
  const createFilterModels = (pets: any[]) => pets.map((pet) => ({ pet }));
  const createPetsPage = vi.fn((container: HTMLElement) => {
    const listViewport = document.createElement('div');
    listViewport.className = 'pets__viewport';
    const instance: any = {
      element: container,
      listViewport,
      __callbacks: {},
      setCallbacks(cb: any) {
        instance.__callbacks = { ...instance.__callbacks, ...cb };
      },
      setPets: vi.fn(),
      setFilter: vi.fn(),
      patchPet: vi.fn(),
      focusCreate: vi.fn(),
      focusSearch: vi.fn(),
      submitCreateForm: vi.fn(() => false),
      focusRow: vi.fn(),
      showDetail: vi.fn(),
      showList: vi.fn(),
      getScrollOffset: vi.fn(() => 0),
      setScrollOffset: vi.fn(),
      destroy: vi.fn(),
    };
    pageInstances.push(instance);
    return instance;
  });
  return { createPetsPage, createFilterModels, __instances: pageInstances };
});

const petsUpdateImage = vi.fn();
const listMock = vi.fn();
vi.mock('../../src/repos', () => ({
  petsRepo: {
    list: listMock,
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    restore: vi.fn(),
  },
  petsUpdateImage,
}));

const openDialog = vi.fn();
vi.mock('@lib/ipc/dialog', () => ({ open: openDialog }));

const sanitizeRelativePath = vi.fn((value: string) => value.trim());
const canonicalizeAndVerify = vi.fn(async (value: string) => ({ base: '/attachments/', realPath: value }));
class PathValidationErrorMock extends Error {
  code: string;
  constructor(code: string, message = '') {
    super(message);
    this.code = code;
    this.name = 'PathValidationError';
  }
}
vi.mock('../../src/files/path', () => ({
  sanitizeRelativePath,
  canonicalizeAndVerify,
  PathValidationError: PathValidationErrorMock,
}));

const readFile = vi.fn(async () => new Uint8Array([1, 2, 3]));
vi.mock('@tauri-apps/plugin-fs', () => ({ readFile }));

const mkdir = vi.fn(async () => {});
const writeBinary = vi.fn(async () => {});
vi.mock('../../src/files/safe-fs', () => ({
  mkdir,
  writeBinary,
}));

const presentFsError = vi.fn();
vi.mock('@lib/ipc', () => ({ presentFsError }));

vi.mock('@lib/uiLog', () => ({ logUI: vi.fn() }));
vi.mock('@lib/obs/timeIt', () => ({ timeIt: async <T>(_, fn: () => Promise<T> | T) => await fn() }));
vi.mock('@features/pets/mutationTelemetry', () => ({ recordPetsMutationFailure: vi.fn(async (_, err) => err) }));

const samplePets = [
  {
    id: 'pet-1',
    name: 'Riley',
    type: 'Dog',
    household_id: 'hh',
    position: 0,
    created_at: Date.now(),
    updated_at: Date.now(),
    image_path: null,
  },
];

beforeEach(() => {
  listMock.mockResolvedValue(samplePets);
  petsUpdateImage.mockReset();
  openDialog.mockReset();
  sanitizeRelativePath.mockReset();
  sanitizeRelativePath.mockImplementation((value: string) => value.trim());
  canonicalizeAndVerify.mockReset();
  presentFsError.mockClear();
  readFile.mockReset();
  readFile.mockImplementation(async () => new Uint8Array([1, 2, 3]));
  mkdir.mockReset();
  writeBinary.mockReset();
  pageInstances.splice(0, pageInstances.length);
});

async function mountView(container: HTMLElement) {
  const { PetsView } = await import('../../src/PetsView');
  await PetsView(container);
  const petsPageModule: any = await import('@features/pets/PetsPage');
  const [instance] = petsPageModule.__instances;
  return instance;
}

describe('PetsView change photo flow', () => {
  test('happy path updates repository and patches card', async () => {
    openDialog.mockResolvedValue('/Users/tester/Pictures/Portrait.JPG');
    const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(1234567890);

    const container = document.createElement('div');
    document.body.appendChild(container);

    const page = await mountView(container);
    expect(page).toBeDefined();

    sanitizeRelativePath.mockImplementation((value: string) => value);

    page.__callbacks.onChangePhoto(samplePets[0]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(openDialog).toHaveBeenCalled();
    expect(readFile).toHaveBeenCalledWith('/Users/tester/Pictures/Portrait.JPG');
    expect(mkdir).toHaveBeenCalledWith('hh/pet_image', 'attachments', { recursive: true });
    expect(writeBinary).toHaveBeenCalledWith(
      'hh/pet_image/pet-pet-1-1234567890.jpg',
      'attachments',
      expect.any(Uint8Array),
    );
    expect(sanitizeRelativePath).toHaveBeenCalledWith('pet-pet-1-1234567890.jpg');
    expect(petsUpdateImage).toHaveBeenCalledWith('hh', 'pet-1', 'pet-pet-1-1234567890.jpg');
    expect(page.patchPet).toHaveBeenCalled();
    expect(presentFsError).not.toHaveBeenCalled();

    dateSpy.mockRestore();
    container.remove();
  });

  test('guard rejection surfaces toast', async () => {
    openDialog.mockResolvedValue('/tmp/image.png');
    sanitizeRelativePath.mockImplementation(() => {
      throw new PathValidationErrorMock('FILENAME_INVALID', 'invalid');
    });

    const container = document.createElement('div');
    document.body.appendChild(container);

    const page = await mountView(container);
    page.__callbacks.onChangePhoto(samplePets[0]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(petsUpdateImage).not.toHaveBeenCalled();
    expect(presentFsError).toHaveBeenCalled();

    container.remove();
  });
});
