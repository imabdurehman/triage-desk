from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.contract import CATEGORIES, PRIORITIES


def _in_contract(value: str, allowed: tuple[str, ...], name: str) -> str:
    if value not in allowed:
        raise ValueError(f"{name} '{value}' is not in contract.json")
    return value


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

    # Checked on the way OUT, so a model trained on stale labels fails here
    # instead of corrupting the database.
    @field_validator("category")
    @classmethod
    def _category_in_contract(cls, v: str) -> str:
        return _in_contract(v, CATEGORIES, "category")

    @field_validator("priority")
    @classmethod
    def _priority_in_contract(cls, v: str) -> str:
        return _in_contract(v, PRIORITIES, "priority")


class HealthResponse(BaseModel):
    status: str
    modelLoaded: bool
    modelVersion: str
    contractVersion: int


class ConfirmedTicket(BaseModel):
    """A ticket whose labels a person confirmed; sent by the server for retraining."""
    subject: str = Field(min_length=1, max_length=300)
    body: str = Field(min_length=1, max_length=20_000)
    category: str
    priority: str

    @field_validator("category")
    @classmethod
    def _category_in_contract(cls, v: str) -> str:
        return _in_contract(v, CATEGORIES, "category")

    @field_validator("priority")
    @classmethod
    def _priority_in_contract(cls, v: str) -> str:
        return _in_contract(v, PRIORITIES, "priority")


class TrainRequest(BaseModel):
    # The example is what /docs pre-fills, so "Try it out" then "Execute" just works.
    model_config = ConfigDict(json_schema_extra={"examples": [{"tickets": []}]})

    tickets: list[ConfirmedTicket] = Field(default_factory=list, max_length=20_000)
