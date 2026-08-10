import React, { useState } from 'react';
import { Trash2, RotateCcw, Check, Sparkles, Clock, AlertCircle, FileText, Coins } from 'lucide-react';
import ReviewPDP from './ReviewPDP';
import { CREDIT_PRICING } from '../api/client';

/* ── Draft card (not enough credits to run AI) ──────────────────────────── */
function DraftCard({ product, onDelete, onRecharge, onGenerate }) {
  return (
    <div className="rc-queue-card rc-draft-card">
      <div className="rc-queue-card-img">
        <img src={product.image} alt={product.title} />
        <div className="rc-draft-badge"><FileText size={11} /> Draft</div>
      </div>
      <div className="rc-queue-card-info">
        <p className="rc-queue-card-title">Product photo</p>
        <p className="rc-draft-note">
          Not enough credits — recharge to generate apparel.
        </p>
        <div className="rc-draft-actions">
          {onGenerate ? (
            <button className="rc-draft-btn rc-draft-btn-generate" onClick={onGenerate}>
              <Sparkles size={12} /> Generate ({CREDIT_PRICING.model_shoot})
            </button>
          ) : (
            <button className="rc-draft-btn rc-draft-btn-recharge" onClick={onRecharge}>
              <Coins size={12} /> Recharge
            </button>
          )}
          <button className="rc-draft-btn rc-draft-btn-delete" onClick={() => onDelete([product.id])}>
            <Trash2 size={12} /> Delete
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Product queue card ─────────────────────────────────────────────────── */
function QueueCard({ product, selected, onToggleSelect, onClick }) {
  return (
    <div
      className={`rc-queue-card${selected ? ' selected' : ''}`}
      onClick={onClick}
    >
      {/* Select checkbox */}
      <button
        className={`rc-select-check${selected ? ' on' : ''}`}
        onClick={e => { e.stopPropagation(); onToggleSelect(); }}
        aria-label="Select"
      >
        {selected && <Check size={11} color="#fff" strokeWidth={3}/>}
      </button>

      <div className="rc-queue-card-img">
        <img src={product.image} alt={product.title}/>
      </div>
      <div className="rc-queue-card-info">
        <p className="rc-queue-card-title">{product.title}</p>
        <p className="rc-queue-card-cat">{product.category}</p>
        {product.price && <p className="rc-queue-card-price">{product.price}</p>}
      </div>
    </div>
  );
}

/* ── Bulk action bar ────────────────────────────────────────────────────── */
function BulkBar({ count, section, onDelete, onRetake, onClear }) {
  return (
    <div className="rc-bulk-bar">
      <span className="rc-bulk-count">{count} selected</span>
      {section === 'approve' && (
        <button className="rc-bulk-btn rc-bulk-retake" onClick={onRetake}>
          <RotateCcw size={14}/> Send to Retake
        </button>
      )}
      <button className="rc-bulk-btn rc-bulk-delete" onClick={onDelete}>
        <Trash2 size={14}/> Delete
      </button>
      <button className="rc-bulk-btn rc-bulk-clear" onClick={onClear}>
        ✕ Clear
      </button>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */
export default function ReviewCenterView({
  pendingApprove, pendingRetake, pendingDraft = [],
  onApprove, onSendToRetake, onDelete, onOpenRetakeSession,
  onOpenTopUp, walletBalance = 0, onGenerateDraft,
  onRegenShot, onFullRegen, onUpdateProduct,
}) {
  const [reviewProduct, setReviewProduct]   = useState(null);
  const [selectedApprove, setSelectedApprove] = useState([]);
  const [selectedRetake,  setSelectedRetake]  = useState([]);

  const toggleApprove = (id) =>
    setSelectedApprove(prev => prev.includes(id) ? prev.filter(x=>x!==id) : [...prev, id]);
  const toggleRetake  = (id) =>
    setSelectedRetake(prev  => prev.includes(id) ? prev.filter(x=>x!==id) : [...prev, id]);

  const handleBulkDeleteApprove = () => { onDelete(selectedApprove); setSelectedApprove([]); };
  const handleBulkDeleteRetake  = () => { onDelete(selectedRetake);  setSelectedRetake([]); };
  const handleBulkRetake        = () => { onSendToRetake(selectedApprove); setSelectedApprove([]); };

  return (
    <div className="rc-view">
      {/* Header row */}
      <div className="rc-header-row">
        <h2 className="rc-page-title">Review Center</h2>
        <div className="rc-header-badges">
          {pendingDraft.length > 0 && (
            <span className="rc-badge rc-badge-draft">
              <FileText size={11}/> {pendingDraft.length} draft{pendingDraft.length !== 1 ? 's' : ''}
            </span>
          )}
          {pendingApprove.length > 0 && (
            <span className="rc-badge rc-badge-approve">
              <Clock size={11}/> {pendingApprove.length} to approve
            </span>
          )}
          {pendingRetake.length > 0 && (
            <span className="rc-badge rc-badge-retake">
              <AlertCircle size={11}/> {pendingRetake.length} need retake
            </span>
          )}
        </div>
      </div>

      {/* ── Drafts (saved when balance couldn't fund the AI pass) ── */}
      {pendingDraft.length > 0 && (
        <section className="rc-section rc-section-drafts">
          <div className="rc-section-header">
            <div className="rc-section-title-row">
              <div className="rc-section-dot rc-dot-draft"/>
              <span className="rc-section-title">Drafts — Waiting for Credits</span>
              <span className="rc-section-count">{pendingDraft.length}</span>
            </div>
            <p className="rc-section-sub">
              Your photos are safe here. Recharge credits to generate the AI apparel shoot.
            </p>
          </div>
          <div className="rc-queue-list">
            {pendingDraft.map(p => (
              <DraftCard
                key={p.id}
                product={p}
                onDelete={onDelete}
                onRecharge={onOpenTopUp}
                onGenerate={walletBalance >= CREDIT_PRICING.model_shoot
                  ? () => onGenerateDraft(p)
                  : null}
              />
            ))}
          </div>
        </section>
      )}

      {/* ── Pending Approve ── */}
      <section className="rc-section">
        <div className="rc-section-header">
          <div className="rc-section-title-row">
            <div className="rc-section-dot rc-dot-approve"/>
            <span className="rc-section-title">Pending Approval</span>
            <span className="rc-section-count">{pendingApprove.length}</span>
          </div>
          <p className="rc-section-sub">
            AI has generated these listings — review, set pricing and approve.
          </p>
        </div>

        {selectedApprove.length > 0 && (
          <BulkBar
            count={selectedApprove.length}
            section="approve"
            onDelete={handleBulkDeleteApprove}
            onRetake={handleBulkRetake}
            onClear={() => setSelectedApprove([])}
          />
        )}

        {pendingApprove.length === 0 ? (
          <div className="rc-empty">
            <Sparkles size={32} strokeWidth={1.4} color="var(--c-peach-mid)"/>
            <p>No products waiting for approval</p>
            <span>Add products via the + button in Your Catalogue</span>
          </div>
        ) : (
          <div className="rc-queue-list">
            {pendingApprove.map(p => (
              <QueueCard
                key={p.id}
                product={p}
                selected={selectedApprove.includes(p.id)}
                onToggleSelect={() => toggleApprove(p.id)}
                onClick={() => setReviewProduct(p)}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── Pending Retake ── */}
      <section className="rc-section">
        <div className="rc-section-header">
          <div className="rc-section-title-row">
            <div className="rc-section-dot rc-dot-retake"/>
            <span className="rc-section-title">Pending Retake</span>
            <span className="rc-section-count">{pendingRetake.length}</span>
          </div>
          <p className="rc-section-sub">
            These products need a fresh photo. Use the Retake Session to reshoot.
          </p>
        </div>

        {selectedRetake.length > 0 && (
          <BulkBar
            count={selectedRetake.length}
            section="retake"
            onDelete={handleBulkDeleteRetake}
            onClear={() => setSelectedRetake([])}
          />
        )}

        {pendingRetake.length === 0 ? (
          <div className="rc-empty">
            <RotateCcw size={32} strokeWidth={1.4} color="var(--c-peach-mid)"/>
            <p>No products pending retake</p>
          </div>
        ) : (
          <>
            <div className="rc-queue-list">
              {pendingRetake.map(p => (
                <QueueCard
                  key={p.id}
                  product={p}
                  selected={selectedRetake.includes(p.id)}
                  onToggleSelect={() => toggleRetake(p.id)}
                  onClick={() => setReviewProduct(p)}
                />
              ))}
            </div>
            <button className="rc-retake-session-btn" onClick={onOpenRetakeSession}>
              <RotateCcw size={16}/> Start Retake Session
            </button>
          </>
        )}
      </section>

      {/* Review PDP modal */}
      {reviewProduct && (
        <ReviewPDP
          product={reviewProduct}
          walletBalance={walletBalance}
          onRegenShot={onRegenShot}
          onFullRegen={onFullRegen}
          onOpenTopUp={onOpenTopUp}
          onUpdateProduct={onUpdateProduct}
          onClose={() => setReviewProduct(null)}
          onApprove={(price, qty) => {
            onApprove(reviewProduct, price, qty);
            setReviewProduct(null);
          }}
          onSendToRetake={() => {
            onSendToRetake([reviewProduct.id]);
            setReviewProduct(null);
          }}
        />
      )}
    </div>
  );
}
