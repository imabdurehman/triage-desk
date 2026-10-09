"""Evaluation metrics, reported the same way everywhere.

Macro F1 is the headline number, not accuracy. Ticket categories are rarely
balanced: if 60% of tickets are "technical", a model that always answers
"technical" scores 60% accuracy while being useless. Macro F1 averages over
classes equally, so it exposes that.
"""
from collections import Counter

from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    precision_recall_fscore_support,
)


def score(y_true, y_pred, labels) -> dict:
    """Accuracy, macro/weighted F1, per-class breakdown and confusion matrix."""
    p, r, f, s = precision_recall_fscore_support(
        y_true, y_pred, labels=list(labels), zero_division=0
    )
    return {
        "accuracy": round(float(accuracy_score(y_true, y_pred)), 4),
        "macro_f1": round(float(f1_score(y_true, y_pred, labels=list(labels),
                                         average="macro", zero_division=0)), 4),
        "weighted_f1": round(float(f1_score(y_true, y_pred, labels=list(labels),
                                            average="weighted", zero_division=0)), 4),
        "per_class": {
            lab: {"precision": round(float(p[i]), 4), "recall": round(float(r[i]), 4),
                  "f1": round(float(f[i]), 4), "support": int(s[i])}
            for i, lab in enumerate(labels)
        },
        "labels": list(labels),
        "confusion_matrix": confusion_matrix(y_true, y_pred, labels=list(labels)).tolist(),
    }


def majority_baseline(y_train, y_test, labels) -> dict:
    """What you get by always predicting the most common training label.

    A trained model must beat this clearly. If it does not, the text does not
    predict the label, and the problem is the data, not the model.
    """
    most_common = Counter(y_train).most_common(1)[0][0]
    return {"always_predicts": most_common, **score(y_test, [most_common] * len(y_test), labels)}


def format_report(name: str, result: dict, baseline: dict) -> str:
    """Human-readable summary for the console."""
    lines = [
        f"  {name}",
        f"    accuracy   {result['accuracy']:.3f}   (always-{baseline['always_predicts']}: "
        f"{baseline['accuracy']:.3f})",
        f"    macro F1   {result['macro_f1']:.3f}   (always-{baseline['always_predicts']}: "
        f"{baseline['macro_f1']:.3f})",
        f"    {'class':<12}{'precision':>10}{'recall':>9}{'f1':>8}{'support':>9}",
    ]
    for lab, m in result["per_class"].items():
        lines.append(f"    {lab:<12}{m['precision']:>10.3f}{m['recall']:>9.3f}"
                     f"{m['f1']:>8.3f}{m['support']:>9}")
    return "\n".join(lines)
