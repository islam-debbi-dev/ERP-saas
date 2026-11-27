import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as communes from '@erp/shared/communes';
import type { PlaceSelection, SectorSelection } from '@/lib/locations';
import ar from '@/messages/ar.json';
import fr from '@/messages/fr.json';
import { LocationPicker, SectorLocationPicker } from './location-picker';

const changed = vi.fn();
const t = fr.locations;

function Client({ start, oldText = '' }: { start: PlaceSelection; oldText?: string }) {
  const [place, setPlace] = useState<PlaceSelection | null>(null);
  return (
    <LocationPicker
      value={place ?? start}
      touched={place !== null}
      onChange={(next) => {
        changed(next);
        setPlace(next);
      }}
      onUndo={() => setPlace(null)}
      oldText={oldText}
    />
  );
}

function Sector() {
  const [place, setPlace] = useState<SectorSelection | null>(null);
  return (
    <SectorLocationPicker
      value={place ?? { wilayaCode: 16, communeCodes: [] }}
      touched={place !== null}
      onChange={(next) => {
        changed(next);
        setPlace(next);
      }}
      onUndo={() => setPlace(null)}
      oldText=""
      storedNames={new Map()}
    />
  );
}

function show(ui: React.ReactElement, locale: 'fr' | 'ar' = 'fr') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'ar' ? ar : fr}>
      <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

/** A closed field, found by its label (its name is "label value"). */
const field = (label: string) =>
  screen.getByRole<HTMLButtonElement>('button', {
    name: (name) => name.startsWith(`${label} `),
  });
const ready = (label: string) => waitFor(() => expect(field(label).disabled).toBe(false));
const open = (label: string) => {
  fireEvent.click(field(label));
  return screen.getByRole('dialog');
};
const search = (text: string) =>
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: text } });
const option = (dialog: HTMLElement, name: string) =>
  within(dialog).getByText(name, { exact: true }).closest('button')!;

const bousaada = communes.findCommune("M'Sila", 28)[0]!.commune;
const alger = communes.communesOf(16);

afterEach(() => {
  cleanup();
  changed.mockReset();
});

describe('LocationPicker', () => {
  it('picks a wilaya by search, then a commune without a daïra', async () => {
    show(<Client start={{ wilayaCode: null, communeCode: null }} />);
    expect(field(t.commune).disabled).toBe(true);
    let dialog = open(t.wilaya);
    search('msila');
    fireEvent.click(option(dialog, "28 · M'Sila"));
    expect(changed).toHaveBeenLastCalledWith({ wilayaCode: 28, communeCode: null });
    expect(screen.queryByRole('dialog')).toBeNull();

    await ready(t.commune);
    dialog = open(t.commune);
    search(bousaada.ar);
    fireEvent.click(option(dialog, bousaada.fr));
    expect(changed).toHaveBeenLastCalledWith({ wilayaCode: 28, communeCode: bousaada.code });
    // The daïra field now says where the commune is.
    expect(field(t.dairaOptional).textContent).toContain(
      communes.dairaByKey(bousaada.dairaKey)!.fr,
    );
  });

  it('empties the daïra and the commune when the wilaya changes', async () => {
    show(<Client start={{ wilayaCode: 28, communeCode: bousaada.code }} />);
    await ready(t.commune);
    const dialog = open(t.wilaya);
    search('16');
    fireEvent.click(option(dialog, '16 · Alger'));
    expect(changed).toHaveBeenLastCalledWith({ wilayaCode: 16, communeCode: null });
    expect(field(t.commune).textContent).toContain(t.chooseCommune);
    expect(field(t.dairaOptional).textContent).toContain(t.allDairas);
  });

  it('changes nothing when the same wilaya is picked again', () => {
    show(<Client start={{ wilayaCode: 28, communeCode: bousaada.code }} />);
    const dialog = open(t.wilaya);
    fireEvent.click(option(dialog, "28 · M'Sila"));
    expect(changed).not.toHaveBeenCalled();
  });

  it('empties a commune outside the chosen daïra', async () => {
    show(<Client start={{ wilayaCode: 28, communeCode: bousaada.code }} />);
    await ready(t.dairaOptional);
    const other = communes.dairasOf(28).find((d) => d.key !== bousaada.dairaKey)!;
    const dialog = open(t.dairaOptional);
    fireEvent.click(option(dialog, other.fr));
    expect(changed).toHaveBeenLastCalledWith({ wilayaCode: 28, communeCode: null });
  });

  it('cannot select a commune under review', async () => {
    show(<Client start={{ wilayaCode: 60, communeCode: null }} />);
    await ready(t.commune);
    const dialog = open(t.commune);
    const rows = within(dialog).getAllByText(t.underReview);
    expect(rows).toHaveLength(communes.communesOf(60).length);
    const first = rows[0]!.closest('button')!;
    expect(first.disabled).toBe(true);
    fireEvent.click(first);
    expect(changed).not.toHaveBeenCalled();
  });

  it('shows the old text, warns once cleared, and can undo', () => {
    show(<Client start={{ wilayaCode: null, communeCode: null }} oldText="bousaada centre" />);
    expect(screen.getByText('bousaada centre').parentElement!.textContent).toContain(
      'Ancien texte',
    );
    expect(screen.queryByRole('button', { name: t.clear })).toBeNull();
    const dialog = open(t.wilaya);
    fireEvent.click(option(dialog, "28 · M'Sila"));
    fireEvent.click(screen.getByRole('button', { name: t.clear }));
    expect(screen.getByText('bousaada centre').parentElement!.textContent).toContain('effacé');
    fireEvent.click(screen.getByRole('button', { name: t.undo }));
    expect(screen.queryByRole('button', { name: t.undo })).toBeNull();
  });

  it('shows Arabic names in Arabic', async () => {
    show(<Client start={{ wilayaCode: 28, communeCode: bousaada.code }} />, 'ar');
    await waitFor(() => expect(field(ar.locations.commune).textContent).toContain(bousaada.ar));
  });
});

describe('SectorLocationPicker', () => {
  it('collects several communes as chips that can be removed', async () => {
    show(<Sector />);
    await ready(t.communes);
    const dialog = open(t.communes);
    fireEvent.click(option(dialog, alger[0]!.fr));
    fireEvent.click(option(dialog, alger[1]!.fr));
    expect(changed).toHaveBeenLastCalledWith({
      wilayaCode: 16,
      communeCodes: [alger[0]!.code, alger[1]!.code],
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Terminé (2 choisis)' }));
    fireEvent.click(screen.getByRole('button', { name: t.remove.replace('{name}', alger[0]!.fr) }));
    expect(changed).toHaveBeenLastCalledWith({ wilayaCode: 16, communeCodes: [alger[1]!.code] });
  });
});
