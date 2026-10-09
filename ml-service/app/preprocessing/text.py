"""Text cleaning shared by training and prediction.

Both sides MUST use these exact functions. If training cleans text one way and
the live /predict endpoint cleans it another, the model sees inputs it was never
trained on and quietly gets worse. Keeping it in one module prevents that.
"""
import re

_URL = re.compile(r"https?://\S+|www\.\S+", re.IGNORECASE)
_EMAIL = re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b")
_NUMBER = re.compile(r"\b\d[\d,.\-/]*\b")
_NON_TEXT = re.compile(r"[^a-z0-9<>\s']")
_SPACES = re.compile(r"\s+")


def clean(text: str) -> str:
    """Lowercase, replace volatile tokens with placeholders, strip punctuation.

    URLs, emails and numbers (order ids, amounts, dates) change from ticket to
    ticket but carry no category signal on their own, so each is replaced with a
    fixed token. "Charged twice for order 88213" and "for order 90177" then look
    identical to the model, which is what we want.
    """
    t = (text or "").lower()
    t = _URL.sub(" <url> ", t)
    t = _EMAIL.sub(" <email> ", t)
    t = _NUMBER.sub(" <num> ", t)
    t = _NON_TEXT.sub(" ", t)
    return _SPACES.sub(" ", t).strip()


def combine(subject: str, body: str) -> str:
    """Build the single string the model reads.

    The subject is included twice: it is short and dense with signal ("Refund
    not received"), while the body is long and noisy, so repeating the subject
    doubles its weight in the TF-IDF features without any extra model code.
    """
    s = clean(subject)
    return f"{s} {s} {clean(body)}".strip()


def combine_rows(frame) -> list[str]:
    """combine() for every row of a table with "subject" and "body" columns."""
    return [combine(s, b) for s, b in zip(frame["subject"], frame["body"], strict=True)]
