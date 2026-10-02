import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="page">
      <h1>This page does not exist</h1>
      <p><Link to="/">Go to your tickets</Link></p>
    </div>
  );
}
