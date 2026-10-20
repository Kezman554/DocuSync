import { screen, within } from '@testing-library/react';

/** Header menus: File ▾ and the Export PDF split button's ▾. */
export const FILE_MENU = 'File';
export const EXPORT_MENU = 'More export options';

/** Open a header menu and choose an item, as a mouse user would. */
export async function chooseFromMenu(user, menu, item) {
  await user.click(screen.getByRole('button', { name: menu }));
  const list = screen.getByRole('menu', { name: menu });
  await user.click(within(list).getByRole('menuitem', { name: item }));
}
