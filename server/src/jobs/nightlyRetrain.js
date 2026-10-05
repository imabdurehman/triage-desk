// 02:00: send every human-confirmed ticket to the ML service and ask it to
// retrain. The ML service promotes the new model only if it scores at least as
// well on the frozen test set; this job just starts the run and records it.
import { startTraining } from '../services/managerService.js';

export const name = 'nightlyRetrain';
export const schedule = '0 2 * * *';

export async function run() {
  const { runId, confirmedTickets } = await startTraining('scheduled');
  return { runId, confirmedTickets };
}
