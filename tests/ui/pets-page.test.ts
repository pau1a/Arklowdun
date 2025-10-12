import { describe, expect, test } from 'vitest';
import { createPetsPage, createFilterModels } from '@features/pets/PetsPage';

function makePet(id: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    name: `Pet ${id}`,
    type: 'Dog',
    household_id: 'hh',
    position: Number(id.replace(/[^0-9]/g, '')) || 0,
    created_at: Date.now(),
    updated_at: Date.now(),
    image_path: null,
    ...overrides,
  } as any;
}

async function flushAnimationFrames(times = 1) {
  for (let i = 0; i < times; i += 1) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
}

describe('PetsPage grid rendering', () => {
  test('snapshot without images', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const page = createPetsPage(container);
    page.listViewport.style.height = '480px';
    page.listViewport.style.width = '720px';

    const pets = [makePet('1'), makePet('2'), makePet('3')];

    page.setPets(pets as any);
    page.setFilter(createFilterModels(pets as any, ''));

    await flushAnimationFrames(2);

    const grid = container.querySelector('.pets__grid');
    expect(grid?.innerHTML).toMatchSnapshot('pets-grid-without-images');

    page.destroy();
    container.remove();
  });

  test('snapshot with images metadata', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const page = createPetsPage(container);
    page.listViewport.style.height = '480px';
    page.listViewport.style.width = '720px';

    const pets = [
      makePet('1', { image_path: 'buddy.png' }),
      makePet('2', { image_path: 'kit.png' }),
      makePet('3'),
    ];

    page.setPets(pets as any);
    page.setFilter(createFilterModels(pets as any, ''));

    await flushAnimationFrames(2);

    const grid = container.querySelector('.pets__grid');
    expect(grid?.innerHTML).toMatchSnapshot('pets-grid-with-images');

    page.destroy();
    container.remove();
  });

  test('patchPet updates card without remount', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const page = createPetsPage(container);
    page.listViewport.style.height = '320px';
    page.listViewport.style.width = '640px';

    const pets = [makePet('1'), makePet('2')];
    page.setPets(pets as any);
    page.setFilter(createFilterModels(pets as any, ''));

    await flushAnimationFrames(2);

    const cards = Array.from(container.querySelectorAll<HTMLDivElement>('.pets__card'));
    expect(cards.length).toBeGreaterThan(0);
    const firstCard = cards[0];

    page.patchPet({ ...pets[0], image_path: 'updated.png' } as any);
    await flushAnimationFrames(1);

    const nextCards = Array.from(container.querySelectorAll<HTMLDivElement>('.pets__card'));
    expect(nextCards[0]).toBe(firstCard);

    page.destroy();
    container.remove();
  });
});
