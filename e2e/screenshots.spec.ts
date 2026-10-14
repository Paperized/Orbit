import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

type GalleryState = {
  files: Record<string, { base64: string; modifiedMs: number }>;
  saves: number; calls: number; failSave: boolean; capturePending: boolean; intent?: string;
};
declare global { interface Window { galleryTest: GalleryState } }

test.beforeEach(async ({ page }) => {
  await page.route('**/screenshots-test/**', async route => {
    const name = new URL(route.request().url()).pathname.split('/').pop() || 'index.html';
    const folder = ['ui.js', 'common.css'].includes(name) ? 'shared' : 'capture';
    await route.fulfill({
      body: await readFile(`apps/${folder}/${name}`),
      contentType: name.endsWith('.js') ? 'application/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html',
    });
  });
  await page.route('**/orbit-sdk.js', route => route.fulfill({ body: '', contentType: 'application/javascript' }));
  await page.addInitScript(() => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
    const state: GalleryState = {
      files: {
        'screenshots/z-old.png': { base64: png, modifiedMs: 1700000000000 },
        'screenshots/a-new.png': { base64: png, modifiedMs: 1710000000000 },
      },
      saves: 0, calls: 0, failSave: false, capturePending: false,
    };
    let serial = 0;
    const references = new Map<string, { dataUrl: string; width: number; height: number }>();
    Object.assign(window, {
      galleryTest: state,
      Orbit: {
        window: { drag: async () => {}, close: async () => {}, hide: async () => {}, resize: async () => {} },
        preferences: { read: async () => ({ 'auto-capture': false }) },
        actions: { register: async () => false },
        services: {
          register: async () => false,
          list: async () => [{ appName: 'Chat', appId: 'orbit-chat', feature: { title: 'Chiedi', id: 'receive', description: 'Invia in chat' } }],
          call: async (options: { intent?: string }) => { state.calls++; state.intent = options.intent; return { accepted: true }; },
        },
        capture: {
          select: async () => {
            state.capturePending = true;
            await new Promise(resolve => setTimeout(resolve, 50));
            state.capturePending = false;
            return { dataUrl: `data:image/png;base64,${png}`, width: 1, height: 1 };
          },
          cancel: async () => {},
        },
        attachments: {
          create: async (value: { dataUrl: string; width: number; height: number }) => {
            const id = String(++serial); references.set(id, value); return { id };
          },
          release: async (ref: { id: string }) => { references.delete(ref.id); },
          save: async (ref: { id: string }) => {
            if (state.failSave) throw new Error('Quota file superata');
            const value = references.get(ref.id);
            if (!value) throw new Error('Allegato non disponibile');
            const path = `screenshots/capture-${++state.saves}.png`;
            state.files[path] = { base64: value.dataUrl.split(',')[1], modifiedMs: Date.now() };
            return { saved: true, path };
          },
        },
        files: {
          list: async (path = '') => path === '' ? [{ name: 'screenshots', directory: true, bytes: 0, modifiedMs: 0 }]
            : Object.entries(state.files).map(([name, value]) => ({ name: name.split('/')[1], directory: false, bytes: 70, modifiedMs: value.modifiedMs })),
          read: async (path: string) => {
            if (!state.files[path]) throw new Error('File non trovato');
            return { base64: state.files[path].base64 };
          },
          remove: async (path: string) => { delete state.files[path]; },
        },
      },
    });
  });
  await page.goto('/screenshots-test/index.html');
  await expect(page.getByRole('button', { name: 'Nuovo screenshot', exact: true })).toBeEnabled();
});

test('gallery sorts actual files newest first, captures automatically and sends selected image', async ({ page }) => {
  const cards = page.locator('.screenshot-card');
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toHaveAttribute('data-path', 'screenshots/a-new.png');
  await cards.first().click();
  await expect(page.getByAltText('Area selezionata')).toBeVisible();
  await page.getByRole('button', { name: 'Nuovo screenshot', exact: true }).click();
  await expect(cards).toHaveCount(3);
  await expect(cards.first()).toHaveAttribute('data-path', 'screenshots/capture-1.png');
  await expect(cards.first()).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('status')).toHaveText('Screenshot salvato automaticamente.');
  expect(await page.evaluate(() => window.galleryTest.saves)).toBe(1);
  await page.getByRole('button', { name: 'Invia a...' }).click();
  await page.getByRole('button', { name: /Chat · Chiedi/ }).click();
  await expect(page.getByRole('status')).toHaveText('Immagine inviata a Chat.');
  expect(await page.evaluate(() => window.galleryTest.calls)).toBe(1);
  expect(await page.evaluate(() => window.galleryTest.intent)).toBe('interactive');
});

test('delete requires confirmation and refresh reflects external changes', async ({ page }) => {
  const cards = page.locator('.screenshot-card');
  await cards.first().click();
  await page.getByRole('button', { name: 'Elimina', exact: true }).click();
  await page.getByRole('button', { name: 'Annulla', exact: true }).click();
  expect(await page.evaluate(() => Object.keys(window.galleryTest.files).length)).toBe(2);
  await page.getByRole('button', { name: 'Elimina', exact: true }).click();
  await page.getByRole('button', { name: 'Elimina definitivamente' }).click();
  await expect(cards).toHaveCount(1);
  await cards.first().click();
  await page.evaluate(() => { window.galleryTest.files = {}; });
  await page.getByRole('button', { name: 'Aggiorna galleria' }).click();
  await expect(cards).toHaveCount(0);
  await expect(page.getByAltText('Area selezionata')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Invia a...' })).toBeDisabled();
  await expect(page.locator('#empty')).toBeVisible();
});

test('pagination bounds thumbnails and supports narrow windows', async ({ page }) => {
  await page.evaluate(() => {
    const sample = Object.values(window.galleryTest.files)[0];
    window.galleryTest.files = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`screenshots/${i}.png`, { ...sample, modifiedMs: 1700000000000 + i * 1000 }]));
  });
  await page.getByRole('button', { name: 'Aggiorna galleria' }).click();
  await expect(page.locator('.screenshot-card')).toHaveCount(24);
  await page.getByRole('button', { name: 'Pagina successiva' }).click();
  await expect(page.locator('.screenshot-card')).toHaveCount(6);
  await expect(page.getByRole('button', { name: 'Pagina successiva' })).toBeDisabled();
  await expect(page.locator('.screenshot-card').first()).toHaveAttribute('data-path', 'screenshots/5.png');
  await page.setViewportSize({ width: 440, height: 520 });
  await page.getByRole('button', { name: 'Pagina precedente' }).click();
  await page.locator('.screenshot-card').first().click();
  await page.getByRole('button', { name: 'Invia a...' }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Invia a...' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('save failures are explicit, do not add files and reenable actions', async ({ page }) => {
  await page.evaluate(() => { window.galleryTest.failSave = true; });
  await page.getByRole('button', { name: 'Nuovo screenshot', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Quota file superata');
  await expect(page.locator('.screenshot-card')).toHaveCount(2);
  await expect(page.getByRole('status')).not.toContainText('salvato');
  await expect(page.getByRole('button', { name: 'Nuovo screenshot', exact: true })).toBeEnabled();
});
