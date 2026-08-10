import React, { useState } from 'react';
import { X, Ruler, Palette, Tag, CheckCircle, Download } from 'lucide-react';
import { api } from '../api/client';

const EXPORT_PLATFORMS = [
  { id: 'amazon', label: 'Amazon (.csv)' },
  { id: 'flipkart', label: 'Flipkart (.csv)' },
  { id: 'meesho', label: 'Meesho (.csv)' },
  { id: 'myntra', label: 'Myntra (.csv)' },
  { id: 'alibaba', label: 'Alibaba (.csv)' },
];

export default function ProductDetailModal({ product, storeName = 'My Store', onClose }) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [activeTab, setActiveTab] = useState('specs'); // 'specs' | 'share'
  const [exportPlatform, setExportPlatform] = useState('amazon');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [exportDone, setExportDone] = useState('');

  // Listing details — ONLY real AI pipeline output (product.aiSpecs). No
  // invented specs, no fake ratings — absent data says so plainly.
  const aiSpecs = product.aiSpecs || null;

  const gallery = (() => {
    const list = [];
    if (product.aiImage) list.push(product.aiImage);
    if (product.image) list.push(product.image);
    return list.length ? list : ['/assets/tshirt.png'];
  })();

  const shareCaption = product.aiSpecs?.description
    ? `${product.aiSpecs.description}\n\nAvailable at ${storeName} — ${product.price || 'ask for price'}.`
    : `${product.title} — now live at ${storeName}.`;

  // Download the platform's bulk-upload CSV for this product (rendered
  // server-side from the CPM template engine — nothing is pushed anywhere).
  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    setExportError('');
    setExportDone('');
    try {
      const { filename, csv } = await api.exportProduct(product.id, exportPlatform);
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setExportDone(`Downloaded ${filename} — upload it in the ${exportPlatform} seller panel.`);
    } catch (err) {
      setExportError(err.message || 'Could not create the file. Try again.');
    } finally {
      setExporting(false);
    }
  };

  // REAL sharing: WhatsApp opens a wa.me deep link with the caption;
  // Instagram copies the caption so the seller pastes it into the app.
  const handleShare = async (platform) => {
    if (platform === 'WhatsApp') {
      window.open(`https://wa.me/?text=${encodeURIComponent(shareCaption)}`, '_blank', 'noopener');
      return;
    }
    try {
      await navigator.clipboard.writeText(shareCaption);
      alert('Caption copied — paste it into your Instagram post.');
    } catch {
      alert(shareCaption);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content pdp-modal-content" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="modal-title" style={{ color: 'var(--c-peach-darker)' }}>Product Details</span>
          </div>
          <div className="modal-close-btn" onClick={onClose}>
            <X size={16} />
          </div>
        </div>

        {/* Modal Grid split */}
        <div className="pdp-modal-grid">
          {/* Left Column - Swipe Gallery */}
          <div className="pdp-gallery-panel">
            <div className="pdp-gallery-main">
              <img src={gallery[currentSlide]} alt="Product view" className="pdp-gallery-img" />
              <div className="pdp-ai-badge">★ AI Generated</div>
            </div>
            
            {/* Gallery Dots */}
            <div className="pdp-gallery-dots" style={{ marginTop: '8px' }}>
              {gallery.map((_, i) => (
                <button
                  key={i}
                  className={`pdp-gallery-dot ${currentSlide === i ? 'active' : ''}`}
                  onClick={() => setCurrentSlide(i)}
                />
              ))}
            </div>

            {/* Gallery Thumbs */}
            <div className="pdp-gallery-thumbs" style={{ marginTop: '12px' }}>
              {gallery.map((src, i) => (
                <button
                  key={i}
                  className={`pdp-thumb ${currentSlide === i ? 'active' : ''}`}
                  onClick={() => setCurrentSlide(i)}
                >
                  <img src={src} alt={`Thumb ${i+1}`} />
                </button>
              ))}
            </div>
          </div>

          {/* Right Column - Product Info & Tabs */}
          <div className="pdp-info-panel">
            <div className="pdp-name-row">
              <h3 className="pdp-name" style={{ fontSize: '1.4rem', fontWeight: 800 }}>{product.title}</h3>
            </div>
            <div className="pdp-price" style={{ fontSize: '1.6rem', color: 'var(--c-accent)', fontWeight: 800, margin: '6px 0 12px' }}>
              {product.price}
            </div>

            {/* Tab selection */}
            <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid rgba(139,90,43,0.1)', paddingBottom: '8px', marginBottom: '14px' }}>
              <button 
                onClick={() => setActiveTab('specs')} 
                style={{
                  background: 'none', border: 'none', padding: '4px 12px',
                  fontWeight: 700, fontSize: '.83rem', cursor: 'pointer',
                  color: activeTab === 'specs' ? 'var(--c-accent)' : 'var(--c-peach-dark)',
                  borderBottom: activeTab === 'specs' ? '2px solid var(--c-accent)' : 'none'
                }}
              >
                Specifications
              </button>
              <button 
                onClick={() => setActiveTab('share')} 
                style={{
                  background: 'none', border: 'none', padding: '4px 12px',
                  fontWeight: 700, fontSize: '.83rem', cursor: 'pointer',
                  color: activeTab === 'share' ? 'var(--c-accent)' : 'var(--c-peach-dark)',
                  borderBottom: activeTab === 'share' ? '2px solid var(--c-accent)' : 'none'
                }}
              >
                Social Share
              </button>
            </div>

            {activeTab === 'specs' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {aiSpecs ? (
                  <>
                    <p className="pdp-desc" style={{ margin: 0 }}>{aiSpecs.description}</p>
                    <div className="pdp-detail-grid">
                      <div className="pdp-detail-row">
                        <Ruler size={14} /> <span className="pdp-detail-key">Sizes</span>
                        <div className="pdp-size-chips">
                          {(aiSpecs.sizes || []).map(s => <span key={s} className="pdp-size-chip">{s}</span>)}
                        </div>
                      </div>
                      <div className="pdp-detail-row">
                        <Palette size={14} /> <span className="pdp-detail-key">Colors</span>
                        <span className="pdp-detail-val">{(aiSpecs.colors || []).join(', ') || '—'}</span>
                      </div>
                      <div className="pdp-detail-row">
                        <Tag size={14} /> <span className="pdp-detail-key">Material</span>
                        <span className="pdp-detail-val">{aiSpecs.material || '—'}</span>
                      </div>
                      <div className="pdp-detail-row">
                        <Tag size={14} /> <span className="pdp-detail-key">Fit</span>
                        <span className="pdp-detail-val">{aiSpecs.fit || '—'}</span>
                      </div>
                      <div className="pdp-detail-row">
                        <Tag size={14} /> <span className="pdp-detail-key">Care</span>
                        <span className="pdp-detail-val">{aiSpecs.care || '—'}</span>
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="pdp-desc" style={{ margin: 0, opacity: .7 }}>
                    The AI analysis (description, sizes, colours, material) will appear here once the photoshoot completes.
                  </p>
                )}

                <div className="pdp-live-badge" style={{ marginTop: '6px' }}>
                  <CheckCircle size={14} /> Live on your online shop
                </div>

                {/* Download the platform-format listing file */}
                <div style={{ borderTop: '1px solid rgba(139,90,43,0.1)', paddingTop: '12px', marginTop: '4px' }}>
                  <div style={{ fontSize: '.7rem', fontWeight: 700, color: 'var(--c-peach-dark)', marginBottom: 6 }}>Download listing file</div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <select
                      className="settings-select"
                      style={{ flex: 1, minWidth: 0 }}
                      value={exportPlatform}
                      onChange={(e) => setExportPlatform(e.target.value)}
                    >
                      {EXPORT_PLATFORMS.map((p) => (
                        <option key={p.id} value={p.id}>{p.label}</option>
                      ))}
                    </select>
                    <button
                      className="af-primary-btn"
                      style={{ padding: '9px 14px', fontSize: '.8rem', display: 'flex', alignItems: 'center', gap: '6px' }}
                      onClick={handleExport}
                      disabled={exporting}
                    >
                      <Download size={14} /> {exporting ? 'Creating…' : 'Download'}
                    </button>
                  </div>
                  {exportDone && (
                    <div style={{ fontSize: '.68rem', fontWeight: 600, color: 'var(--c-accent-dark)', marginTop: 8 }}>✓ {exportDone}</div>
                  )}
                  {exportError && (
                    <div style={{ fontSize: '.68rem', color: '#c0392b', marginTop: 8 }}>{exportError}</div>
                  )}
                  <div style={{ fontSize: '.62rem', opacity: .55, marginTop: 6 }}>
                    CSV in {exportPlatform === 'amazon' ? 'Amazon' : exportPlatform[0].toUpperCase() + exportPlatform.slice(1)}’s bulk-upload format — download, then upload it in the seller panel. Nothing is posted automatically.
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <span style={{ fontSize: '.75rem', fontWeight: 700, color: 'var(--c-peach-dark)' }}>Generated Caption Copy:</span>
                <div style={{
                  background: 'rgba(0,0,0,0.03)', border: '1px solid rgba(139,90,43,0.1)',
                  borderRadius: '12px', padding: '12px', fontSize: '.8rem',
                  lineHeight: '1.5', whiteSpace: 'pre-wrap', fontFamily: 'var(--font-sans)',
                  color: 'var(--c-peach-darker)'
                }}>
                  {shareCaption}
                </div>

                <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                  <button 
                    className="af-primary-btn" 
                    style={{ flex: 1, padding: '10px 14px', fontSize: '.83rem', background: '#25D366' }}
                    onClick={() => handleShare('WhatsApp')}
                  >
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style={{ marginRight: 6 }}>
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L0 24l6.335-1.662c1.746.953 3.71 1.455 5.703 1.458h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413"/>
                    </svg>
                    WhatsApp Status
                  </button>
                  <button 
                    className="af-primary-btn" 
                    style={{ flex: 1, padding: '10px 14px', fontSize: '.83rem', background: '#E1306C' }}
                    onClick={() => handleShare('Instagram')}
                  >
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}>
                      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
                      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
                      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
                    </svg>
                    Insta Post
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
