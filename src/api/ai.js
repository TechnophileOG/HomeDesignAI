/* ════════════════════════════════════════════════════════════════════════════
   KatalogitAI — AI Pipeline (real async jobs)
   ────────────────────────────────────────────────────────────────────────────
   The ONE frontend surface for AI. It maps directly onto the backend job API:

       const { job, wallet } = await ai.createJob({ type, productId });
       const { status, job } = await ai.pollJob(job.id, onStage);

   The backend ATOMICALLY reserves credits on job creation (a client can never
   spend without paying) and renders via the managed Vertex AI engine once
   VERTEX_AI_LOCATION is configured. Until then jobs stay 'queued' — the UI
   reports this honestly instead of faking results.
   ════════════════════════════════════════════════════════════════════════════ */

import { api } from './client';

/* ════════════════════════════════════════════════════════════════════════════
   Public pipeline — the only surface the UI touches.
   ════════════════════════════════════════════════════════════════════════════ */
export const ai = {
  /** Create an async job. Mirrors POST /jobs — credits reserved atomically. */
  async createJob({ type, productId }) {
    const res = await api.createJob({ type, productId });
    return { id: res.job.id, status: res.job.status, wallet: res.wallet };
  },

  /** Poll until terminal or a few attempts pass. Mirrors GET /jobs/{id}. */
  async pollJob(id, onStage, { maxTries = 3, intervalMs = 2500 } = {}) {
    let last = null;
    for (let i = 0; i < maxTries; i++) {
      if (onStage) onStage(i + 1);
      last = await api.getJob(id);
      if (last.status === 'done' || last.status === 'failed') break;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return { status: last?.status || 'queued', job: last || { id } };
  },

  /** Regenerate one shot (1 credit, server-reserved). */
  async regenShot({ productId }) {
    return this.createJob({ type: 'regen_shot', productId });
  },

  /** Regenerate the full gallery (3 credits, server-reserved). */
  async fullRegen({ productId }) {
    return this.createJob({ type: 'full_regen', productId });
  },
};
