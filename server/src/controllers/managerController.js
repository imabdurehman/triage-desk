import * as manager from '../services/managerService.js';
import * as ml from '../services/mlService.js';
import { runJobNow, JOB_NAMES } from '../jobs/index.js';
import { ApiError } from '../utils/ApiError.js';

export async function metrics(_req, res) {
  const [tickets, model, yesterday] = await Promise.all([manager.metrics(), ml.health(), manager.latestDigest()]);
  res.json({ tickets, mlService: model, yesterday });
}

export async function modelMetrics(_req, res) {
  res.json({ current: await ml.metrics(), runs: await manager.recentModelRuns() });
}

export async function retrain(_req, res) {
  res.status(202).json(await manager.startTraining('manual'));
}

export async function jobRuns(_req, res) {
  res.json({ jobs: JOB_NAMES, runs: await manager.recentJobRuns() });
}

export async function runJob(req, res) {
  if (!JOB_NAMES.includes(req.params.name)) throw ApiError.notFound('Job');
  res.json(await runJobNow(req.params.name));
}

export async function testEmail(req, res) {
  res.json(await manager.sendTestEmail(req.user.id));
}
