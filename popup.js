// DOM Elements
const accountNameInput = document.getElementById("accountName");
const saveBtn = document.getElementById("saveBtn");
const saveStatus = document.getElementById("saveStatus");
const accountsList = document.getElementById("accountsList");
const accountCount = document.getElementById("accountCount");
const openSoundcloudBtn = document.getElementById("openSoundcloudBtn");
const cleanLogoutBtn = document.getElementById("cleanLogoutBtn");
const exportBtn = document.getElementById("exportBtn");
const importBtn = document.getElementById("importBtn");
const importFileInput = document.getElementById("importFileInput");

// Initialisation de la popup
document.addEventListener("DOMContentLoaded", () => {
  loadAccounts();
  checkCurrentSoundCloudSession();

  saveBtn.addEventListener("click", handleSaveAccount);
  accountNameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSaveAccount();
    }
  });

  if (cleanLogoutBtn) {
    cleanLogoutBtn.addEventListener("click", () => {
      chrome.runtime.sendMessage({ action: "CLEAN_LOGOUT" }, (response) => {
        if (response && response.success) {
          showStatus("Déconnecté de SoundCloud", "success");
        } else {
          showStatus(response?.error || "Erreur de déconnexion", "error");
        }
        loadAccounts();
      });
    });
  }

  if (openSoundcloudBtn) {
    openSoundcloudBtn.addEventListener("click", () => {
      chrome.tabs.create({ url: "https://soundcloud.com/discover" });
    });
  }

  if (exportBtn) {
    exportBtn.addEventListener("click", handleExportAccounts);
  }

  if (importBtn && importFileInput) {
    importBtn.addEventListener("click", () => importFileInput.click());
    importFileInput.addEventListener("change", handleImportFile);
  }
});

// Pré-détecte la session SoundCloud active pour aider l'utilisateur
function checkCurrentSoundCloudSession() {
  chrome.runtime.sendMessage({ action: "GET_CURRENT_SC_PROFILE" }, (response) => {
    if (response && response.success && response.profile && response.profile.username) {
      if (!accountNameInput.value) {
        accountNameInput.placeholder = `Détecté : ${response.profile.username}`;
      }
    }
  });
}

// Sauvegarder le compte actif
function handleSaveAccount() {
  const rawName = accountNameInput.value.trim();

  if (rawName.length > 50) {
    showStatus("Nom trop long (max 50 car.)", "error");
    return;
  }

  const sanitizedName = rawName.replace(/[\u0000-\u001F\u007F-\u009F]/g, "");

  saveBtn.disabled = true;
  showStatus("Détection du profil SoundCloud...", "info");

  chrome.runtime.sendMessage({
    action: "SAVE_ACTIVE_ACCOUNT",
    name: sanitizedName
  }, (response) => {
    saveBtn.disabled = false;
    if (response && response.success) {
      accountNameInput.value = "";
      showStatus(`Compte "${response.name}" enregistré`, "success");
      loadAccounts();
    } else {
      showStatus(response?.error || "Erreur lors de la sauvegarde", "error");
    }
  });
}

// Basculer vers un compte
function switchToAccount(name) {
  showStatus(`Bascule vers "${name}"...`, "info");

  chrome.runtime.sendMessage({
    action: "SWITCH_ACCOUNT",
    accountName: name
  }, (response) => {
    if (response && response.success) {
      showStatus(`Actif : ${name}`, "success");
      loadAccounts();
    } else {
      showStatus(response?.error || "Erreur lors de la bascule", "error");
    }
  });
}

// Supprimer un compte avec confirmation
function deleteAccount(name) {
  if (!confirm(`Supprimer le compte "${name}" ?`)) return;

  chrome.runtime.sendMessage({
    action: "DELETE_ACCOUNT",
    name: name
  }, (response) => {
    if (response && response.success) {
      showStatus(`Compte "${name}" supprimé`, "success");
    }
    loadAccounts();
  });
}

// Exporter les profils en JSON
function handleExportAccounts() {
  chrome.storage.local.get(["sc_accounts"], (data) => {
    const accounts = data.sc_accounts || {};
    const keys = Object.keys(accounts);

    if (keys.length === 0) {
      showStatus("Aucun profil à exporter", "error");
      return;
    }

    const payload = {
      app: "SC_Account_Switcher",
      version: "1.1.0",
      exportedAt: new Date().toISOString(),
      accounts: accounts
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `soundcloud_switcher_backup_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showStatus(`${keys.length} profil(s) exporté(s)`, "success");
  });
}

// Importer des profils depuis un fichier JSON
function handleImportFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      const accounts = data.accounts || data;

      chrome.runtime.sendMessage({
        action: "IMPORT_ACCOUNTS",
        accounts: accounts
      }, (res) => {
        if (res && res.success) {
          showStatus(`${res.count} compte(s) importé(s)`, "success");
          loadAccounts();
        } else {
          showStatus(res?.error || "Format de fichier invalide", "error");
        }
      });
    } catch (err) {
      showStatus("Fichier JSON non valide", "error");
    }
    // Réinitialiser le file input pour permettre une réimportation si besoin
    importFileInput.value = "";
  };
  reader.readAsText(file);
}

// Création sécurisée de l'icône SVG poubelle
function createTrashIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "13");
  svg.setAttribute("height", "13");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M3 6h18m-2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2");
  svg.appendChild(path);

  return svg;
}

// Chargement sécurisé de la liste des comptes dans le DOM
function loadAccounts() {
  chrome.storage.local.get(["sc_accounts", "sc_active_account"], (result) => {
    const accounts = result.sc_accounts || {};
    const activeAccount = result.sc_active_account;
    const names = Object.keys(accounts);

    accountCount.textContent = String(names.length);
    accountsList.replaceChildren();

    if (names.length === 0) {
      const emptyDiv = document.createElement("div");
      emptyDiv.className = "empty-state";
      const emptyText = document.createElement("p");
      emptyText.textContent = "Aucun compte enregistré";
      emptyDiv.appendChild(emptyText);
      accountsList.appendChild(emptyDiv);
      return;
    }

    names.forEach((name) => {
      const account = accounts[name] || {};
      const isActive = activeAccount === name;

      const item = document.createElement("div");
      item.className = `account-item ${isActive ? "is-active" : ""}`;

      // Section Info
      const infoDiv = document.createElement("div");
      infoDiv.className = "account-info";

      // Avatar
      const avatarWrap = document.createElement("div");
      avatarWrap.className = "account-avatar-wrap";

      if (account.avatarUrl && typeof account.avatarUrl === "string") {
        const img = document.createElement("img");
        img.className = "account-avatar-img";
        img.src = account.avatarUrl;
        img.alt = name;
        img.onerror = () => {
          img.remove();
          const initial = document.createElement("span");
          initial.className = "account-avatar-initial";
          initial.textContent = name.charAt(0).toUpperCase() || "A";
          avatarWrap.appendChild(initial);
        };
        avatarWrap.appendChild(img);
      } else {
        const initial = document.createElement("span");
        initial.className = "account-avatar-initial";
        initial.textContent = name.charAt(0).toUpperCase() || "A";
        avatarWrap.appendChild(initial);
      }

      // Nom & handle
      const textWrap = document.createElement("div");
      textWrap.className = "account-text-wrap";

      const nameSpan = document.createElement("span");
      nameSpan.className = "account-name";
      nameSpan.title = name;
      nameSpan.textContent = name;

      textWrap.appendChild(nameSpan);

      if (account.username && account.username !== name) {
        const subSpan = document.createElement("span");
        subSpan.className = "account-subtext";
        subSpan.textContent = `@${account.username}`;
        textWrap.appendChild(subSpan);
      }

      infoDiv.appendChild(avatarWrap);
      infoDiv.appendChild(textWrap);

      if (isActive) {
        const dot = document.createElement("span");
        dot.className = "active-dot";
        dot.title = "Compte actif";
        infoDiv.appendChild(dot);
      }

      // Actions
      const actionsDiv = document.createElement("div");
      actionsDiv.className = "account-actions";

      const switchBtn = document.createElement("button");
      switchBtn.className = `btn btn-switch ${isActive ? "btn-active-state" : ""}`;
      switchBtn.textContent = isActive ? "Actif" : "Activer";
      switchBtn.setAttribute("aria-label", `Basculer vers ${name}`);
      switchBtn.addEventListener("click", () => switchToAccount(name));

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "btn-delete";
      deleteBtn.title = "Supprimer";
      deleteBtn.setAttribute("aria-label", `Supprimer le compte ${name}`);
      deleteBtn.appendChild(createTrashIcon());
      deleteBtn.addEventListener("click", () => deleteAccount(name));

      actionsDiv.appendChild(switchBtn);
      actionsDiv.appendChild(deleteBtn);

      item.appendChild(infoDiv);
      item.appendChild(actionsDiv);

      accountsList.appendChild(item);
    });
  });
}

let statusTimeout = null;
function showStatus(text, type) {
  if (statusTimeout) clearTimeout(statusTimeout);
  saveStatus.textContent = text;
  saveStatus.className = `status-msg ${type || ""}`;

  statusTimeout = setTimeout(() => {
    saveStatus.textContent = "";
    saveStatus.className = "status-msg";
  }, 3200);
}
