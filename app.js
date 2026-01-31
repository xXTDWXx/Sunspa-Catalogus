// Productcatalogus (GitHub Pages) — ES module
// Data: ./products.json (same folder as index.html)

const el = (sel, root = document) => root.querySelector(sel);
const els = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const fmtPrice = (p) => {
  if (p === null || p === undefined || p === "") return "—";
  const n = Number(p);
  if (!Number.isFinite(n)) return String(p);
  try {
    return new Intl.NumberFormat("nl-BE", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return "€ " + Math.round(n);
  }
};

const safeText = (s) => (s == null ? "" : String(s));

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[c]));
}
function escapeAttr(str) {
  return escapeHtml(str).replace(/`/g, "&#096;");
}

async function loadProducts() {
  const url = new URL("../products.json", import.meta.url); // van /assets/app.js naar /products.json
  const res = await fetch(url, { cache: "no-store" });

  if (!res.ok) throw new Error(`Kan products.json niet laden (HTTP ${res.status})`);

  const data = await res.json();
  if (!Array.isArray(data)) throw new Error("products.json heeft geen array als root");
  return data;
}



function buildSearchIndex(products) {
  const idx = new Map();
  for (const p of products) {
    const parts = [
      p.id, p.type, p.title, p.url,
      ...(p.bullets || []),
      ...(p.specs || []).flatMap(s => [s.label, s.value]),
    ].map(safeText).join(" ").toLowerCase();
    idx.set(p.id, parts);
  }
  return idx;
}

function getTypes(products) {
  const set = new Set(products.map(p => p.type).filter(Boolean));
  return Array.from(set).sort((a, b) => String(a).localeCompare(String(b)));
}

function getStats(list) {
  const prices = list.map(p => Number(p.price)).filter(Number.isFinite);
  const min = prices.length ? Math.min(...prices) : null;
  const max = prices.length ? Math.max(...prices) : null;
  return { count: list.length, min, max };
}

function showFatalError(err) {
  const msg = (err && err.message) ? err.message : String(err);
  document.body.innerHTML = `
    <div style="max-width:900px;margin:24px auto;padding:18px;color:#fff;font-family:ui-sans-serif,system-ui">
      <h2 style="margin:0 0 10px">Kon de catalogus niet laden</h2>
      <p style="opacity:.8;margin:0 0 10px">Controleer of <code>products.json</code> in de root staat en bereikbaar is via GitHub Pages.</p>
      <pre style="background:rgba(0,0,0,.35);padding:12px;border-radius:12px;overflow:auto">${escapeHtml(msg)}</pre>
    </div>`;
}

function initUI(PRODUCTS) {
  const SEARCH_INDEX = buildSearchIndex(PRODUCTS);

  const state = { q: "", type: "all", min: "", max: "", sort: "relevance" };

  // Modal elements
  const modalBackdrop = el("#modalBackdrop");
  const modalTitle = el("#modalTitle");
  const modalType = el("#modalType");
  const modalPrice = el("#modalPrice");
  const modalLink = el("#modalLink");
  const modalImage = el("#modalImage");
  const modalSpecs = el("#modalSpecs");

  const openModal = (id) => {
    const p = PRODUCTS.find((x) => x.id === id);
    if (!p) return;

    modalTitle.textContent = p.title || p.id;
    modalType.textContent = p.type || "";
    modalPrice.textContent = Number.isFinite(Number(p.price)) ? fmtPrice(p.price) : "—";

    if (p.url) {
      modalLink.style.display = "";
      modalLink.href = p.url;
    } else {
      modalLink.style.display = "none";
      modalLink.href = "#";
    }

    modalImage.innerHTML = p.image
      ? `<img alt="${escapeHtml(p.title)}" src="${escapeAttr(p.image)}" />`
      : `<div class="fallback">Geen afbeelding</div>`;

    const rows = (p.specs || [])
      .map((s) => {
        const label = escapeHtml(s.label || "");
        const value = escapeHtml(s.value || "");
        return `<tr><th>${label}</th><td>${value}</td></tr>`;
      })
      .join("");

    modalSpecs.innerHTML = rows ? rows : `<tr><th>Specs</th><td>Geen specs</td></tr>`;

    modalBackdrop.classList.add("open");
    document.body.style.overflow = "hidden";
  };

  const closeModal = () => {
    modalBackdrop.classList.remove("open");
    document.body.style.overflow = "";
  };

  el("#closeModal").addEventListener("click", closeModal);
  modalBackdrop.addEventListener("click", (e) => { if (e.target === modalBackdrop) closeModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

  // Filtering + rendering
  const applyFilters = () => {
    let list = PRODUCTS.slice();

    if (state.type !== "all") list = list.filter((p) => p.type === state.type);

    const q = state.q.trim().toLowerCase();
    if (q) list = list.filter((p) => (SEARCH_INDEX.get(p.id) || "").includes(q));

    const min = state.min === "" ? null : Number(state.min);
    const max = state.max === "" ? null : Number(state.max);

    if (Number.isFinite(min)) list = list.filter((p) => Number.isFinite(Number(p.price)) && Number(p.price) >= min);
    if (Number.isFinite(max)) list = list.filter((p) => Number.isFinite(Number(p.price)) && Number(p.price) <= max);

    if (state.sort === "price_asc") {
      list.sort((a, b) => (Number(a.price) || Infinity) - (Number(b.price) || Infinity));
    } else if (state.sort === "price_desc") {
      list.sort((a, b) => (Number(b.price) || -Infinity) - (Number(a.price) || -Infinity));
    } else if (state.sort === "title") {
      list.sort((a, b) => safeText(a.title).localeCompare(safeText(b.title), "nl"));
    }

    return list;
  };

  const renderBadges = (list) => {
    const stats = getStats(list);
    el("#badgeCount").textContent = String(stats.count);
    el("#badgeMin").textContent = stats.min == null ? "—" : fmtPrice(stats.min);
    el("#badgeMax").textContent = stats.max == null ? "—" : fmtPrice(stats.max);
  };

  const cardHTML = (p) => {
    const img = p.image
      ? `<img alt="${escapeHtml(p.title)}" src="${escapeAttr(p.image)}" loading="lazy" />`
      : `<div class="fallback">Geen afbeelding</div>`;

    const price = Number.isFinite(Number(p.price)) ? fmtPrice(p.price) : "—";

    const jets = (p.specs || []).find((s) => safeText(s.label).toLowerCase().includes("aantal jets"))?.value;
    const persons = (p.specs || []).find((s) => safeText(s.label).toLowerCase().includes("aantal personen"))?.value;

    const metaBits = [
      `<span class="pill">${escapeHtml(p.type || "")}</span>`,
      jets ? `<span class="pill">${escapeHtml(jets)}</span>` : "",
      persons ? `<span class="pill">${escapeHtml(persons)}</span>` : "",
    ].filter(Boolean).join("");

    return `
      <div class="card" data-id="${escapeAttr(p.id)}">
        <div class="thumb">${img}</div>
        <div class="content">
          <div class="topline">
            <div>
              <h3 class="title">${escapeHtml(p.title || p.id)}</h3>
              <div class="meta">${metaBits}</div>
            </div>
            <div class="price">${escapeHtml(price)}</div>
          </div>
          <div class="actions">
            <button class="btn primary" data-open="${escapeAttr(p.id)}">Details</button>
            ${p.url ? `<a class="btn link" href="${escapeAttr(p.url)}" target="_blank" rel="noreferrer">Website</a>` : `<span class="small">—</span>`}
          </div>
        </div>
      </div>
    `;
  };

  const renderList = () => {
    const list = applyFilters();
    renderBadges(list);

    const grid = el("#grid");
    if (!list.length) {
      grid.innerHTML = `<div class="empty">Geen resultaten. Pas filters aan of wis je zoekterm.</div>`;
      return;
    }
    grid.innerHTML = list.map(cardHTML).join("");

    els("[data-open]").forEach((btn) => btn.addEventListener("click", () => openModal(btn.getAttribute("data-open"))));
    els(".card").forEach((card) => {
      card.addEventListener("click", (e) => {
        const t = e.target;
        if (t && (t.closest("button") || t.closest("a"))) return;
        const id = card.getAttribute("data-id");
        if (id) openModal(id);
      });
    });
  };

  // Controls
  const typeSel = el("#type");
  const sortSel = el("#sort");
  const qInput = el("#q");
  const minInput = el("#min");
  const maxInput = el("#max");
  const clearBtn = el("#clear");

  // Fill type select
  const types = getTypes(PRODUCTS);
  typeSel.innerHTML =
    `<option value="all">Alle types</option>` +
    types.map((t) => `<option value="${escapeAttr(t)}">${escapeHtml(t)}</option>`).join("");

  // Bind events
  const syncFromUI = () => {
    state.type = typeSel.value;
    state.sort = sortSel.value;
    state.q = qInput.value;
    state.min = minInput.value;
    state.max = maxInput.value;
    renderList();
  };

  [typeSel, sortSel, minInput, maxInput].forEach((ctrl) => ctrl.addEventListener("change", syncFromUI));
  qInput.addEventListener("input", syncFromUI);

  clearBtn.addEventListener("click", () => {
    typeSel.value = "all";
    sortSel.value = "relevance";
    qInput.value = "";
    minInput.value = "";
    maxInput.value = "";
    syncFromUI();
    qInput.focus();
  });

  // Init counters + first render
  el("#totalAll").textContent = String(PRODUCTS.length);
  renderList();
}

(async function main() {
  try {
    const products = await loadProducts();
    initUI(products);
  } catch (err) {
    showFatalError(err);
    // eslint-disable-next-line no-console
    console.error(err);
  }
})();
