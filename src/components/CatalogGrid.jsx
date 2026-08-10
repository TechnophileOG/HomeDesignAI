import React, { useState } from 'react';
import { Search, Plus, Star, Sparkles } from 'lucide-react';
import { sanitizeText } from '../api/sanitize';

export default function CatalogGrid({ 
  products, 
  onAddClick, 
  onProductClick,
  searchQuery,
  setSearchQuery
}) {
  const [activeCategory, setActiveCategory] = useState('All');
  
  const categories = ['All', 'Apparel', 'Footwear', 'Gadgets'];

  const filteredProducts = products.filter(product => {
    const matchesCategory = activeCategory === 'All' || product.category === activeCategory;
    const matchesSearch   = product.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                            product.category.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="section-header-row">

      {/* ── Row 1: Title + Search ── */}
      <div className="catalog-top-row">
        <span className="catalog-section-title">Your Catalogue</span>

        <div className="search-container">
          <Search className="search-icon" size={16} strokeWidth={2.2} />
          <input
            type="text"
            className="search-input"
            placeholder="Search products…"
            value={searchQuery}
            maxLength={80}
            onChange={(e) => setSearchQuery(sanitizeText(e.target.value, 80))}
          />
        </div>
      </div>

      {/* ── Row 2: Category tags ── */}
      <div className="category-tags">
        {categories.map(cat => (
          <button
            key={cat}
            className={`category-tag ${activeCategory === cat ? 'active' : ''}`}
            onClick={() => setActiveCategory(cat)}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* ── Product Grid ── */}
      <div className="catalog-grid">
        {/* ADD Card */}
        <div className="grid-card add-card" onClick={onAddClick} title="Add New Product">
          <div className="add-card-inner">
            <div className="add-plus-circle">
              <Plus size={22} strokeWidth={3} />
            </div>
            <span className="add-card-label">ADD</span>
          </div>
        </div>

        {/* Product Cards */}
        {filteredProducts.map(product => (
          <div 
            key={product.id} 
            className="grid-card product-card" 
            onClick={() => onProductClick(product)}
            title="Click to view product details"
          >
            <div className="product-img-wrapper">
              <img 
                src={product.hasAiPhoto && product.aiImage ? product.aiImage : product.image} 
                alt={product.title} 
                className="product-img"
              />
              
              <span className="badge-tag star">
                <Star size={10} style={{ fill: 'var(--c-gold)' }} />
                {product.rating || '5.0'}
              </span>

              {product.hasAiPhoto && (
                <span 
                  className="badge-tag" 
                  style={{ 
                    top: 'auto', bottom: '8px', right: '8px', 
                    background: '#e9f5f2', color: '#2a9d8f',
                    borderColor: 'rgba(42,157,143,0.2)'
                  }}
                >
                  <Sparkles size={10} style={{ fill: '#2a9d8f' }} />
                  AI Active
                </span>
              )}
            </div>

            <div className="product-info">
              <span className="product-title">{product.title}</span>
              <div className="product-price-row">
                <span className="product-price">{product.price}</span>
                <span className="product-action-pill">
                  {product.hasAiPhoto ? 'Redo AI' : 'Generate'}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
