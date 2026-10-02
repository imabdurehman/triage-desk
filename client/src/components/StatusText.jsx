import { label } from '../utils/format.js';

export default function StatusText({ status }) {
  return <span className={`status status--${status}`}>{label(status)}</span>;
}
