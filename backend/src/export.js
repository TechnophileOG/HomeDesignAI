/* ════════════════════════════════════════════════════════════════════════
   KatalogitAI — platform-format CSV/Excel exports
   ────────────────────────────────────────────────────────────────────────
   The seller's take-away file: one product → a CSV laid out in that
   platform's bulk-upload column format (Amazon flat-file core columns,
   Flipkart listing template, Meesho bulk catalog, Myntra DIY template,
   Alibaba B2B product sheet). Content comes from the CPM template engine
   (platform-templates.js) — so every title/description already obeys that
   platform's rules (Amazon ≤75 chars, Meesho no-symbols 50–120, etc).

   Pure + deterministic: same product ⇒ byte-identical CSV, zero network.
   This REPLACES the old SP-API push (re-added later when publishing lands).
   ════════════════════════════════════════════════════════════════════════ */

import { cpmFromSellerForm } from './cpm.js';
import { renderPack } from './platform-templates.js';

/** The platforms we can export a listing file for. */
export const EXPORT_PLATFORMS = ['amazon', 'flipkart', 'meesho', 'myntra', 'alibaba'];

/** One CSV cell — strip control chars, quote when it needs quoting.
    Formula-injection guard: a cell beginning with = + - @ (or tab/CR) is
    treated as a formula by Excel/Sheets. Product titles are seller-controlled
    text that lands in these files, so we neutralise the trigger prefix with
    a leading apostrophe — the cell shows the literal text, never executes. */
const csvCell = (v) => {
  let s = String(v ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const csvRow = (cells) => `${cells.map(csvCell).join(',')}\r\n`;

/** Public image URLs for the export (processed bucket is public-read with
    unguessable paths — direct URLs are what bulk-upload templates accept). */
export const exportImageUrls = (product) => {
  const out = [];
  if (product?.flatLay?.path) out.push(`https://storage.googleapis.com/katalogit-originals/${product.flatLay.path}`);
  for (const g of product?.gallery || []) {
    if (g?.path) out.push(`https://storage.googleapis.com/katalogit-processed/${g.path}`);
  }
  return out.slice(0, 9);
};

/** Build a CPM from a product (aiSpecs-first, honest defaults). The seller
    form helper takes FLAT fields (form.fabric etc.), so map aiSpecs onto
    those — not a nested attributes object. */
export const cpmFromProduct = (product, { brand = '' } = {}) =>
  cpmFromSellerForm({
    sku: product?.sku || product?.id || '',
    brand,
    category: product?.category || '',
    productType: product?.category || product?.title || 'Apparel',
    fabric: product?.aiSpecs?.material,
    fit: product?.aiSpecs?.fit,
    color: Array.isArray(product?.aiSpecs?.colors) ? product.aiSpecs.colors[0] : '',
    care: product?.aiSpecs?.care,
    occasion: Array.isArray(product?.aiSpecs?.occasions) ? product.aiSpecs.occasions[0] : '',
  });

/**
 * Render one platform's CSV for a product.
 * Returns { filename, csv } — both pure functions of the inputs.
 */
export const platformExport = ({ platform, product, brand = '' }) => {
  if (!product || typeof product !== 'object') return null;
  const cpm = cpmFromProduct(product, { brand });
  const pack = renderPack(platform, cpm);
  const images = exportImageUrls(product);
  const price = String(product?.price ?? '');
  const qty = String(product?.qty ?? 1);
  const sizes = (product?.aiSpecs?.sizes || []).join(', ');
  const sku = (product?.sku || product?.id || '').replace(/[^A-Za-z0-9_-]/g, '');
  const id = `KAT-${(product?.id || 'product').slice(-8)}`;
  const bullets = pack.bullets || [];
  const b = (i) => bullets[i] || '';
  const imagesJoined = images.join(';');

  let head;
  let row;
  switch (platform) {
    case 'amazon':
      head = ['item_name', 'brand_name', 'feed_product_type', 'product_description',
        'bullet_point1', 'bullet_point2', 'bullet_point3', 'bullet_point4', 'bullet_point5',
        'standard_price', 'quantity', 'main_image_url', 'other_image_url'];
      row = [pack.title, brand, cpm.category || 'Apparel', pack.description || '',
        b(0), b(1), b(2), b(3), b(4), price, qty, images[0] || '', images.slice(1).join(' ')];
      break;
    case 'flipkart':
      head = ['Product ID', 'Title', 'Product Description', 'Brand', 'MRP', 'Selling Price',
        'HSN Code', 'Images (semicolon separated)', 'Category'];
      row = [id, pack.title, pack.description || '', brand, price, price, '',
        imagesJoined, cpm.category || ''];
      break;
    case 'meesho':
      head = ['Catalog Title', 'Brand', 'Category', 'Images (semicolon separated)',
        'Price', 'MRP', 'Description', 'Sizes (comma separated)', 'Colour'];
      row = [pack.title, brand, cpm.category || '', imagesJoined, price, price,
        pack.description || '', sizes, (product?.aiSpecs?.colors || []).join(', ')];
      break;
    case 'myntra':
      head = ['SKU', 'Product Name', 'Description', 'Category', 'Gender', 'MRP', 'Price',
        'Sizes', 'Colour', 'Material', 'Images (semicolon separated)'];
      row = [sku || id, pack.title, pack.description || '', cpm.category || '', 'Unisex',
        price, price, sizes, (product?.aiSpecs?.colors || []).join(', '),
        product?.aiSpecs?.material || '', imagesJoined];
      break;
    case 'alibaba':
      head = ['Product Name', 'Keywords', 'Category', 'MOQ', 'Price', 'Description',
        'Images (semicolon separated)', 'Brand'];
      row = [pack.title, pack.keywords || '', cpm.category || '', '1', price,
        pack.description || '', imagesJoined, brand];
      break;
    default:
      return null;
  }

  return {
    filename: `katalogit-${platform}-${sku || id}.csv`,
    csv: csvRow(head) + csvRow(row),
  };
};
