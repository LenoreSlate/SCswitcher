// DOM Elements
const accountNameInput = document.getElementById("accountName");
const saveBtn = document.getElementById("saveBtn");
const saveStatus = document.getElementById("saveStatus");
const accountsList = document.getElementById("accountsList");
const accountCount = document.getElementById("accountCount");
const openSoundcloudBtn = document.getElementById("openSoundcloudBtn");
const cleanLogoutBtn = document.getElementById("cleanLogoutBtn");

// Initialize popup
document.addEventListener("DOMContentLoaded", () => {
  loadAccounts();
  
  saveBtn.addEventListener("click", handleSaveAccount);
  accountNameInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") handleSaveAccount();
  });

  if (cleanLogoutBtn) {
    cleanLogoutBtn.addEventListener("click", () => {
      chrome.runtime.sendMessage({ action: "CLEAN_LOGOUT" }, () => {
        showStatus("Déconnecté", "success");
        loadAccounts();
      });
    });
  }

  openSoundcloudBtn.addEventListener("click", () => {
    chrome.tabs.create({ url: "https://soundcloud.com/discover" });
  });
});

// Sauvegarder le compte actif
function handleSaveAccount() {
  const name = accountNameInput.value.trim();
  if (!name) {
    showStatus("Nom requis", "error");
    return;
  }

  chrome.runtime.sendMessage({
    action: "SAVE_ACTIVE_ACCOUNT",
    name: name
  }, (response) => {
    if (response && response.success) {
      accountNameInput.value = "";
      showStatus(`Compte "${name}" enregistré`, "success");
      loadAccounts();
    } else {
      showStatus(response?.error || "Erreur de sauvegarde", "error");
    }
  });
}

// Basculer vers un compte
function switchToAccount(name) {
  showStatus(`Bascule vers "${name}"...`, "success");

  chrome.runtime.sendMessage({
    action: "SWITCH_ACCOUNT",
    accountName: name
  }, (response) => {
    if (response && response.success) {
      showStatus(`Actif : ${name}`, "success");
      loadAccounts();
    }
  });
}

// Supprimer un compte sauvegardé
function deleteAccount(name) {
  if (!confirm(`Supprimer "${name}" ?`)) return;

  chrome.storage.local.get(["sc_accounts", "sc_active_account"], (result) => {
    const accounts = result.sc_accounts || {};
    delete accounts[name];

    const updates = { sc_accounts: accounts };
    if (result.sc_active_account === name) {
      updates.sc_active_account = null;
    }

    chrome.storage.local.set(updates, () => {
      loadAccounts();
    });
  });
}

// Charger et afficher la liste des comptes avec indicateur actif
function loadAccounts() {
  chrome.storage.local.get(["sc_accounts", "sc_active_account"], (result) => {
    const accounts = result.sc_accounts || {};
    const activeAccount = result.sc_active_account;
    const names = Object.keys(accounts);

    accountCount.textContent = names.length;
    accountsList.innerHTML = "";

    if (names.length === 0) {
      accountsList.innerHTML = `
        <div class="empty-state">
          <p>Aucun compte enregistré</p>
        </div>
      `;
      return;
    }

    names.forEach((name) => {
      const item = document.createElement("div");
      const isActive = activeAccount === name;
      item.className = `account-item ${isActive ? 'is-active' : ''}`;

      const initial = name.charAt(0).toUpperCase();

      item.innerHTML = `
        <div class="account-info">
          <div class="account-avatar">${initial}</div>
          <span class="account-name" title="${name}">${escapeHtml(name)}</span>
          ${isActive ? '<span class="active-dot" title="Compte actif"></span>' : ''}
        </div>
        <div class="account-actions">
          <button class="btn btn-switch ${isActive ? 'btn-active-state' : ''}" data-name="${name}">
            ${isActive ? 'Actif' : 'Activer'}
          </button>
          <button class="btn-delete" data-name="${name}" title="Supprimer">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M3 6h18m-2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      `;

      accountsList.appendChild(item);
    });

    document.querySelectorAll(".btn-switch").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const name = e.currentTarget.getAttribute("data-name");
        switchToAccount(name);
      });
    });

    document.querySelectorAll(".btn-delete").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const name = e.currentTarget.getAttribute("data-name");
        deleteAccount(name);
      });
    });
  });
}

function showStatus(text, type) {
  saveStatus.textContent = text;
  saveStatus.className = `status-msg ${type}`;
  setTimeout(() => {
    saveStatus.textContent = "";
    saveStatus.className = "status-msg";
  }, 2500);
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[m]));
}
