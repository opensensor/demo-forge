/**
 * DemoForge Studio — single-page UI.
 *
 * Served inline by the server (no build step, no external assets). The two
 * placeholders __DEFAULT_LLM_URL__ / __DEFAULT_MODEL__ are substituted at
 * request time.
 */

export const STUDIO_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DemoForge Studio</title>
<style>
  :root {
    --bg: #0f1218; --panel: #171c26; --panel2: #1d2432; --border: #2a3347;
    --text: #e6eaf2; --muted: #8b96ab; --accent: #4f8ff7; --accent2: #37c99e;
    --danger: #e5636c; --mono: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: var(--bg); color: var(--text); min-height: 100vh;
  }
  header {
    display: flex; align-items: baseline; gap: 12px;
    padding: 18px 28px; border-bottom: 1px solid var(--border);
  }
  header h1 { font-size: 20px; font-weight: 650; }
  header span { color: var(--muted); font-size: 13px; }
  .layout {
    display: grid; grid-template-columns: 380px 1fr; gap: 20px;
    padding: 20px 28px; max-width: 1500px;
  }
  @media (max-width: 900px) { .layout { grid-template-columns: 1fr; } }
  .card {
    background: var(--panel); border: 1px solid var(--border);
    border-radius: 10px; padding: 18px;
  }
  .card h2 {
    font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--muted); margin-bottom: 14px;
  }
  label { display: block; font-size: 13px; color: var(--muted); margin: 12px 0 4px; }
  input, textarea, select {
    width: 100%; background: var(--panel2); border: 1px solid var(--border);
    color: var(--text); border-radius: 6px; padding: 8px 10px; font-size: 14px;
    font-family: inherit;
  }
  textarea { resize: vertical; }
  #goal { min-height: 110px; }
  input:focus, textarea:focus { outline: none; border-color: var(--accent); }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  button {
    border: none; border-radius: 6px; padding: 10px 16px; font-size: 14px;
    font-weight: 600; cursor: pointer; margin-top: 16px;
  }
  button:disabled { opacity: 0.45; cursor: not-allowed; }
  #explore-btn { background: var(--accent); color: white; width: 100%; }
  #render-btn { background: var(--accent2); color: #08281f; }
  .status-line {
    display: flex; align-items: center; gap: 8px; margin-bottom: 12px;
    font-size: 14px; min-height: 22px;
  }
  .badge {
    font-size: 11px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.06em; border-radius: 20px; padding: 3px 10px;
  }
  .badge.exploring, .badge.rendering { background: #2c3a58; color: #9fc0ff; }
  .badge.explored { background: #1e4436; color: #7fe0bf; }
  .badge.rendered { background: #1e4436; color: #7fe0bf; }
  .badge.failed { background: #4a2229; color: #ff9aa2; }
  #log {
    font-family: var(--mono); font-size: 12.5px; line-height: 1.65;
    background: var(--panel2); border: 1px solid var(--border); border-radius: 8px;
    padding: 12px 14px; height: 300px; overflow-y: auto; white-space: pre-wrap;
    word-break: break-word;
  }
  #log .t { color: var(--muted); }
  #log .err { color: var(--danger); }
  .artifacts { display: flex; flex-direction: column; gap: 16px; margin-top: 14px; }
  .artifact-link {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    background: var(--panel2); border: 1px solid var(--border); border-radius: 8px;
    padding: 10px 12px; font-size: 13px;
  }
  .artifact-link span { color: var(--muted); overflow-wrap: anywhere; }
  .shots { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
  .shots img { width: 100%; border-radius: 6px; border: 1px solid var(--border); }
  details { margin-top: 14px; }
  summary { cursor: pointer; color: var(--muted); font-size: 13px; }
  #script-json {
    font-family: var(--mono); font-size: 12px; background: var(--panel2);
    border: 1px solid var(--border); border-radius: 8px; padding: 12px;
    max-height: 320px; overflow: auto; margin-top: 8px; white-space: pre;
  }
  a { color: var(--accent); }
  .hint { font-size: 12px; color: var(--muted); margin-top: 4px; }
</style>
</head>
<body>
<header>
  <h1>DemoForge Studio</h1>
  <span>state your objectives — the agent explores, scripts, and renders the demo</span>
</header>

<div class="layout">
  <div class="card">
    <h2>Craft a demo</h2>
    <form id="form">
      <label for="url">Target app URL</label>
      <input id="url" type="url" placeholder="http://127.0.0.1:8081" required>

      <label for="goal">Objectives — what should this demo show?</label>
      <textarea id="goal" required
        placeholder="e.g. Show how an on-call engineer triages a detected incident: filter to unresolved detections, open the first one, review the evidence, and check WHOIS and the recommendation. Do not change any state."></textarea>
      <div class="hint">Be specific about the flow, the audience, and anything the agent must avoid.</div>

      <div class="row">
        <div>
          <label for="llmUrl">LLM endpoint</label>
          <input id="llmUrl" value="__DEFAULT_LLM_URL__">
        </div>
        <div>
          <label for="model">Model</label>
          <input id="model" value="__DEFAULT_MODEL__" placeholder="server default">
        </div>
      </div>

      <div class="row">
        <div>
          <label for="maxSteps">Max steps</label>
          <input id="maxSteps" type="number" min="3" max="100" value="25">
        </div>
        <div>
          <label for="denylist">Never click (comma-separated)</label>
          <input id="denylist" value="delete, remove, dismiss, sign out, log out">
        </div>
      </div>

      <button id="explore-btn" type="submit">Explore &amp; craft demo script</button>
    </form>
  </div>

  <div class="card">
    <h2>Run</h2>
    <div class="status-line">
      <span class="badge" id="badge" hidden></span>
      <span id="status-msg">No run yet — describe your objectives and hit Explore.</span>
    </div>
    <div id="log" hidden></div>

    <details id="script-details" hidden>
      <summary>Assembled demo script</summary>
      <div id="script-json"></div>
    </details>

    <button id="render-btn" hidden>Render video</button>

    <div class="artifacts" id="artifacts"></div>
  </div>
</div>

<script>
(() => {
  const $ = (id) => document.getElementById(id);
  let runId = null;
  let source = null;

  function setStatus(status, message) {
    const badge = $("badge");
    if (status) {
      badge.hidden = false;
      badge.textContent = status;
      badge.className = "badge " + status;
    }
    if (message) $("status-msg").textContent = message;
  }

  function logLine(text, cls) {
    const log = $("log");
    log.hidden = false;
    const line = document.createElement("div");
    if (cls) line.className = cls;
    line.textContent = text;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  }

  function fmt(ms) {
    return (ms / 1000).toFixed(1).padStart(6) + "s";
  }

  function handleEvent(ev) {
    const e = JSON.parse(ev.data);
    if (e.type === "log") {
      logLine(fmt(e.at) + "  " + e.message);
    } else if (e.type === "status") {
      setStatus(e.status, e.message);
      logLine(fmt(e.at) + "  ── " + e.message);
      if (e.status === "explored") $("render-btn").hidden = false;
      if (e.status === "rendering") $("render-btn").disabled = true;
      if (e.status === "rendered") { $("render-btn").disabled = false; loadArtifacts(); }
      if (e.status !== "exploring") $("explore-btn").disabled = false;
    } else if (e.type === "script") {
      $("script-details").hidden = false;
      $("script-json").textContent = JSON.stringify(e.script, null, 2);
    } else if (e.type === "artifact") {
      logLine(fmt(e.at) + "  ⇒ artifact: " + e.artifact.href);
    } else if (e.type === "error") {
      setStatus(e.status || "failed", e.message);
      logLine(fmt(e.at) + "  " + e.message, "err");
      $("explore-btn").disabled = false;
      $("render-btn").disabled = false;
    }
  }

  async function loadArtifacts() {
    const res = await fetch("/api/runs/" + runId);
    const run = await res.json();
    const box = $("artifacts");
    box.innerHTML = "";
    const video = run.artifacts.find((a) => a.kind === "video");
    if (video) {
      const row = document.createElement("div");
      row.className = "artifact-link";
      const label = document.createElement("span");
      label.textContent = video.href.split("/").pop() || "video artifact";
      const link = document.createElement("a");
      link.href = video.href;
      link.download = "";
      link.textContent = "Download video";
      row.appendChild(label);
      row.appendChild(link);
      box.appendChild(row);
    }
    const shots = run.artifacts.filter((a) => a.kind === "screenshot");
    if (shots.length) {
      const grid = document.createElement("div");
      grid.className = "shots";
      for (const s of shots) {
        const a = document.createElement("a");
        a.href = s.href;
        a.target = "_blank";
        const img = document.createElement("img");
        img.src = s.href;
        a.appendChild(img);
        grid.appendChild(a);
      }
      box.appendChild(grid);
    }
    const script = run.artifacts.find((a) => a.kind === "script");
    if (script) {
      const link = document.createElement("div");
      link.innerHTML = '<a href="' + script.href + '" download>Download demo script (JSON)</a>';
      box.appendChild(link);
    }
  }

  $("form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    $("explore-btn").disabled = true;
    $("render-btn").hidden = true;
    $("artifacts").innerHTML = "";
    $("script-details").hidden = true;
    $("log").innerHTML = "";
    if (source) source.close();

    const body = {
      url: $("url").value.trim(),
      goal: $("goal").value.trim(),
      llmUrl: $("llmUrl").value.trim(),
      model: $("model").value.trim(),
      maxSteps: parseInt($("maxSteps").value, 10),
      denylist: $("denylist").value.split(",").map((s) => s.trim()).filter(Boolean),
    };

    const res = await fetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      setStatus("failed", data.error);
      $("explore-btn").disabled = false;
      return;
    }
    runId = data.id;
    setStatus("exploring", "Run " + runId + " started...");
    source = new EventSource("/api/runs/" + runId + "/events");
    source.onmessage = handleEvent;
  });

  $("render-btn").addEventListener("click", async () => {
    $("render-btn").disabled = true;
    await fetch("/api/runs/" + runId + "/render", { method: "POST" });
  });
})();
</script>
</body>
</html>`;
