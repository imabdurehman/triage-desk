import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Notice from '../../components/Notice.jsx';
import { errorMessage, fieldErrors } from '../../services/api.js';
import { createTicket, uploadImages } from '../../services/ticketService.js';
import { IMAGE_TYPES, imageProblem } from '../../utils/images.js';

export default function NewTicket() {
  const navigate = useNavigate();
  const [error, setError] = useState(null);
  const [imageError, setImageError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const images = form.getAll('images').filter((f) => f.size);
    if (imageProblem(images)) return;
    setBusy(true);
    setError(null);
    try {
      const ticket = await createTicket(form.get('subject'), form.get('body'));
      // The ticket exists even if the images fail; they can be added on its page.
      const imagesFailed = images.length
        ? await uploadImages(ticket._id, images).then(() => '', errorMessage)
        : '';
      navigate(`/tickets/${ticket._id}`, { state: { created: true, imagesFailed } });
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  const fields = fieldErrors(error);

  return (
    <div className="page page--narrow">
      <h1>New ticket</h1>
      <p className="muted">Say what happened in your own words. We work out what it is about and how
         urgent it is, so there is nothing to categorise.</p>
      <form className="form" onSubmit={submit} noValidate>
        <Notice>{error && !Object.keys(fields).length ? errorMessage(error) : ''}</Notice>
        <label className="field">Subject
          <input name="subject" maxLength={300} placeholder="For example: Charged twice this month" required />
          {fields.subject && <span className="field__error">{fields.subject}</span>}
        </label>
        <label className="field">What happened?
          <textarea name="body" rows={8} maxLength={20000} required />
          {fields.body && <span className="field__error">{fields.body}</span>}
        </label>
        <label className="field">Screenshots or photos (optional)
          <input name="images" type="file" accept={IMAGE_TYPES} multiple
                 onChange={(e) => setImageError(imageProblem([...e.target.files]))} />
          <span className={imageError ? 'field__error' : 'field__hint'}>
            {imageError || 'Up to 3 images, 2 MB each.'}
          </span>
        </label>
        <button className="btn" disabled={busy || Boolean(imageError)}>{busy ? 'Sending' : 'Send ticket'}</button>
      </form>
    </div>
  );
}
