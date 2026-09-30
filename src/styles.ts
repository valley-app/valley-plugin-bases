import maplibreCss from 'maplibre-gl/dist/maplibre-gl.css'

const css = `
.base-surface { --base-row-height: 30px; --base-cell-padding: 8px; --base-font-size: var(--small-font-size, 0.8125rem); --base-border: var(--border-light, var(--border-medium));
  position:relative; display:flex; flex-direction:column; min-height:0; height:100%; color:var(--text-color); background:var(--surface-color-alt); font-size:var(--base-font-size); container-type:inline-size; }
.base-surface.is-embedded { height:auto; max-height:600px; box-sizing:border-box; border:1px solid var(--base-border); border-radius:var(--radius-sm); }
.base-source-editor { flex:1; min-height:0; display:flex; overflow:hidden; }
.base-source-editor > * { flex:1; min-width:0; min-height:0; }
.base-icon { flex:0 0 auto; display:block; }
.base-visually-hidden { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }
.base-cell-input[aria-invalid] { box-shadow:inset 0 0 0 1px var(--negative-color, var(--danger)); }
.base-empty { padding:var(--space-4, 16px); color:var(--text-secondary); }

/* Toolbar */
.base-header { flex:0 0 auto; border-bottom:1px solid var(--base-border); background:var(--surface-color-alt); }
.base-surface.is-embedded .base-header { background:var(--surface-color); border-radius:var(--radius-sm) var(--radius-sm) 0 0; }
.base-toolbar { display:flex; align-items:center; gap:4px; height:calc(var(--app-bar-height) - 1px); padding:0 8px; box-sizing:border-box; overflow:hidden; -webkit-app-region:no-drag; }
.base-toolbar-spacer { flex:1 1 auto; min-width:4px; }
.base-toolbar-button { flex:0 0 auto; display:inline-flex; align-items:center; gap:4px; height:28px; padding:0 6px; border:0; border-radius:var(--radius-sm); background:transparent;
  color:var(--text-secondary); font:inherit; font-size:var(--base-font-size); white-space:nowrap; cursor:pointer; }
.base-toolbar-button:hover, .base-toolbar-button:focus-visible { background:var(--hover-bg); color:var(--text-color); outline:none; }
.base-toolbar-button.is-active { color:var(--accent-color); }
.base-toolbar-button:disabled { opacity:.45; cursor:default; }
.base-toolbar-button:disabled:hover { background:transparent; color:var(--text-secondary); }
.base-toolbar-views { flex:0 1 auto; min-width:0; color:var(--text-color); font-weight:var(--font-medium, 500); }
.base-toolbar-views .base-toolbar-label { overflow:hidden; text-overflow:ellipsis; }
.base-toolbar-aux { color:var(--text-tertiary, var(--text-secondary)); margin-left:2px; }
.base-toolbar-count { flex:0 1 auto; min-width:0; color:var(--text-tertiary, var(--text-secondary)); font-size:var(--smaller-font-size, 0.75rem); padding:0 4px; }
.base-toolbar-count .base-toolbar-label { overflow:hidden; text-overflow:ellipsis; }
@container (width < 600px) { .base-toolbar-button:not(.base-toolbar-views):not(.base-toolbar-count) .base-toolbar-label { display:none; } }
.base-toolbar.is-compact .base-toolbar-button:not(.base-toolbar-views):not(.base-toolbar-count) .base-toolbar-label { display:none; }
.base-toolbar-count.is-active { color:var(--accent-color); }

.base-search-row { display:flex; flex:0 0 auto; align-items:center; gap:8px; height:var(--app-bar-height, 38px); box-sizing:border-box; padding:0 var(--search-field-inline-inset, 5px); border-bottom:1px solid var(--base-border); }
.base-search.search-field { flex:1 1 0; display:flex; align-items:center; min-width:0; width:auto; box-sizing:border-box; gap:var(--search-field-gap, 5px);
  height:var(--search-field-height, 31px); min-height:var(--search-field-height, 31px); max-height:var(--search-field-height, 31px); padding:0 var(--search-field-padding, 8px);
  border:1px solid var(--search-field-border, var(--border-medium)); border-radius:3px;
  background:var(--search-field-bg, var(--container-color-alt)); color:var(--search-field-text, var(--text-color)); font:inherit; }
.base-search.search-field:hover { border-color:var(--search-field-border-hover, var(--border-medium)); }
.base-search.search-field:focus-within { border-color:var(--search-field-focus, var(--accent-color)); outline:none; box-shadow:none; }
.base-search > .search-field-input, .base-search > .search-field-input:is(:hover, :focus, :focus-visible) { flex:1 1 0; min-width:0; width:0; height:100%; min-height:0; max-height:100%; box-sizing:border-box;
  margin:0; padding:0; border:0; border-radius:0; outline:none; box-shadow:none; appearance:none; background:transparent; color:inherit; font:inherit; line-height:normal; }
.base-search > .search-field-input::placeholder { color:var(--search-field-placeholder, var(--text-secondary)); opacity:1; }
.base-search > .search-field-icon { color:var(--search-field-placeholder, var(--text-secondary)); pointer-events:none; }
.base-search > .base-search-clear, .base-search > .base-search-clear:is(:focus, :focus-visible) { flex:0 0 20px; display:inline-flex; align-items:center; justify-content:center; width:20px; height:20px; min-height:0;
  margin:0; padding:0; border:0; outline:none; box-shadow:none; background:transparent; color:var(--text-secondary); cursor:pointer; border-radius:var(--radius-sm, 4px); }
.base-search > .base-search-clear:is(:hover, :focus-visible) { background:var(--hover-bg); color:var(--text-color); }
.base-search-count { color:var(--text-tertiary, var(--text-secondary)); font-size:var(--smaller-font-size, 0.75rem); white-space:nowrap; }
.base-error { padding:0 8px; color:var(--warning-color, var(--color-orange)); font-size:var(--small-font-size, 0.8125rem); text-align:center; user-select:text; }
.base-error p { margin:12px 0; }

/* Shared values */
.base-link { color:var(--markdown-internal-link, var(--accent-color)); text-decoration:none; cursor:pointer; }
.base-link:hover { text-decoration:underline; }
.base-link.is-unresolved { color:var(--markdown-unresolved-link, var(--accent-color)); opacity:.75; }
.base-link.is-external { color:var(--markdown-link, var(--accent-color)); }
.base-checkbox { width:14px; height:14px; margin:0; accent-color:var(--accent-color); cursor:pointer; }
.base-checkbox:disabled { cursor:default; opacity:1; }
.base-value-list { display:inline-flex; gap:6px; flex-wrap:nowrap; }
.base-value-number { font-variant-numeric:tabular-nums; }
.base-value-image { max-height:calc(var(--base-body-row-height, var(--base-row-height)) - 6px); max-width:100%; object-fit:contain; vertical-align:middle; }
.base-value-icon { display:inline-flex; color:var(--text-color); }
.base-tag, .base-pill.is-tag { color:var(--tint-violet-text, var(--accent-color)); background:var(--tint-violet-bg, var(--accent-soft-bg)); }
.base-tag { display:inline-flex; align-items:center; height:20px; padding:0 8px; border-radius:10px; font-size:var(--smaller-font-size, 0.75rem); }
.base-formula-error { display:inline-flex; align-items:center; gap:4px; min-width:0; color:var(--negative-color, var(--danger)); font-size:var(--smaller-font-size, 0.75rem);
  text-decoration:underline dotted; text-underline-offset:2px; }
.base-formula-error .base-icon { opacity:.6; }
.base-formula-error-message { overflow:hidden; text-overflow:ellipsis; }
.base-date-icon { display:inline-block; margin-right:4px; vertical-align:-2px; color:var(--text-tertiary, var(--text-secondary)); }

/* Property editors */
.base-cell-text { display:block; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.base-cell-text.is-number { text-align:right; font-variant-numeric:tabular-nums; }
.base-cell-text[data-invalid] { color:var(--negative-color, var(--danger)); }
.base-cell-input { width:100%; height:100%; min-height:calc(var(--base-row-height) - 2px); box-sizing:border-box; border:0; outline:none; padding:0 var(--base-cell-padding);
  background:var(--surface-color); color:var(--text-color); font:inherit; }
.base-cell-input.is-number { text-align:right; font-variant-numeric:tabular-nums; }
.base-pills { display:flex; align-items:center; gap:4px; flex-wrap:nowrap; min-width:0; overflow:hidden; }
.base-pill { display:inline-flex; align-items:center; gap:2px; height:20px; padding:0 4px 0 8px; border-radius:10px; background:var(--container-color-alt); color:var(--text-color);
  font-size:var(--smaller-font-size, 0.75rem); white-space:nowrap; flex:0 0 auto; }
.base-pill-remove { display:inline-flex; align-items:center; justify-content:center; width:16px; height:16px; border:0; border-radius:8px; padding:0; background:transparent;
  color:inherit; opacity:.55; cursor:pointer; }
.base-pill-remove:hover { opacity:1; background:var(--hover-bg); }
.base-pill-input { flex:1 0 60px; min-width:60px; height:20px; border:0; outline:none; background:transparent; color:var(--text-color); font:inherit; }

/* Table */
.base-view { position:relative; flex:1 1 auto; min-height:0; overflow:auto; scrollbar-gutter:stable; }
.base-table { position:relative; display:flex; flex-direction:column; min-width:100%; width:max-content; background:var(--container-color, var(--surface-color-alt)); }
.base-tr { display:grid; position:relative; width:100%; min-height:var(--base-row-height); background:var(--surface-color-alt); }
.base-td { position:relative; display:flex; align-items:center; min-width:0; height:var(--base-row-height); box-sizing:border-box;
  box-shadow:inset -1px 0 0 var(--base-border), inset 0 -1px 0 var(--base-border); white-space:nowrap; outline:none; }
.base-td:focus-visible, .base-td.is-editing { box-shadow:0 0 0 2px var(--accent-color); border-radius:2px; z-index:1; }
.base-row .base-td { height:var(--base-body-row-height, var(--base-row-height)); }
.is-multiline .base-row .base-td { align-items:flex-start; padding-top:5px; white-space:normal; }
.is-multiline .base-row .base-cell-text { white-space:normal; display:-webkit-box; -webkit-box-orient:vertical; overflow:hidden; }
.base-table-cell { display:flex; align-items:center; width:100%; min-width:0; height:100%; padding:0 var(--base-cell-padding); box-sizing:border-box; overflow:hidden; }
.is-multiline .base-row .base-table-cell { align-items:flex-start; }
.base-table-cell > * { min-width:0; }
.base-table-cell.is-number { justify-content:flex-end; text-align:right; }
.base-table-cell.is-checkbox { justify-content:center; }
.base-table-cell .base-value-text, .base-table-cell .base-link { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.base-tbody .base-row:hover { background:var(--hover-bg); }
.base-thead { position:sticky; top:0; z-index:3; background:var(--surface-color-alt); box-shadow:inset 0 -1px 0 var(--base-border); }
.base-th { cursor:default; user-select:none; }
.base-th:hover { background:var(--hover-bg); }
.base-th.is-dragging { opacity:.5; }
.base-table-header { display:flex; align-items:center; width:100%; min-width:0; height:100%; overflow:hidden; }
.base-th[data-sort] .base-table-header { -webkit-mask-image:linear-gradient(to left, transparent 24px, black 24px); mask-image:linear-gradient(to left, transparent 24px, black 24px); }
.base-table-header-label { display:flex; align-items:center; gap:4px; min-width:0; padding:0 var(--base-cell-padding); color:var(--text-secondary); font-weight:400; }
.base-table-header-icon { display:flex; align-items:center; color:var(--text-tertiary, var(--text-secondary)); }
.base-table-header-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.base-table-header-sort { position:absolute; right:0; top:0; height:100%; display:flex; align-items:center; padding-right:6px; color:var(--text-secondary); }
.base-column-resizer { position:absolute; right:-3px; top:0; bottom:0; width:6px; cursor:col-resize; z-index:4; touch-action:none; }
.base-column-resizer:hover, .base-column-resizer:focus-visible { background:var(--accent-color); opacity:.6; outline:none; }
.base-group-heading { display:flex; width:100%; align-items:baseline; gap:4px; height:var(--base-row-height); line-height:var(--base-row-height); padding:0 var(--base-cell-padding);
  position:sticky; left:0; box-sizing:border-box; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.base-group-property { color:var(--text-secondary); font-size:var(--smaller-font-size, 0.75rem); }
.base-group-value { font-weight:var(--font-semi-bold, 600); font-size:var(--base-font-size); overflow:hidden; text-overflow:ellipsis; }
.base-group-value .base-link { color:inherit; }
.base-table-group { padding-top:10px; }
.base-table-group:first-of-type { padding-top:0; }
.base-tr.base-group-summary-row { background:var(--container-color, var(--surface-color-alt)); }
.base-table-footer { position:sticky; bottom:0; z-index:2; background:var(--surface-color-alt); }
.base-table-footer .base-td { box-shadow:none; }
.base-summary-cell { display:flex; align-items:center; justify-content:flex-end; width:100%; height:100%; padding:0 var(--base-cell-padding) 0 2px; border:0; background:transparent;
  color:var(--text-secondary); font:inherit; cursor:pointer; overflow:hidden; }
.base-summary-cell:hover { background:var(--hover-bg); }
.base-summary-cell:disabled { cursor:default; }
.base-summary-content { display:flex; align-items:center; gap:6px; max-width:100%; overflow:hidden; white-space:nowrap; }
.base-summary-name { color:var(--text-tertiary, var(--text-secondary)); font-size:var(--smaller-font-size, 0.75rem); overflow:hidden; text-overflow:ellipsis; }
.base-summary-value { color:var(--text-color); }
.base-summary-placeholder { opacity:0; font-size:var(--smaller-font-size, 0.75rem); }
.base-summary-cell:hover .base-summary-placeholder { opacity:1; }

/* Cards */
.base-cards-view { padding:12px; }
.base-cards-grid { display:grid; gap:12px; }
.base-cards-group { padding-bottom:16px; }
.base-cards-group + .base-cards-group { padding-top:4px; border-top:1px solid var(--base-border); }
.base-cards-group .base-group-heading { position:static; padding:4px 0 8px; height:auto; line-height:1.4; }
.base-card { display:flex; flex-direction:column; min-width:0; overflow:hidden; border-radius:var(--radius, 8px); background:var(--surface-color); cursor:pointer;
  box-shadow:0 0 0 1px var(--base-border); transition:box-shadow var(--duration-fast, .12s) ease-in-out; }
.base-card:hover { box-shadow:0 0 0 1px var(--border-medium); }
.base-card-cover { position:relative; width:100%; overflow:hidden; background:var(--container-color, var(--container-color-alt)); }
.base-card-cover img { position:absolute; inset:0; width:100%; height:100%; }
.base-card-content { display:flex; flex-direction:column; gap:8px; padding:8px 0 2px; min-width:0; }
.base-card-title { padding:0 8px; height:24px; line-height:24px; color:var(--text-color); font-weight:var(--font-semi-bold, 600); font-size:var(--normal-font-size, 0.9375rem);
  text-decoration:none; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.base-card-title:hover { color:var(--markdown-internal-link, var(--accent-color)); }
.base-card-property { display:flex; flex-direction:column; min-width:0; }
.base-card-label { padding:0 8px; color:var(--text-secondary); font-size:var(--smaller-font-size, 0.75rem); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.base-card-value { height:24px; padding:0 8px; display:flex; align-items:center; min-width:0; overflow:hidden; }
.base-card-value .base-cell-text { white-space:nowrap; }
.base-card-value .base-cell-input { padding:0 4px; min-height:24px; border-radius:var(--radius-sm); }
.base-card .base-pill-remove { display:none; }
.base-card-empty { color:var(--text-tertiary, var(--text-secondary)); }

/* List */
.base-list-view { padding:12px 24px; }
.base-list { margin:0; padding-left:20px; line-height:1.45; }
.base-list-item { padding:1px 0; }
.base-list.is-none { list-style:none; padding-left:4px; }
.base-list.is-bullet { list-style:disc; }
.base-list-item::marker { color:var(--text-tertiary, var(--text-secondary)); }
.base-list-separator { color:var(--text-secondary); white-space:pre; }
.base-list-nested { margin:0; padding-left:28px; list-style:disc; border-left:1px solid var(--base-border); margin-left:-18px; padding-left:46px; }
.base-list-group + .base-list-group { margin-top:12px; }
.base-list-group .base-group-heading { position:static; padding:0; }

/* Map */
.base-map-view { overflow:hidden; min-height:200px; scrollbar-gutter:auto; }
.base-map-view .base-map { position:absolute; inset:0; }
.base-map-view .maplibregl-canvas { outline:none; }
.base-map-controls { position:absolute; top:10px; right:10px; display:flex; flex-direction:column; border:1px solid var(--base-border); border-radius:var(--radius-sm);
  overflow:hidden; background:var(--surface-color); box-shadow:var(--shadow-sm, none); z-index:2; }
.base-map-control { display:flex; align-items:center; justify-content:center; padding:7px; border:0; background:var(--container-color); color:var(--text-secondary); cursor:pointer; }
.base-map-control + .base-map-control { border-top:1px solid var(--base-border); }
.base-map-control:hover { color:var(--text-color); background:var(--hover-bg); }
.base-map-view .maplibregl-ctrl.maplibregl-ctrl-attrib { margin:0; padding:0 5px; background:var(--container-color); color:var(--text-secondary); font-size:var(--smaller-font-size, 0.75rem); }
.base-map-view .maplibregl-ctrl.maplibregl-ctrl-attrib.maplibregl-compact { min-height:20px; margin:10px; padding:2px 24px 2px 0; display:flex; align-items:center; box-sizing:content-box;
  border-radius:12px; background:color-mix(in srgb, var(--container-color) 20%, transparent); color:var(--text-tertiary, var(--text-secondary)); }
.base-map-view .maplibregl-ctrl.maplibregl-ctrl-attrib.maplibregl-compact-show { padding:2px 28px 2px 8px; }
.base-map-view.is-dark .maplibregl-ctrl-attrib-button { filter:invert(1); }
.base-map-view .maplibregl-ctrl-attrib a { color:inherit; text-decoration:none; }
.base-map-view .maplibregl-ctrl-attrib a:hover { text-decoration:underline; }
.base-map-popup { min-width:200px; max-width:300px; }
.base-map-popup .maplibregl-popup-content { padding:0; border:1px solid var(--menu-border, var(--border-medium)); border-radius:var(--radius, 8px);
  background:var(--container-color); color:var(--text-color); box-shadow:var(--shadow-popover, 0 4px 16px rgba(0,0,0,.2)); }
.base-map-popup.maplibregl-popup-anchor-bottom .maplibregl-popup-tip { border-top-color:var(--container-color); }
.base-map-popup.maplibregl-popup-anchor-top .maplibregl-popup-tip { border-bottom-color:var(--container-color); }
.base-map-popup.maplibregl-popup-anchor-left .maplibregl-popup-tip { border-right-color:var(--container-color); }
.base-map-popup.maplibregl-popup-anchor-right .maplibregl-popup-tip { border-left-color:var(--container-color); }
.base-map-popup-title { padding:8px; font-size:var(--normal-font-size, 0.875rem); font-weight:var(--font-semi-bold, 600); }
.base-map-popup-title a { color:var(--text-color); text-decoration:none; }
.base-map-popup-title a:hover { color:var(--accent-color); }
.base-map-popup-properties { display:flex; flex-direction:column; gap:8px; }
.base-map-popup-property { font-size:var(--small-font-size, 0.8125rem); }
.base-map-popup-property:last-child { padding-bottom:8px; }
.base-map-popup-property-label { padding:0 8px; font-size:var(--smaller-font-size, 0.75rem); color:var(--text-secondary); }
.base-map-popup-property-value { padding:0 8px; color:var(--text-color); word-break:break-word; }

/* Popovers and menus */
.base-popover { --base-border:var(--border-light, var(--border-medium)); box-sizing:border-box; padding:0;
  color:var(--menu-text, var(--text-color)); font-size:var(--small-font-size, 0.8125rem); }
.base-menu { display:flex; flex-direction:column; gap:2px; }
.base-menu-search.search-field { flex:0 0 auto; margin:0 0 4px; }
.base-menu-empty { padding:12px 8px; color:var(--text-secondary); text-align:center; }
.base-menu-section { display:flex; flex-direction:column; gap:1px; }
.base-properties-list { max-height:60vh; overflow:auto; }
.base-menu-section-title { padding:6px 8px 2px; color:var(--text-color); font-weight:var(--font-semi-bold, 600); }
.base-menu-separator { height:1px; margin:4px 2px; background:var(--base-border); }
.base-menu-row { display:flex; align-items:center; gap:2px; border-radius:var(--radius-sm); }
.base-menu-row.is-active, .base-menu-row:hover { background:var(--menu-hover-bg, var(--hover-bg)); }
.base-menu-row[data-drop-target] { box-shadow:inset 0 2px 0 var(--accent-color); }
.base-menu-row.is-hidden .base-menu-item-label, .base-menu-row.is-hidden .base-icon { color:var(--text-tertiary, var(--text-secondary)); }
.base-menu-item { display:flex; align-items:center; gap:8px; flex:1; min-width:0; min-height:28px; padding:0 8px; border:0; border-radius:var(--radius-sm);
  background:transparent; color:inherit; font:inherit; text-align:left; cursor:pointer; }
.base-menu-row .base-menu-item:hover { background:transparent; }
.base-menu-item:hover { background:var(--menu-hover-bg, var(--hover-bg)); }
.base-menu-item:disabled { opacity:.45; cursor:default; background:transparent; }
.base-menu-item.is-danger { color:var(--negative-color, var(--danger)); }
.base-menu-item .base-icon { color:var(--text-secondary); }
.base-menu-item-label { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.base-menu-header { display:flex; align-items:center; gap:4px; padding:2px 2px 4px; border-bottom:1px solid var(--base-border); margin-bottom:4px; }
.base-menu-title { font-weight:var(--font-semi-bold, 600); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.base-icon-button { display:inline-flex; align-items:center; justify-content:center; flex:0 0 auto; width:26px; height:26px; border:0; border-radius:var(--radius-sm);
  background:transparent; color:var(--text-secondary); cursor:pointer; }
.base-icon-button:hover { background:var(--hover-bg); color:var(--text-color); }
.base-icon-button:disabled { opacity:.35; cursor:default; background:transparent; }
.base-icon-button.is-back .base-icon { transform:rotate(180deg); }
.base-option { display:flex; align-items:center; justify-content:space-between; gap:8px; min-height:32px; padding:2px 8px; }
.base-option.is-stacked { flex-direction:column; align-items:stretch; }
.base-option-label { color:var(--text-color); white-space:nowrap; }
.base-option-input { width:130px; height:26px; box-sizing:border-box; padding:0 8px; border:1px solid var(--control-border, var(--border-medium)); border-radius:var(--control-radius, var(--radius-sm));
  background:var(--control-bg, var(--container-color-alt)); color:var(--control-text, var(--text-color)); font:inherit; outline:none; }
.base-option-input:focus { border-color:var(--control-focus-border, var(--accent-color)); }
.base-option-input[aria-invalid] { border-color:var(--control-invalid-border, var(--danger)); }
.base-results-menu .base-option { flex-direction:column; align-items:stretch; }
.base-results-menu .base-option-input { width:100%; }
.base-option-error { padding:0 8px 4px; color:var(--negative-color, var(--danger)); font-size:var(--smaller-font-size, 0.75rem); }
.base-option-slider { display:flex; align-items:center; gap:6px; }
.base-option-slider input { width:100px; accent-color:var(--accent-color); }
.base-option-value { min-width:28px; text-align:right; color:var(--text-secondary); font-variant-numeric:tabular-nums; }
.base-toggle { accent-color:var(--accent-color); }
.base-formula-input { width:100%; box-sizing:border-box; padding:6px 8px; border:1px solid var(--control-border, var(--border-medium)); border-radius:var(--control-radius, var(--radius-sm));
  background:var(--control-bg, var(--container-color-alt)); color:var(--text-color); font-family:var(--mono-font, monospace); font-size:var(--smaller-font-size, 0.75rem); resize:vertical; outline:none; }
.base-picker { display:inline-flex; align-items:center; gap:4px; height:28px; min-width:0; padding:0 6px 0 8px; border:0; border-radius:var(--radius-sm); background:transparent;
  color:var(--text-color); font:inherit; cursor:pointer; white-space:nowrap; }
.base-picker:hover { background:var(--hover-bg); }
.base-picker:disabled { cursor:default; opacity:.6; }
.base-picker.is-placeholder .base-picker-label { color:var(--text-tertiary, var(--text-secondary)); }
.base-picker-label { overflow:hidden; text-overflow:ellipsis; }
.base-picker-chevron { color:var(--text-tertiary, var(--text-secondary)); }
.base-picker-group { display:flex; align-items:center; flex:1; min-width:0; border:1px solid var(--base-border); border-radius:var(--radius-sm); background:var(--container-color-alt); }
.base-picker-group > .base-picker:first-child { flex:1; justify-content:flex-start; }
.base-picker-group > .base-picker + .base-picker { border-left:1px solid var(--base-border); border-radius:0 var(--radius-sm) var(--radius-sm) 0; }
.base-sort-menu .base-sort-row { display:flex; align-items:center; gap:4px; padding:2px 4px; }
.base-sort-row[data-drop-target] { box-shadow:inset 0 2px 0 var(--accent-color); }
.base-grip { display:flex; color:var(--text-tertiary, var(--text-secondary)); cursor:grab; }
.base-filter-section-header { display:flex; align-items:center; gap:6px; width:100%; height:32px; padding:0 6px; border:0; border-radius:var(--radius-sm); background:transparent;
  color:var(--text-color); font:inherit; font-weight:var(--font-semi-bold, 600); cursor:pointer; }
.base-filter-section-header:hover { background:var(--hover-bg); }
.base-filter-section + .base-filter-section { border-top:1px solid var(--base-border); margin-top:2px; padding-top:2px; }
.base-badge { display:inline-flex; align-items:center; justify-content:center; min-width:16px; height:16px; padding:0 4px; border-radius:4px; background:var(--container-color-alt);
  color:var(--text-secondary); font-size:var(--smaller-font-size, 0.6875rem); font-weight:400; }
.base-filter-group { display:flex; flex-direction:column; gap:4px; padding:4px 4px 6px; }
.base-filter-group.is-nested { margin:2px 0 2px 0; border:1px solid var(--base-border); border-radius:var(--radius-sm); background:var(--container-color, transparent); }
.base-filter-group-header { display:flex; align-items:center; justify-content:space-between; }
.base-filter-row { display:flex; align-items:center; gap:4px; }
.base-filter-conjunction { flex:0 0 44px; text-align:right; padding-right:4px; color:var(--text-secondary); }
.base-filter-fields { display:flex; align-items:center; flex:1; min-width:0; height:30px; border:1px solid var(--base-border); border-radius:var(--radius-sm); background:var(--container-color-alt); }
.base-filter-fields > .base-picker { flex:0 1 auto; }
.base-filter-fields > * + * { border-left:1px solid var(--base-border) !important; border-radius:0; }
.base-filter-value, .base-filter-advanced { flex:1; min-width:0; height:100%; box-sizing:border-box; padding:0 8px; border:0; outline:none; background:transparent; color:var(--text-color); font:inherit; }
.base-filter-advanced { font-family:var(--mono-font, monospace); font-size:var(--smaller-font-size, 0.75rem); }
.base-filter-actions { display:flex; gap:4px; padding-left:48px; }
.base-filter-actions .base-menu-item { flex:0 0 auto; color:var(--text-secondary); }
` + maplibreCss

export default css
