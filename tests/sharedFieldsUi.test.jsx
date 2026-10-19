import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extraPdfs, makeFakePdf, setupDom, thumb } from './helpers/fakePdf.jsx';

vi.mock('../src/lib/pdfLoader.js', async () => {
  const { pdfFor } = await import('./helpers/fakePdf.jsx');
  return { loadPdfDocument: vi.fn(async (file) => pdfFor(file)), loadPdfData: vi.fn() };
});

const { default: App } = await import('../src/App.jsx');

// 4 pages; field "name" has widgets on pages 1 and 2, "notes" only on page 4.
extraPdfs['form.pdf'] = Object.assign(makeFakePdf('form.pdf', 4), {
  getFieldObjects: async () => ({
    name: [{ page: -1 }, { page: 0 }, { page: 1 }],
    notes: [{ page: 3 }],
  }),
});

const DELETE_NOTE =
  'A form field on these pages also appears on pages you’re keeping, so exports will leave it out of those too.';
const EXTRACT_NOTE =
  'A form field on the chosen pages also appears on pages left out, so it won’t be included.';

async function openForm(user) {
  const utils = render(<App />);
  await user.upload(
    utils.container.querySelector('input[type="file"]'),
    new File(['%PDF-1.7'], 'form.pdf', { type: 'application/pdf' })
  );
  await screen.findByText('Page 1 of 4');
}

describe('fields shared with a page that’s left out', () => {
  beforeEach(setupDom);
  afterEach(() => vi.restoreAllMocks());

  it('Delete pages says so only when the field is also on a kept page', async () => {
    const user = userEvent.setup();
    await openForm(user);

    await user.click(thumb(2));
    await user.keyboard('{Delete}');
    expect(screen.getByRole('alertdialog')).toHaveTextContent(DELETE_NOTE);
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));

    await user.click(thumb(4)); // "notes" is only on page 4: nothing else loses it
    await user.keyboard('{Delete}');
    expect(screen.getByRole('alertdialog')).not.toHaveTextContent(DELETE_NOTE);
  });

  it('Extract pages says so only when the field is split by the choice', async () => {
    const user = userEvent.setup();
    await openForm(user);
    await user.click(screen.getByRole('button', { name: 'Extract pages…' }));
    const dialog = screen.getByRole('dialog', { name: 'Extract pages' });
    const input = within(dialog).getByLabelText(/^Pages/);

    await user.clear(input);
    await user.type(input, '1, 3');
    expect(dialog).toHaveTextContent(EXTRACT_NOTE);
    await user.clear(input);
    await user.type(input, '1-2');
    expect(dialog).not.toHaveTextContent(EXTRACT_NOTE);
    await user.clear(input);
    await user.type(input, '3-4');
    expect(dialog).not.toHaveTextContent(EXTRACT_NOTE);
  });
});
