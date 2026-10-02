export default function Pager({ page, pages, onPage }) {
  if (pages <= 1) return null;
  return (
    <nav className="pager" aria-label="Pages">
      <button type="button" className="btn btn--quiet" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </button>
      <span>Page {page} of {pages}</span>
      <button type="button" className="btn btn--quiet" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Next
      </button>
    </nav>
  );
}
