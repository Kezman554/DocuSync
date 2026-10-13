import { useDocumentContext } from '../hooks/DocumentContext.jsx';
import ConfirmDialog from './ConfirmDialog.jsx';

/** Lists page numbers in the message only while the list stays short. */
const MAX_LISTED = 6;

function DeletePagesDialog() {
  const { pages, pendingDelete, confirmDelete, cancelDelete } =
    useDocumentContext();
  if (!pendingDelete) return null;

  const ids = new Set(pendingDelete);
  const positions = pages.flatMap((p, i) => (ids.has(p.id) ? [i + 1] : []));
  const count = positions.length;

  let title;
  if (count === 1) title = `Delete page ${positions[0]}?`;
  else if (count <= MAX_LISTED) title = `Delete ${count} pages (${positions.join(', ')})?`;
  else title = `Delete ${count} pages?`;

  return (
    <ConfirmDialog
      title={title}
      message="This removes them from the document you’re editing. Your original file isn’t changed."
      confirmLabel={count === 1 ? 'Delete page' : `Delete ${count} pages`}
      destructive
      onConfirm={confirmDelete}
      onCancel={cancelDelete}
    />
  );
}

export default DeletePagesDialog;
