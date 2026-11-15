const API_BASE = "/api/v1";
const results = document.querySelector("#results");
const resultCount = document.querySelector("#result-count");
const searchInput = document.querySelector("#search-input");

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function resourceCard(resource) {
  const verified = resource.verification?.status === "verified";
  const location = [resource.location?.city, resource.location?.region, resource.location?.country]
    .filter(Boolean).join(", ");
  const website = resource.website_url;
  return `<article class="resource-card">
    <span class=" ${verified ? "verified" : "pending"}">${verified ? "Verified listing" : "Verification pending"}</span>
    <h4>${escapeHtml(resource.name)}</h4>
    <p>${escapeHtml(resource.description)}</p>
    <div class="resource-meta">${escapeHtml(location)} · ${escapeHtml(resource.category)}</div>
    ${website ? `<p><a href="${escapeHtml(website)}" target="_blank" rel="noopener noreferrer">Visit official website ↗</a></p>` : ""}
  </article>`;
}

async function searchResources(query = "") {
  const params = new URLSearchParams({ page: "1", limit: "20" });
  if (query.trim()) params.set("q", query.trim());
  results.innerHTML = '<div class="empty-state">Searching the directory…</div>';
  resultCount.textContent = "Loading";
  try {
    const response = await fetch(`${API_BASE}/resources?${params.toString()}`, {
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new Error("The directory is temporarily unavailable.");
    const payload = await response.json();
    if (!payload.success) throw new Error(payload.error?.message || "Search failed.");
    const items = payload.data || [];
    resultCount.textContent = `${payload.pagination.total} resource${payload.pagination.total === 1 ? "" : "s"} found`;
    results.innerHTML = items.length
      ? items.map(resourceCard).join("")
      : '<div class="empty-state"><span aria-hidden="true">♡</span><p>No listings matched that search yet. Try another phrase or check back as the directory grows.</p></div>';
  } catch (error) {
    resultCount.textContent = "Unable to load resources";
    results.innerHTML = `<div class="empty-state"><p>${escapeHtml(error.message)}</p></div>`;
  }
}

document.querySelector("#search-form").addEventListener("submit", (event) => {
  event.preventDefault();
  searchResources(searchInput.value);
});
document.querySelectorAll("[data-query]").forEach((button) => {
  button.addEventListener("click", () => {
    searchInput.value = button.dataset.query;
    searchResources(button.dataset.query);
    document.querySelector("#find-help").scrollIntoView({ behavior: "smooth" });
  });
});

const locationButton = document.querySelector("#share-location");
const locationStatus = document.querySelector("#location-status");
locationButton.addEventListener("click", () => {
  if (!("geolocation" in navigator)) {
    locationStatus.textContent = "This browser does not support location sharing. If it is an emergency, call your local emergency number and describe your location.";
    return;
  }
  locationButton.disabled = true;
  locationStatus.textContent = "Requesting permission to use your device location…";
  navigator.geolocation.getCurrentPosition(async (position) => {
    const { latitude, longitude, accuracy } = position.coords;
    const mapUrl = `https://www.google.com/maps?q=${latitude},${longitude}`;
    const message = `My current location: ${mapUrl} (location accuracy approximately ${Math.round(accuracy)} metres)`;
    locationStatus.textContent = "Location found. Choose a person or app to share it with. This directory has not received your coordinates.";
    try {
      if (navigator.share) {
        await navigator.share({ title: "My current location", text: message, url: mapUrl });
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(message);
        locationStatus.textContent = "Location link copied. Paste it into a message to your trusted contact or responder.";
      } else {
        locationStatus.innerHTML = "";
        const link = document.createElement("a");
        link.href = mapUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "Open your location in Maps";
        locationStatus.append("Location found. Share this map link with your trusted contact: ", link);
      }
    } catch (error) {
      if (error.name !== "AbortError") locationStatus.textContent = "Your location was found, but sharing was cancelled or unavailable. You can open the map link and share it manually.";
    } finally {
      locationButton.disabled = false;
    }
  }, (error) => {
    const messages = {
      1: "Location permission was denied. You can enable it in your browser settings, or call your local emergency number and state your location.",
      2: "Your device could not determine its location. Try again or describe your location to emergency services.",
      3: "The location request timed out. Try again if it is safe to do so."
    };
    locationStatus.textContent = messages[error.code] || "We could not get your location. If someone is in immediate danger, call your local emergency number.";
    locationButton.disabled = false;
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 });
});

searchResources();