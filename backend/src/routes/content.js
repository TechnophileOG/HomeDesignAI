/* ════════════════════════════════════════════════════════════════════════
   KatalogitAI — content: carousel banners + in-app announcements
   ────────────────────────────────────────────────────────────────────────
   Two admin-controlled surfaces:
     • banners       → the home-screen carousel slides
     • announcements → the in-app notification bell

   Reads are auth-gated (users must have a session) and only ever return
   ENABLED, non-expired items. Writes are owner-console-gated (requireAdmin:
   OWNER_EMAIL + unlock session), per-user rate-limited, sanitized
   field-by-field, and every mutation is audited.
   Sorting/filtering happens in JS (not Firestore queries) so no composite
   indexes are needed at deploy time.
   ════════════════════════════════════════════════════════════════════════ */

import { Router } from 'express';
import { db, now, snap } from '../db.js';
import { banner as sanitizeBanner, announcement as sanitizeAnnouncement,
         id as cleanId } from '../validate.js';
import { requireAdmin } from '../auth.js';
import { userLimiter } from '../rate-limit.js';
import { notFound } from '../errors.js';
import { auditWrite } from '../audit.js';

const contentRouter = Router();
const adminWriteLimiter = userLimiter({
  windowMs: 60 * 1000,
  limit: 20,
  message: 'Too many content changes. Try again in a minute.',
});

/* ── user-facing reads (inside the auth gate) ─────────────────────────── */

contentRouter.get('/content/banners', async (_req, res, next) => {
  try {
    const snap2 = await db.collection('banners').limit(50).get();
    const banners = snap2.docs
      .map(snap)
      .filter((b) => b.enabled === true)
      .sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
      .slice(0, 8);
    res.json({ ok: true, data: { banners } });
  } catch (err) { next(err); }
});

contentRouter.get('/content/announcements', async (_req, res, next) => {
  try {
    const nowMs = now();
    const snap2 = await db.collection('announcements').limit(50).get();
    const announcements = snap2.docs
      .map(snap)
      .filter((a) => a.enabled === true && (!a.expiresAt || a.expiresAt > nowMs))
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
      .slice(0, 10);
    res.json({ ok: true, data: { announcements } });
  } catch (err) { next(err); }
});

/* ── admin CRUD (mounted inside the auth gate; requireAdmin per route) ── */

export const adminContentRouter = Router();

const listAll = async (coll) => {
  const snap2 = await db.collection(coll).orderBy('createdAt', 'desc').limit(200).get();
  return snap2.docs.map(snap);
};
const getOne = async (coll, id, label) => {
  const ref = db.collection(coll).doc(id);
  const doc = await ref.get();
  if (!doc.exists) throw notFound(`${label} not found.`);
  return { ref, doc: snap(doc) };
};

/* ── banners ── */

adminContentRouter.get('/admin/content/banners', requireAdmin, async (_req, res, next) => {
  try { res.json({ ok: true, data: { banners: await listAll('banners') } }); } catch (err) { next(err); }
});

adminContentRouter.post('/admin/content/banners', requireAdmin, adminWriteLimiter, async (req, res, next) => {
  try {
    // sanitizeBanner enforces a non-empty title (400 on junk).
    const clean = sanitizeBanner(req.body || {});
    const ref = db.collection('banners').doc();
    const banner = {
      id: ref.id,
      title: clean.title,
      subtitle: clean.subtitle ?? '',
      badge: clean.badge ?? '',
      ctaText: clean.ctaText ?? '',
      ctaUrl: clean.ctaUrl ?? '',
      theme: clean.theme ?? 1,
      enabled: clean.enabled ?? false,
      order: clean.order ?? 100,
      createdAt: now(),
      updatedAt: now(),
      createdBy: req.user.email || req.user.uid,
    };
    await ref.set(banner);
    auditWrite({ kind: 'banner_create', method: 'POST', path: '/api/v1/admin/content/banners', status: 201, uid: req.user.uid, email: req.user.email, itemId: ref.id });
    res.status(201).json({ ok: true, data: { banner } });
  } catch (err) { next(err); }
});

adminContentRouter.patch('/admin/content/banners/:id', requireAdmin, adminWriteLimiter, async (req, res, next) => {
  try {
    const id = cleanId(req.params.id, { max: 48, label: 'banner id' });
    const { ref } = await getOne('banners', id, 'Banner');
    const clean = sanitizeBanner(req.body || {});
    const patch = { ...clean, updatedAt: now() };
    await ref.update(patch);
    auditWrite({ kind: 'banner_update', method: 'PATCH', path: `/api/v1/admin/content/banners/${id}`, status: 200, uid: req.user.uid, email: req.user.email, itemId: id });
    res.json({ ok: true, data: { banner: snap(await ref.get()) } });
  } catch (err) { next(err); }
});

adminContentRouter.delete('/admin/content/banners/:id', requireAdmin, adminWriteLimiter, async (req, res, next) => {
  try {
    const id = cleanId(req.params.id, { max: 48, label: 'banner id' });
    const { ref } = await getOne('banners', id, 'Banner');
    await ref.delete();
    auditWrite({ kind: 'banner_delete', method: 'DELETE', path: `/api/v1/admin/content/banners/${id}`, status: 200, uid: req.user.uid, email: req.user.email, itemId: id });
    res.json({ ok: true, data: { deleted: true } });
  } catch (err) { next(err); }
});

/* ── announcements ── */

adminContentRouter.get('/admin/content/announcements', requireAdmin, async (_req, res, next) => {
  try { res.json({ ok: true, data: { announcements: await listAll('announcements') } }); } catch (err) { next(err); }
});

adminContentRouter.post('/admin/content/announcements', requireAdmin, adminWriteLimiter, async (req, res, next) => {
  try {
    // sanitizeAnnouncement enforces a non-empty title (400 on junk).
    const clean = sanitizeAnnouncement(req.body || {});
    const ref = db.collection('announcements').doc();
    const announcement = {
      id: ref.id,
      title: clean.title,
      message: clean.message ?? '',
      type: clean.type ?? 'info',
      enabled: clean.enabled ?? false,
      ...(clean.expiresAt !== undefined ? { expiresAt: clean.expiresAt } : {}),
      createdAt: now(),
      updatedAt: now(),
      createdBy: req.user.email || req.user.uid,
    };
    await ref.set(announcement);
    auditWrite({ kind: 'announcement_create', method: 'POST', path: '/api/v1/admin/content/announcements', status: 201, uid: req.user.uid, email: req.user.email, itemId: ref.id });
    res.status(201).json({ ok: true, data: { announcement } });
  } catch (err) { next(err); }
});

adminContentRouter.patch('/admin/content/announcements/:id', requireAdmin, adminWriteLimiter, async (req, res, next) => {
  try {
    const id = cleanId(req.params.id, { max: 48, label: 'announcement id' });
    const { ref } = await getOne('announcements', id, 'Announcement');
    const clean = sanitizeAnnouncement(req.body || {});
    const patch = { ...clean, updatedAt: now() };
    await ref.update(patch);
    auditWrite({ kind: 'announcement_update', method: 'PATCH', path: `/api/v1/admin/content/announcements/${id}`, status: 200, uid: req.user.uid, email: req.user.email, itemId: id });
    res.json({ ok: true, data: { announcement: snap(await ref.get()) } });
  } catch (err) { next(err); }
});

adminContentRouter.delete('/admin/content/announcements/:id', requireAdmin, adminWriteLimiter, async (req, res, next) => {
  try {
    const id = cleanId(req.params.id, { max: 48, label: 'announcement id' });
    const { ref } = await getOne('announcements', id, 'Announcement');
    await ref.delete();
    auditWrite({ kind: 'announcement_delete', method: 'DELETE', path: `/api/v1/admin/content/announcements/${id}`, status: 200, uid: req.user.uid, email: req.user.email, itemId: id });
    res.json({ ok: true, data: { deleted: true } });
  } catch (err) { next(err); }
});

export { contentRouter };
