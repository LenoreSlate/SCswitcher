const SOUNDCLOUD_DOMAINS = ["soundcloud.com", ".soundcloud.com", "api.soundcloud.com", "api-v2.soundcloud.com", "m.soundcloud.com"];

// Flag pour éviter les boucles d'auto-sauvegarde pendant les transactions de switch/logout
let isSwitching = false;

// 1. Écouteur de messages venant de la popup UI
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "SWITCH_ACCOUNT") {
    handleSwitchAccount(request.accountName).then(() => {
      sendResponse({ success: true });
    }).catch((err) => {
      sendResponse({ success: false, error: err.message || err.toString() });
    });
    return true;
  }
  
  if (request.action === "CLEAN_LOGOUT") {
    handleCleanLogout().then(() => {
      sendResponse({ success: true });
    }).catch((err) => {
      sendResponse({ success: false, error: err.message || err.toString() });
    });
    return true;
  }

  if (request.action === "SAVE_ACTIVE_ACCOUNT") {
    handleManualSave(request.name).then((res) => {
      sendResponse(res);
    }).catch((err) => {
      sendResponse({ success: false, error: err.message || err.toString() });
    });
    return true;
  }

  if (request.action === "DELETE_ACCOUNT") {
    handleDeleteAccount(request.name).then((res) => {
      sendResponse(res);
    }).catch((err) => {
      sendResponse({ success: false, error: err.message || err.toString() });
    });
    return true;
  }
});

// 2. AUTO-SYNC EN TEMPS RÉEL
// Dès qu'un cookie SoundCloud est mis à jour / renouvelé par le site, on met à jour la sauvegarde du compte actif
chrome.cookies.onChanged.addListener((changeInfo) => {
  if (isSwitching) return; // Ne pas interférer pendant un switch ou logout

  const domain = changeInfo.cookie?.domain || "";
  if (!SOUNDCLOUD_DOMAINS.some(d => domain.includes("soundcloud.com"))) return;

  debouncedSyncActiveAccount();
});

let syncTimeout = null;
function debouncedSyncActiveAccount() {
  if (isSwitching) return;
  if (syncTimeout) clearTimeout(syncTimeout);

  syncTimeout = setTimeout(async () => {
    if (isSwitching) return;
    try {
      const data = await chrome.storage.local.get(["sc_active_account", "sc_accounts"]);
      const activeName = data.sc_active_account;
      const accounts = data.sc_accounts || {};

      if (activeName && accounts[activeName]) {
        const freshCookies = await getSoundcloudCookies();
        // Vérification de sécurité : ne synchroniser que si la session active est authentifiée
        if (hasSoundcloudAuthCookie(freshCookies)) {
          accounts[activeName].cookies = freshCookies;
          accounts[activeName].lastSynced = new Date().toISOString();
          await chrome.storage.local.set({ sc_accounts: accounts });
        }
      }
    } catch (e) {
      console.warn("Auto-sync background error:", e);
    }
  }, 1000);
}

// Vérifie si les cookies contiennent un jeton d'authentification SoundCloud valide
function hasSoundcloudAuthCookie(cookies) {
  if (!Array.isArray(cookies) || cookies.length === 0) return false;
  return cookies.some(c => c.name === "oauth_token" && typeof c.value === "string" && c.value.trim().length > 0);
}

// Récupère tous les cookies SoundCloud
async function getSoundcloudCookies() {
  const allCookies = [];
  for (const domain of SOUNDCLOUD_DOMAINS) {
    try {
      const cookies = await chrome.cookies.getAll({ domain: domain });
      for (const c of cookies) {
        if (!allCookies.some(existing => existing.name === c.name && existing.domain === c.domain && existing.path === c.path)) {
          allCookies.push(c);
        }
      }
    } catch (e) {
      console.warn(`Erreur lecture cookies domaine ${domain}:`, e);
    }
  }
  return allCookies;
}

// Supprime tous les cookies SoundCloud
async function clearSoundcloudCookies() {
  const cookies = await getSoundcloudCookies();
  for (const cookie of cookies) {
    const cleanDomain = cookie.domain.startsWith(".") ? cookie.domain.substring(1) : cookie.domain;
    const protocol = cookie.secure ? "https:" : "http:";
    const url = `${protocol}//${cleanDomain}${cookie.path}`;
    try {
      await chrome.cookies.remove({
        url: url,
        name: cookie.name,
        storeId: cookie.storeId
      });
    } catch (e) {
      console.warn(`Erreur suppression cookie ${cookie.name}:`, e);
    }
  }
}

// Applique une liste de cookies en respectant les attributs stricts (hostOnly, sameSite, storeId)
async function setSoundcloudCookies(cookies) {
  for (const cookie of cookies) {
    const cleanDomain = cookie.domain.startsWith(".") ? cookie.domain.substring(1) : cookie.domain;
    const protocol = cookie.secure ? "https:" : "http:";
    const url = `${protocol}//${cleanDomain}${cookie.path}`;

    const cookieDetails = {
      url: url,
      name: cookie.name,
      value: cookie.value,
      path: cookie.path || "/",
      secure: cookie.secure !== undefined ? cookie.secure : true,
      httpOnly: Boolean(cookie.httpOnly)
    };

    // Si le cookie est host-only, ne pas spécifier 'domain' pour que Chrome l'associe strictement à l'host de l'URL
    if (!cookie.hostOnly && cookie.domain) {
      cookieDetails.domain = cookie.domain;
    }

    if (cookie.storeId) {
      cookieDetails.storeId = cookie.storeId;
    }

    if (cookie.sameSite && cookie.sameSite !== "unspecified") {
      cookieDetails.sameSite = cookie.sameSite;
    }

    if (cookie.expirationDate) {
      cookieDetails.expirationDate = cookie.expirationDate;
    }

    try {
      await chrome.cookies.set(cookieDetails);
    } catch (e) {
      console.warn(`Erreur réinjection cookie ${cookie.name}:`, e);
    }
  }
}

// Sauvegarde d'un profil avec validation préalable d'authentification
async function handleManualSave(name) {
  const cleanName = (name || "").trim();
  if (!cleanName) {
    return { success: false, error: "Le nom du compte est requis." };
  }

  const cookies = await getSoundcloudCookies();
  if (!hasSoundcloudAuthCookie(cookies)) {
    return { 
      success: false, 
      error: "Aucune session active détectée sur SoundCloud. Veuillez vous connecter d'abord." 
    };
  }

  const data = await chrome.storage.local.get(["sc_accounts"]);
  const accounts = data.sc_accounts || {};

  accounts[cleanName] = {
    name: cleanName,
    cookies: cookies,
    savedAt: new Date().toISOString(),
    lastSynced: new Date().toISOString()
  };

  await chrome.storage.local.set({
    sc_accounts: accounts,
    sc_active_account: cleanName
  });

  return { success: true };
}

// Suppression sécurisée d'un profil
async function handleDeleteAccount(name) {
  const cleanName = (name || "").trim();
  if (!cleanName) {
    return { success: false, error: "Nom invalide." };
  }

  const data = await chrome.storage.local.get(["sc_accounts", "sc_active_account"]);
  const accounts = data.sc_accounts || {};
  delete accounts[cleanName];

  const updates = { sc_accounts: accounts };
  if (data.sc_active_account === cleanName) {
    updates.sc_active_account = null;
  }

  await chrome.storage.local.set(updates);
  return { success: true };
}

// Bascule de compte avec verrouillage anti-concurrence et rechargement propre
async function handleSwitchAccount(targetName) {
  isSwitching = true;

  try {
    const data = await chrome.storage.local.get(["sc_accounts", "sc_active_account"]);
    const accounts = data.sc_accounts || {};
    const currentActive = data.sc_active_account;

    // 1. Sauvegarder d'abord les cookies frais du compte actuel si connecté
    if (currentActive && accounts[currentActive]) {
      const currentCookies = await getSoundcloudCookies();
      if (hasSoundcloudAuthCookie(currentCookies)) {
        accounts[currentActive].cookies = currentCookies;
        accounts[currentActive].lastSynced = new Date().toISOString();
      }
    }

    const targetAccount = accounts[targetName];
    if (!targetAccount) {
      throw new Error(`Le compte "${targetName}" est introuvable.`);
    }

    // 2. Vider les cookies existants
    await clearSoundcloudCookies();

    // 3. Injecter les cookies du nouveau compte
    await setSoundcloudCookies(targetAccount.cookies);

    // 4. Mettre à jour le compte actif en mémoire
    await chrome.storage.local.set({
      sc_accounts: accounts,
      sc_active_account: targetName
    });

    // 5. Mettre au premier plan ou ouvrir l'onglet SoundCloud
    const tabs = await chrome.tabs.query({ url: "*://*.soundcloud.com/*" });
    if (tabs.length > 0) {
      await chrome.tabs.update(tabs[0].id, { url: "https://soundcloud.com/discover", active: true });
      if (tabs[0].windowId) {
        await chrome.windows.update(tabs[0].windowId, { focused: true });
      }
    } else {
      await chrome.tabs.create({ url: "https://soundcloud.com/discover", active: true });
    }
  } finally {
    // Relâcher le verrou après 1.5s (temps nécessaire pour que la page charge et initialise les cookies)
    setTimeout(() => {
      isSwitching = false;
    }, 1500);
  }
}

// Déconnexion propre
async function handleCleanLogout() {
  isSwitching = true;
  try {
    await clearSoundcloudCookies();
    await chrome.storage.local.remove(["sc_active_account"]);

    const tabs = await chrome.tabs.query({ url: "*://*.soundcloud.com/*" });
    if (tabs.length > 0) {
      await chrome.tabs.update(tabs[0].id, { url: "https://soundcloud.com/discover", active: true });
    } else {
      await chrome.tabs.create({ url: "https://soundcloud.com/discover" });
    }
  } finally {
    setTimeout(() => {
      isSwitching = false;
    }, 1000);
  }
}
