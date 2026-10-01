from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.contract import CONTRACT_VERSION
from app.schemas.prediction import HealthResponse, PredictRequest, PredictResponse
from app.services import predictor

app = FastAPI(title="TriageDesk ML service", version="0.1.0")


# Same error shape as the Node server: { "error": { "code", "message", "details" } }
@app.exception_handler(RequestValidationError)
async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    details = {".".join(str(p) for p in e["loc"][1:]): e["msg"] for e in exc.errors()}
    return JSONResponse(
        status_code=400,
        content={"error": {"code": "VALIDATION_ERROR", "message": "Invalid request", "details": details}},
    )


@app.exception_handler(Exception)
async def _unhandled(_: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(
        status_code=500,
        content={"error": {"code": "INTERNAL_ERROR", "message": str(exc) or "Something went wrong"}},
    )


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        modelLoaded=predictor.MODEL_LOADED,
        modelVersion=predictor.MODEL_VERSION,
        contractVersion=CONTRACT_VERSION,
    )


@app.post("/predict", response_model=PredictResponse)
def predict(req: PredictRequest) -> PredictResponse:
    return PredictResponse(**predictor.predict(req.subject, req.body))

# /train and /metrics arrive with feature/ml-api
