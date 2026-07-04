/**
 * DemoForge site generator — static asset generation.
 *
 * Generates vanilla CSS and JS files for the site:
 * - site.css: themeable styles with light/dark mode
 * - site.js: theme toggle, search, tag filtering, copy-to-clipboard, video format switching
 */

import { writeFileSync } from "node:fs";
import type { SiteConfig } from "./site-generator.js";

export function generateStaticAssets(cssDir: string, jsDir: string, config: SiteConfig): void {
  const css = generateCss(config);
  const js = generateJs(config);

  writeFileSync(`${cssDir}/site.css`, css, "utf-8");
  writeFileSync(`${jsDir}/site.js`, js, "utf-8");
}

function generateCss(config: SiteConfig): string {
  const { colors, fonts } = config.theme;
  const c = colors;

  return `/* DemoForge Site Styles — ${config.theme.mode} theme */
:root {
  --primary: ${c.primary};
  --bg: ${c.bg};
  --text: ${c.text};
  --card-bg: ${c.cardBg || c.bg};
  --card-border: ${c.cardBorder || "#e2e8f0"};
  --header-bg: ${c.headerBg || "#f1f5f9"};
  --footer-bg: ${c.footerBg || "#f1f5f9"};
  --muted: ${c.muted || "#64748b"};
  --accent: ${c.accent || "#f59e0b"};
  --font-heading: ${fonts.heading};
  --font-body: ${fonts.body};
  --radius: 8px;
  --shadow: 0 1px 3px rgba(0,0,0,0.1);
  --shadow-lg: 0 4px 12px rgba(0,0,0,0.15);
  --transition: 0.2s ease;
}

[data-theme="dark"] {
  --bg: #0f172a;
  --text: #e2e8f0;
  --card-bg: #1e293b;
  --card-border: #334155;
  --header-bg: #1e293b;
  --footer-bg: #1e293b;
  --muted: #94a3b8;
  --shadow: 0 1px 3px rgba(0,0,0,0.4);
  --shadow-lg: 0 4px 12px rgba(0,0,0,0.5);
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: var(--font-body);
  background: var(--bg);
  color: var(--text);
  line-height: 1.6;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  transition: background var(--transition), color var(--transition);
}

.container { max-width: 1200px; margin: 0 auto; padding: 0 1.5rem; }

/* Header */
.site-header {
  background: var(--header-bg);
  padding: 1.5rem 0;
  border-bottom: 1px solid var(--card-border);
}

.site-title {
  font-family: var(--font-heading);
  font-size: 1.75rem;
  font-weight: 700;
  color: var(--primary);
  margin-bottom: 0.25rem;
}

.site-description { color: var(--muted); font-size: 0.95rem; margin-bottom: 1rem; }

.header-controls {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}

/* Search */
.search-container {
  position: relative;
  flex: 1;
  max-width: 360px;
}

.search-input {
  width: 100%;
  padding: 0.5rem 0.75rem 0.5rem 2.25rem;
  border: 1px solid var(--card-border);
  border-radius: var(--radius);
  background: var(--bg);
  color: var(--text);
  font-size: 0.9rem;
  outline: none;
  transition: border-color var(--transition);
}

.search-input:focus { border-color: var(--primary); }

.search-icon {
  position: absolute;
  left: 0.65rem;
  top: 50%;
  transform: translateY(-50%);
  color: var(--muted);
  pointer-events: none;
}

/* Theme toggle */
.theme-toggle {
  background: none;
  border: 1px solid var(--card-border);
  border-radius: var(--radius);
  padding: 0.4rem;
  cursor: pointer;
  color: var(--text);
  display: flex;
  align-items: center;
  gap: 0.25rem;
  transition: background var(--transition);
}

.theme-toggle:hover { background: var(--card-border); }
.sun-icon { display: none; }
.moon-icon { display: block; }
[data-theme="dark"] .sun-icon { display: block; }
[data-theme="dark"] .moon-icon { display: none; }

/* Tag filters */
.tag-filters, .flow-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

.tag-filter {
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: 20px;
  padding: 0.25rem 0.75rem;
  font-size: 0.8rem;
  color: var(--text);
  cursor: pointer;
  transition: all var(--transition);
}

.tag-filter:hover, .tag-filter.active {
  background: var(--primary);
  color: #fff;
  border-color: var(--primary);
}

.tag {
  display: inline-block;
  background: var(--header-bg);
  border: 1px solid var(--card-border);
  border-radius: 20px;
  padding: 0.1rem 0.6rem;
  font-size: 0.75rem;
  color: var(--muted);
}

/* Flow grid */
.flow-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 1.5rem;
  padding: 2rem 0;
}

.flow-card {
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: var(--radius);
  overflow: hidden;
  transition: transform var(--transition), box-shadow var(--transition);
}

.flow-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-lg);
}

.flow-card.hidden { display: none; }

.flow-thumbnail {
  position: relative;
  aspect-ratio: 16/9;
  background: var(--header-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.flow-thumbnail img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.flow-thumbnail-placeholder {
  color: var(--muted);
  display: flex;
  align-items: center;
  justify-content: center;
}

.flow-thumbnail svg { width: 48px; height: 48px; }

.flow-duration {
  position: absolute;
  bottom: 0.5rem;
  right: 0.5rem;
  background: rgba(0,0,0,0.75);
  color: #fff;
  padding: 0.15rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
}

.flow-info { padding: 1rem; }

.flow-title {
  font-family: var(--font-heading);
  font-size: 1.1rem;
  margin-bottom: 0.5rem;
}

.flow-title a {
  color: var(--text);
  text-decoration: none;
}

.flow-title a:hover { color: var(--primary); }

.flow-description {
  color: var(--muted);
  font-size: 0.9rem;
  margin-bottom: 0.75rem;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.flow-link {
  display: inline-block;
  color: var(--primary);
  text-decoration: none;
  font-size: 0.9rem;
  font-weight: 500;
}

.flow-link:hover { text-decoration: underline; }

/* Flow page layout */
.flow-layout {
  display: grid;
  grid-template-columns: 1fr 280px;
  gap: 2rem;
  padding: 2rem 0;
}

@media (max-width: 768px) {
  .flow-layout { grid-template-columns: 1fr; }
  .flow-grid { grid-template-columns: 1fr; }
}

.breadcrumb { margin-bottom: 0.5rem; }
.breadcrumb a { color: var(--primary); text-decoration: none; }
.breadcrumb a:hover { text-decoration: underline; }

.flow-page-title {
  font-family: var(--font-heading);
  font-size: 1.5rem;
  margin-bottom: 0.5rem;
}

/* Video */
.video-container { position: relative; background: #000; border-radius: var(--radius); overflow: hidden; }

.video-controls {
  display: flex;
  gap: 0.5rem;
  padding: 0.5rem;
  background: var(--card-bg);
}

.format-btn {
  background: var(--header-bg);
  border: 1px solid var(--card-border);
  border-radius: 4px;
  padding: 0.2rem 0.6rem;
  font-size: 0.75rem;
  color: var(--text);
  cursor: pointer;
  transition: all var(--transition);
}

.format-btn.active, .format-btn:hover {
  background: var(--primary);
  color: #fff;
  border-color: var(--primary);
}

.video-player {
  width: 100%;
  max-height: 500px;
  display: block;
}

.video-placeholder {
  aspect-ratio: 16/9;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--muted);
  gap: 0.5rem;
}

.video-placeholder svg { width: 64px; height: 64px; }

/* Metadata */
.flow-metadata {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 1rem;
  margin-top: 1.5rem;
  padding: 1rem;
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: var(--radius);
}

.metadata-item { text-align: center; }
.metadata-label { display: block; font-size: 0.75rem; color: var(--muted); text-transform: uppercase; }
.metadata-value { font-weight: 600; font-size: 0.95rem; }

/* Effects */
.effects-section { margin-top: 1.5rem; }
.effects-section h3 { font-size: 1rem; margin-bottom: 0.75rem; }
.effects-list { list-style: none; display: flex; flex-wrap: wrap; gap: 0.5rem; }
.effect-badge {
  display: inline-block;
  padding: 0.25rem 0.75rem;
  border-radius: 20px;
  font-size: 0.8rem;
  font-weight: 500;
}
.effect-zoom { background: #dbeafe; color: #1d4ed8; }
.effect-dim { background: #fef3c7; color: #92400e; }
.effect-callout { background: #d1fae5; color: #065f46; }
[data-theme="dark"] .effect-zoom { background: #1e3a5f; color: #93c5fd; }
[data-theme="dark"] .effect-dim { background: #451a03; color: #fcd34d; }
[data-theme="dark"] .effect-callout { background: #064e3b; color: #6ee7b7; }

/* Timeline */
.step-timeline { padding: 1rem 0 3rem; }
.step-timeline h2 { font-family: var(--font-heading); font-size: 1.25rem; margin-bottom: 1.5rem; }

.timeline { position: relative; padding-left: 2rem; }

.timeline::before {
  content: "";
  position: absolute;
  left: 0.75rem;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--card-border);
}

.timeline-item {
  position: relative;
  padding: 1rem 0 1.5rem 1rem;
  border-left: 2px solid transparent;
  transition: border-color var(--transition);
}

.timeline-item:hover { border-left-color: var(--primary); }

.timeline-marker {
  position: absolute;
  left: -2rem;
  top: 1rem;
  width: 1.5rem;
  height: 1.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

.timeline-number {
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 50%;
  background: var(--primary);
  color: #fff;
  font-size: 0.7rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  position: absolute;
  left: 0;
  transform: translateX(-50%);
}

.timeline-icon { font-size: 1rem; }

.timeline-content { padding-left: 0.5rem; }

.timeline-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.25rem;
}

.timeline-type {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--primary);
  text-transform: uppercase;
}

.timeline-screenshot img {
  width: 60px;
  height: 40px;
  object-fit: cover;
  border-radius: 4px;
  border: 1px solid var(--card-border);
}

.timeline-description { font-size: 0.9rem; color: var(--text); }

.timeline-narration {
  margin-top: 0.5rem;
  padding: 0.5rem 0.75rem;
  background: var(--header-bg);
  border-radius: var(--radius);
  font-size: 0.85rem;
  color: var(--muted);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.copy-btn {
  background: var(--primary);
  color: #fff;
  border: none;
  border-radius: 4px;
  padding: 0.2rem 0.5rem;
  font-size: 0.75rem;
  cursor: pointer;
  white-space: nowrap;
  transition: opacity var(--transition);
}

.copy-btn:hover { opacity: 0.85; }

/* Sidebar */
.flow-sidebar { position: sticky; top: 1rem; align-self: start; }
.flow-summary {
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: var(--radius);
  padding: 1rem;
}
.flow-summary h3 { font-size: 1rem; margin-bottom: 0.5rem; }
.flow-summary p { font-size: 0.9rem; color: var(--muted); margin-bottom: 1rem; }

.flow-stats { display: flex; gap: 1rem; }
.stat { font-size: 0.8rem; color: var(--muted); }

/* Empty state */
.empty-state {
  text-align: center;
  padding: 3rem;
  color: var(--muted);
  font-size: 1rem;
}

/* Footer */
.site-footer {
  margin-top: auto;
  background: var(--footer-bg);
  padding: 1rem 0;
  border-top: 1px solid var(--card-border);
  text-align: center;
  font-size: 0.85rem;
  color: var(--muted);
}

.site-footer a { color: var(--primary); text-decoration: none; }
.site-footer a:hover { text-decoration: underline; }

/* Toast notification */
.toast {
  position: fixed;
  bottom: 1.5rem;
  right: 1.5rem;
  background: var(--primary);
  color: #fff;
  padding: 0.75rem 1.25rem;
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  font-size: 0.9rem;
  z-index: 1000;
  opacity: 0;
  transform: translateY(1rem);
  transition: opacity 0.2s, transform 0.2s;
  pointer-events: none;
}

.toast.show {
  opacity: 1;
  transform: translateY(0);
}
`;
}

function generateJs(_config: SiteConfig): string {
  return `"use strict";

/* DemoForge Site — Vanilla JS (no framework) */

(function() {
  // ─── Theme Toggle ───────────────────────────────────────────────────────────
  const themeToggle = document.getElementById("themeToggle");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  let currentTheme = localStorage.getItem("demoforge-theme") || document.documentElement.getAttribute("data-theme") || (prefersDark ? "dark" : "light");

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("demoforge-theme", theme);
  }

  applyTheme(currentTheme);

  if (themeToggle) {
    themeToggle.addEventListener("click", function() {
      currentTheme = currentTheme === "dark" ? "light" : "dark";
      applyTheme(currentTheme);
    });
  }

  // ─── Search ─────────────────────────────────────────────────────────────────
  var searchInput = document.getElementById("searchInput");
  if (searchInput) {
    searchInput.addEventListener("input", function() {
      searchFlows(this.value);
    });
  }

  function searchFlows(query) {
    var cards = document.querySelectorAll(".flow-card");
    var q = query.toLowerCase().trim();
    cards.forEach(function(card) {
      var name = card.getAttribute("data-name").toLowerCase();
      var tags = card.getAttribute("data-tags").toLowerCase();
      if (!q || name.includes(q) || tags.includes(q)) {
        card.classList.remove("hidden");
      } else {
        card.classList.add("hidden");
      }
    });
  }

  // ─── Tag Filter ─────────────────────────────────────────────────────────────
  function filterByTag(tag) {
    var cards = document.querySelectorAll(".flow-card");
    var buttons = document.querySelectorAll(".tag-filter");
    buttons.forEach(function(btn) {
      btn.classList.toggle("active", btn.getAttribute("data-tag") === tag);
    });
    cards.forEach(function(card) {
      var tags = card.getAttribute("data-tags").split(",").map(function(t) { return t.trim(); });
      if (!tag || tags.includes(tag)) {
        card.classList.remove("hidden");
      } else {
        card.classList.add("hidden");
      }
    });
  }
  window.filterByTag = filterByTag;

  // ─── Video Format Switching ─────────────────────────────────────────────────
  function switchFormat(format) {
    var videos = document.querySelectorAll(".video-player");
    var buttons = document.querySelectorAll(".format-btn");
    videos.forEach(function(v) { v.style.display = v.classList.contains("video-" + format) ? "block" : "none"; });
    buttons.forEach(function(b) { b.classList.toggle("active", b.getAttribute("data-format") === format); });
  }
  window.switchFormat = switchFormat;

  // ─── Copy Text ──────────────────────────────────────────────────────────────
  function copyText(btn, text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function() {
        showToast("Copied to clipboard");
        btn.textContent = "Copied!";
        setTimeout(function() { btn.textContent = "Copy"; }, 2000);
      });
    } else {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      showToast("Copied to clipboard");
      btn.textContent = "Copied!";
      setTimeout(function() { btn.textContent = "Copy"; }, 2000);
    }
  }
  window.copyText = copyText;

  function copyFromDataAttr(btn) {
    var text = btn.getAttribute("data-text") || "";
    copyText(btn, text);
  }
  window.copyFromDataAttr = copyFromDataAttr;

  // ─── Toast ──────────────────────────────────────────────────────────────────
  function showToast(message) {
    var existing = document.querySelector(".toast");
    if (existing) existing.remove();
    var toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(function() { toast.classList.add("show"); });
    setTimeout(function() {
      toast.classList.remove("show");
      setTimeout(function() { toast.remove(); }, 200);
    }, 2000);
  }

})();
`;
}
