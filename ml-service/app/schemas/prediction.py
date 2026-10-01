from pydantic import BaseModel, Field, field_validator

from app.contract import CATEGORIES, PRIORITIES


class PredictRequest(BaseModel):
    subject: str = Field(min_length=1, max_length=300)
    body: str = Field(min_length=1, max_length=20_000)


class Confidence(BaseModel):
    category: float = Field(ge=0.0, le=1.0)
    priority: float = Field(ge=0.0, le=1.0)


class PredictResponse(BaseModel):
    category: str
    priority: str
    confidence: Confidence
    modelVersion: str

    # The response is checked against the contract on the way OUT, so a model
    # trained on stale labels fails here instead of corrupting the database.
    @field_validator("category")
    @classmethod
    def _category_in_contract(cls, v: str) -> str:
        if v not in CATEGORIES:
            raise ValueError(f"category '{v}' is not in contract.json")
        return v

    @field_validator("priority")
    @classmethod
    def _priority_in_contract(cls, v: str) -> str:
        if v not in PRIORITIES:
            raise ValueError(f"priority '{v}' is not in contract.json")
        return v


class HealthResponse(BaseModel):
    status: str
    modelLoaded: bool
    modelVersion: str
    contractVersion: int
