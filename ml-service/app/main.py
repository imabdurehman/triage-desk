from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, RedirectResponse

from app.contract import CONTRACT_VERSION
from app.schemas.prediction import HealthResponse, PredictRequest, PredictResponse, TrainRequest
from app.services import model_store, predictor, trainer


class ApiError(Exception):
    """Raised for expected errors; rendered in the contract's error shape."""

    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


@asynccontextmanager
async def lifespan(_: FastAPI):
    predictor.reload()  # serve the live version from the first request
    yield


app = FastAPI(title="TriageDesk ML service", version="1.0.0", lifespan=lifespan)


def _error(status: int, code: str, message: str, details: dict | None = None) -> JSONResponse:
    body = {"code": code, "message": message}
    if details:
        body["details"] = details
    return JSONResponse(status_code=status, content={"error": body})


# Same error shape as the Node server: { "error": { "code", "message", "details" } }
@app.exception_handler(ApiError)
async def _api_error(_: Request, exc: ApiError) -> JSONResponse:
    return _error(exc.status, exc.code, exc.message)


@app.exception_handler(RequestValidationError)
async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    details = {".".join(str(p) for p in e["loc"][1:]): e["msg"] for e in exc.errors()}
    return _error(400, "VALIDATION_ERROR", "Invalid request", details)


@app.exception_handler(Exception)
async def _unhandled(_: Request, exc: Exception) -> JSONResponse:
    return _error(500, "INTERNAL_ERROR", str(exc) or "Something went wrong")


@app.get("/", include_in_schema=False)
def root() -> RedirectResponse:
    return RedirectResponse("/docs")  # the service has no pages; send a browser to its API docs


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(status="ok", contractVersion=CONTRACT_VERSION, **predictor.status())


@app.post("/predict", response_model=PredictResponse)
def predict(req: PredictRequest) -> PredictResponse:
    return PredictResponse(**predictor.predict(req.subject, req.body))


@app.post("/train", status_code=202)
def train(req: TrainRequest) -> dict:
    try:
        return trainer.start([t.model_dump() for t in req.tickets])
    except trainer.TrainingBusy as busy:
        raise ApiError(409, "TRAINING_BUSY", f"Run {busy} is still in progress") from None
    except trainer.NotReady as err:
        raise ApiError(409, "NOT_READY", str(err)) from None


@app.get("/train/{run_id}")
def train_status(run_id: str) -> dict:
    run = trainer.get_run(run_id)
    if run is None:
        raise ApiError(404, "RUN_NOT_FOUND", f"No training run {run_id}")
    return run


@app.get("/metrics")
def metrics() -> dict:
    version = model_store.current_version()
    if version is None:
        raise ApiError(404, "NO_MODEL", "No model has been promoted yet")
    metadata = model_store.load(version)[1]
    return {"modelVersion": version, "trainedAt": metadata["created_at"],
            "trainRows": metadata["train_rows"], "testRows": metadata["test_rows"],
            "seedData": metadata["seed_data"], "results": model_store.metrics_of(version)}
