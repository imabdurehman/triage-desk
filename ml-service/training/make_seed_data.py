"""Generate a SEED dataset so the pipeline can run before real data exists.

This data is synthetic. It exists so that training, evaluation and the API can
be built and tested on day one. Metrics measured on it say nothing about how the
model will behave on real tickets: replace it with real data (see import_csv.py)
before reporting any number.

The generator deliberately makes the task imperfect: urgency cues appear only
some of the time, vocabulary overlaps between categories, and a small share of
labels is flipped. A seed set that is 100% separable would hide pipeline bugs
behind perfect scores.

    python -m training.make_seed_data            # 1500 rows
    python -m training.make_seed_data --rows 3000

Every row is tagged source="seed". That tag is what lets real data be merged in
safely later: seed rows never enter the frozen test set, and they drop out of
training for any class that has enough real examples.
"""
import argparse
import json
import random
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from app.contract import CATEGORIES, PRIORITIES
from training import config

SLOTS = {
    "product": ["the Pro plan", "the mobile app", "the dashboard", "the API", "my account",
                "the Android app", "the iOS app", "the web portal", "the Business plan",
                "the desktop app", "our team workspace", "the starter plan"],
    "amount": ["Rs 2,499", "Rs 4,999", "$19", "$49", "Rs 12,000", "$120", "Rs 899",
               "$9.99", "Rs 7,500", "$240", "Rs 1,250", "$75"],
    "feature": ["exports", "notifications", "the search", "file uploads", "reports",
                "two-factor login", "the calendar sync", "invoices", "the chat widget",
                "bulk import", "the analytics page", "PDF downloads", "user roles"],
    "device": ["my iPhone", "my laptop", "Chrome", "Safari", "my Samsung phone", "Firefox",
               "Edge", "my iPad", "a Windows PC", "my MacBook"],
    "order": ["order 48213", "order #90177", "invoice 3312", "order 77120", "order 55019",
              "invoice 8841", "order #31275", "transaction 66402"],
}

TEMPLATES = {
    "billing": {
        "subjects": ["Charged twice this month", "Wrong amount on my invoice",
                     "Payment failed but money deducted", "Question about my bill",
                     "Card charged after cancelling", "Invoice does not match plan"],
        "bodies": ["I was charged {amount} twice for {product}. Please check {order}.",
                   "My invoice shows {amount} but my plan should cost less.",
                   "The payment failed on the screen but {amount} left my account.",
                   "Can you explain the extra charge of {amount} on {order}?",
                   "I cancelled {product} but was still billed {amount} this month."],
    },
    "technical": {
        "subjects": ["App keeps crashing", "Cannot upload files", "Page not loading",
                     "Error when exporting", "Login page shows an error", "Sync not working"],
        "bodies": ["{product} crashes every time I open {feature} on {device}.",
                   "I get an error message when I try to use {feature}.",
                   "{feature} has stopped working since the last update on {device}.",
                   "The page stays blank on {device} when I open {product}.",
                   "Whenever I use {feature} the app freezes and I have to restart it."],
    },
    "account": {
        "subjects": ["Cannot reset my password", "Change the email on my account",
                     "Locked out of my account", "Delete my account", "Update my profile name",
                     "Two-factor code not arriving"],
        "bodies": ["I cannot log in to {product} and the reset email never arrives.",
                   "Please change the email address linked to my account.",
                   "My account got locked after a few login attempts on {device}.",
                   "I want to close my account and remove my data.",
                   "The verification code for two-factor login is not reaching me."],
    },
    "refund": {
        "subjects": ["Refund request", "Want my money back", "Refund not received",
                     "Requesting a refund for {order}", "Cancel and refund please",
                     "Where is my refund"],
        "bodies": ["I would like a refund of {amount} for {order}, it did not work for me.",
                   "You promised a refund for {order} two weeks ago and it has not arrived.",
                   "Please refund {amount}, I was not satisfied with {product}.",
                   "I cancelled within the trial period and expect a full refund of {amount}.",
                   "The refund for {order} still has not reached my card."],
    },
    "general": {
        "subjects": ["Question about features", "Do you offer a discount", "Feedback on the app",
                     "How does the team plan work", "Partnership enquiry", "Suggestion"],
        "bodies": ["Does {product} support {feature}? I could not find it in the docs.",
                   "Do you offer student or non-profit discounts?",
                   "Just wanted to say {feature} has been really useful for our team.",
                   "How many users can we add on {product}?",
                   "It would be great if {feature} also worked on {device}."],
    },
}

CUES = {
    "urgent": ["URGENT:", "This is urgent, our whole team is blocked.",
               "Production is down right now.", "We are losing sales every minute.",
               "Please fix this immediately."],
    "high": ["Please look at this as soon as possible.", "This is blocking my work today.",
             "I need this sorted today.", "It is affecting several of our users."],
    "medium": [""],
    "low": ["No rush on this.", "Whenever you get a chance.", "Just a quick question.",
            "Not important, just curious."],
}
PRIORITY_WEIGHTS = {"low": 0.2, "medium": 0.4, "high": 0.28, "urgent": 0.12}

OPENERS = ["", "", "Hi,", "Hello,", "Hi team,", "Hello support,", "Dear team,"]
CLOSERS = ["", "", "Thanks.", "Thank you.", "Regards.", "Please help.", "Thanks in advance."]


def _fill(template: str, rng: random.Random) -> str:
    return template.format(**{k: rng.choice(v) for k, v in SLOTS.items()})


def generate(rows: int = 1500, seed: int = config.RANDOM_SEED,
             label_noise: float = 0.05, cue_rate: float = 0.7) -> pd.DataFrame:
    rng = random.Random(seed)
    cats = [c for c in CATEGORIES if c in TEMPLATES]
    pris = [p for p in PRIORITIES if p in PRIORITY_WEIGHTS]
    weights = [PRIORITY_WEIGHTS[p] for p in pris]
    out = []
    for _ in range(rows):
        cat = rng.choice(cats)
        pri = rng.choices(pris, weights=weights)[0]
        t = TEMPLATES[cat]
        subject = _fill(rng.choice(t["subjects"]), rng)
        body = _fill(rng.choice(t["bodies"]), rng)
        if rng.random() < cue_rate:  # urgency is stated only some of the time
            cue = rng.choice(CUES[pri])
            body = f"{cue} {body}".strip() if pri == "urgent" else f"{body} {cue}".strip()
        body = " ".join(x for x in (rng.choice(OPENERS), body, rng.choice(CLOSERS)) if x)
        if rng.random() < label_noise:  # real labelling is never perfect
            cat = rng.choice(cats)
        out.append({"subject": subject, "body": body, "category": cat, "priority": pri,
                    "source": config.SEED_SOURCE})
    return pd.DataFrame(out, columns=config.COLUMNS)


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--rows", type=int, default=1500)
    ap.add_argument("--out", type=Path, default=config.DATASET_CSV)
    args = ap.parse_args(argv)

    df = generate(args.rows)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(args.out, index=False)
    args.out.with_name("tickets.source.json").write_text(json.dumps({
        "source": "seed", "synthetic": True, "rows": len(df),
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }, indent=2))
    print(f"wrote {len(df)} SEED rows to {args.out}")
    print("  category counts:", df["category"].value_counts().to_dict())
    print("  priority counts:", df["priority"].value_counts().to_dict())
    print("\n  This data is synthetic. Replace it with real tickets before reporting metrics.")


if __name__ == "__main__":
    main()
