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
      clearSearch: vi.fn(),
      getSearchValue: vi.fn(() => ''),
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
vi.mock('../../src/files/path', () => ({ sanitizeRelativePath, canonicalizeAndVerify }));

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
  sanitizeRelativePath.mockClear();
  canonicalizeAndVerify.mockClear();
  presentFsError.mockClear();
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
    openDialog.mockResolvedValue('/attachments/hh/pet_image/new.png');

    const container = document.createElement('div');
    document.body.appendChild(container);

    const page = await mountView(container);
    expect(page).toBeDefined();

    canonicalizeAndVerify.mockResolvedValue({ base: '/attachments/', realPath: '/attachments/hh/pet_image/new.png' });
    sanitizeRelativePath.mockImplementation((value: string) => value.replace(/^.*pet_image\//, ''));

    page.__callbacks.onChangePhoto(samplePets[0]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(openDialog).toHaveBeenCalled();
    expect(canonicalizeAndVerify).toHaveBeenCalledWith('/attachments/hh/pet_image/new.png', 'attachments');
    expect(sanitizeRelativePath).toHaveBeenCalledWith('new.png');
    expect(petsUpdateImage).toHaveBeenCalledWith('hh', 'pet-1', 'new.png');
    expect(page.patchPet).toHaveBeenCalled();
    expect(presentFsError).not.toHaveBeenCalled();

    container.remove();
  });

  test('guard rejection surfaces toast', async () => {
    openDialog.mockResolvedValue('/attachments/hh/pet_image/invalid.png');
    sanitizeRelativePath.mockImplementation(() => {
      const error: any = new Error('invalid');
      error.code = 'PATH_OUT_OF_VAULT';
      throw error;
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
