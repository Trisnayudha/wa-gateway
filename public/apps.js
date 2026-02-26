async function loadDevices() {
    const res = await fetch("/api/admin/devices");
    const data = await res.json();

    const tbody = document.getElementById("tbody");
    tbody.innerHTML = "";

    (data.devices || []).forEach((d) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
      <td>
        <strong>${escapeHtml(d.name)}</strong><br/>
        <small><code>${d.id}</code></small>
      </td>
      <td class="${d.status === "READY" ? "ok" : "bad"}">${d.status}</td>
      <td><code>${escapeHtml(d.last_event || "-")}</code></td>
      <td>
        <button onclick="showQr('${d.id}')">Show QR</button>
        <button onclick="genKey('${d.id}')">Create API Key</button>
      </td>
    `;
        tbody.appendChild(tr);
    });
}

async function createDevice() {
    const name = document.getElementById("deviceName").value.trim();
    if (!name) return alert("Device name required");

    await fetch("/api/admin/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
    });

    document.getElementById("deviceName").value = "";
    loadDevices();
}

async function showQr(deviceId) {
    const wrap = document.getElementById("qrWrap");
    wrap.textContent = "Loading QR...";

    const res = await fetch(`/api/admin/devices/${deviceId}/qr`);
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        wrap.textContent = err.message || "QR not available";
        return;
    }

    const data = await res.json();
    wrap.innerHTML = `<img src="${data.qr}" alt="QR" />`;
}

async function genKey(deviceId) {
    const label = prompt("Label API key? (mis: laravel-prod)");
    if (!label) return;

    const res = await fetch(`/api/admin/devices/${deviceId}/api-keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
    });

    const data = await res.json();
    const wrap = document.getElementById("keyWrap");

    if (!data.ok) {
        wrap.textContent = data.message || "Failed";
        return;
    }

    wrap.innerHTML = `Save this key now (shown once):<br/><code>${data.apiKey}</code>`;

    // auto fill test key
    const testKey = document.getElementById("testKey");
    if (testKey) testKey.value = data.apiKey;
}

async function testSend() {
    const key = document.getElementById("testKey").value.trim();
    const to = document.getElementById("testTo").value.trim();
    const text = document.getElementById("testText").value.trim();
    const out = document.getElementById("testResult");

    out.textContent = "Sending...";

    const res = await fetch("/api/send", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-API-KEY": key,
        },
        body: JSON.stringify({ to, text }),
    });

    const data = await res.json().catch(() => ({}));
    out.innerHTML = `<code>${escapeHtml(JSON.stringify(data))}</code>`;
}

function escapeHtml(str) {
    return String(str)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

loadDevices();
setInterval(loadDevices, 5000);