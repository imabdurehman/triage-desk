import { label } from '../utils/format.js';

// Shaped like a paper triage tag: the one place priority colour is used as a fill.
export default function PriorityTag({ priority }) {
  return <span className={`tag tag--${priority}`}>{label(priority)}</span>;
}
