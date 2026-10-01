from fastapi.testclient import TestClient

from app.contract import CATEGORIES, PRIORITIES
from app.main import app

client = TestClient(app)


def test_health_ok():
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["contractVersion"] == 1


def test_predict_returns_contract_values():
    r = client.post("/predict", json={"subject": "Charged twice", "body": "I was charged twice"})
    assert r.status_code == 200
    body = r.json()
    assert body["category"] in CATEGORIES
    assert body["priority"] in PRIORITIES
    assert 0.0 <= body["confidence"]["category"] <= 1.0
    assert body["modelVersion"]


def test_predict_rejects_empty_subject_with_contract_error_shape():
    r = client.post("/predict", json={"subject": "", "body": "x"})
    assert r.status_code == 400
    err = r.json()["error"]
    assert err["code"] == "VALIDATION_ERROR"
    assert "subject" in err["details"]
