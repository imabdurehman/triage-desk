import { Router } from 'express';
import * as c from '../controllers/managerController.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { requireRole } from '../middleware/roleMiddleware.js';

const r = Router();
r.use(requireAuth, requireRole('manager'));
r.get('/metrics', asyncHandler(c.metrics));
r.get('/model', asyncHandler(c.modelMetrics));
r.post('/model/retrain', asyncHandler(c.retrain));
r.get('/jobs', asyncHandler(c.jobRuns));
r.post('/jobs/:name/run', asyncHandler(c.runJob));
r.post('/test-email', asyncHandler(c.testEmail));
export default r;
