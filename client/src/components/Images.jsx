import { useEffect, useState } from 'react';
import Notice from './Notice.jsx';
import { errorMessage } from '../services/api.js';
import { imageBlob, uploadImages } from '../services/ticketService.js';
import { IMAGE_TYPES, imageProblem } from '../utils/images.js';

// Images need the access token, so they are fetched as blobs rather than
// linked with a plain <img src>.
function Thumb({ ticketId, filename }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let url;
    let live = true;
    imageBlob(ticketId, filename).then((blob) => {
      url = URL.createObjectURL(blob);
      if (live) setSrc(url);
    });
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [ticketId, filename]);
  if (!src) return <span className="thumb" />;
  return <a href={src} target="_blank" rel="noreferrer"><img className="thumb" src={src} alt="Attached image" /></a>;
}

export default function Images({ ticket, onChange }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const canAdd = ticket.status !== 'closed';

  const add = async (event) => {
    const input = event.currentTarget;
    const files = [...input.files];
    const problem = imageProblem(files);
    setError(problem);
    if (problem || !files.length) return;
    setBusy(true);
    try {
      await uploadImages(ticket._id, files);
      await onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      input.value = '';
      setBusy(false);
    }
  };

  if (!ticket.attachments.length && !canAdd) return null;
  return (
    <section className="images" aria-label="Images">
      {ticket.attachments.map((a) => <Thumb key={a.filename} ticketId={ticket._id} filename={a.filename} />)}
      {canAdd && (
        <label className="btn btn--quiet images__add">
          {busy ? 'Uploading' : 'Add images'}
          <input type="file" accept={IMAGE_TYPES} multiple hidden disabled={busy} onChange={add} />
        </label>
      )}
      <Notice>{error}</Notice>
    </section>
  );
}
