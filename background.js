const SOUNDCLOUD_DOMAINS = [
  "soundcloud.com",
  ".soundcloud.com",
  "api.soundcloud.com",
  "api-v2.soundcloud.com",
  "m.soundcloud.com"
];

// Verrou pour éviter les boucles d'auto-sauvegarde pendant les transactions
let isSwitching = false;

// Initialisation au démarrage
chrome.runtime.onInstalled.addListener(() => {
  updateExtensionBadge();
});

chrome.runtime.onStartup.addListener(() => {
  updateExtensionBadge();
});

// 1. ÉCOUTEUR DE MESSAGES POPUP
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

  if (request.action === "IMPORT_ACCOUNTS") {
    handleImportAccounts(request.accounts).then((res) => {
      sendResponse(res);
    }).catch((err) => {
      sendResponse({ success: false, error: err.message || err.toString() });
    });
    return true;
  }

  if (request.action === "GET_CURRENT_SC_PROFILE") {
    detectCurrentProfile().then((res) => {
      sendResponse(res);
    }).catch((err) => {
      sendResponse({ success: false, error: err.message || err.toString() });
    });
    return true;
  }
});

// 2. AUTO-SYNC EN TEMPS RÉEL
chrome.cookies.onChanged.addListener((changeInfo) => {
  if (isSwitching) return;

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
        if (hasSoundcloudAuthCookie(freshCookies)) {
          accounts[activeName].cookies = freshCookies;
          accounts[activeName].lastSynced = new Date().toISOString();
          await chrome.storage.local.set({ sc_accounts: accounts });
        }
      }
    } catch (e) {
      console.warn("Auto-sync background error:", e);
    }
  }, 1200);
}

// 3. RÉCUPÉRATION DU PROFIL SOUNDCLOUD VIA API
async function fetchSoundcloudUserProfile(oauthToken) {
  if (!oauthToken) return null;
  try {
    const response = await fetch("https://api-v2.soundcloud.com/me", {
      headers: {
        "Authorization": `OAuth ${oauthToken}`,
        "Accept": "application/json"
      }
    });
    if (response.ok) {
      const user = await response.json();
      return {
        username: user.username || user.permalink || "",
        avatarUrl: user.avatar_url || "",
        permalinkUrl: user.permalink_url || `https://soundcloud.com/${user.permalink}`,
        followersCount: user.followers_count || 0
      };
    }
  } catch (e) {
    console.warn("SoundCloud Profile Fetch error:", e);
  }
  return null;
}

// Détection du profil actif actuellement dans le navigateur
async function detectCurrentProfile() {
  const cookies = await getSoundcloudCookies();
  const oauthCookie = cookies.find(c => c.name === "oauth_token" && c.value);
  if (!oauthCookie) {
    return { success: false, authenticated: false };
  }

  const profile = await fetchSoundcloudUserProfile(oauthCookie.value);
  return {
    success: true,
    authenticated: true,
    profile: profile
  };
}

// 4. GESTION DES BADGES D'ICÔNE CHROME
async function updateExtensionBadge() {
  try {
    const data = await chrome.storage.local.get(["sc_active_account"]);
    const active = data.sc_active_account;
    if (active) {
      const badgeText = active.trim().substring(0, 3).toUpperCase();
      await chrome.action.setBadgeText({ text: badgeText });
      await chrome.action.setBadgeBackgroundColor({ color: "#ff5500" });
    } else {
      await chrome.action.setBadgeText({ text: "" });
    }
  } catch (e) {
    console.warn("Badge update error:", e);
  }
}

// 5. GESTION DES COOKIES
function hasSoundcloudAuthCookie(cookies) {
  if (!Array.isArray(cookies) || cookies.length === 0) return false;
  return cookies.some(c => c.name === "oauth_token" && typeof c.value === "string" && c.value.trim().length > 0);
}

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
      console.warn(`Erreur injection cookie ${cookie.name}:`, e);
    }
  }
}

// 6. ACTIONS MÉTIER

// Sauvegarde manuelle ou auto-détectée d'un profil
async function handleManualSave(preferredName) {
  const cookies = await getSoundcloudCookies();
  if (!hasSoundcloudAuthCookie(cookies)) {
    return { 
      success: false, 
      error: "Aucune session active détectée. Connectez-vous d'abord sur SoundCloud." 
    };
  }

  const oauthCookie = cookies.find(c => c.name === "oauth_token");
  const profile = await fetchSoundcloudUserProfile(oauthCookie?.value);

  // Nom final : nom spécifié par l'utilisateur ou nom SoundCloud détecté
  let finalName = (preferredName || "").trim();
  if (!finalName && profile && profile.username) {
    finalName = profile.username;
  }
  if (!finalName) {
    finalName = "Compte SoundCloud";
  }

  const data = await chrome.storage.local.get(["sc_accounts"]);
  const accounts = data.sc_accounts || {};

  accounts[finalName] = {
    name: finalName,
    username: profile?.username || finalName,
    avatarUrl: profile?.avatarUrl || null,
    permalinkUrl: profile?.permalinkUrl || null,
    cookies: cookies,
    savedAt: new Date().toISOString(),
    lastSynced: new Date().toISOString()
  };

  await chrome.storage.local.set({
    sc_accounts: accounts,
    sc_active_account: finalName
  });

  await updateExtensionBadge();
  return { success: true, name: finalName, profile: profile };
}

// Suppression d'un compte
async function handleDeleteAccount(name) {
  const cleanName = (name || "").trim();
  if (!cleanName) return { success: false, error: "Nom invalide." };

  const data = await chrome.storage.local.get(["sc_accounts", "sc_active_account"]);
  const accounts = data.sc_accounts || {};
  delete accounts[cleanName];

  const updates = { sc_accounts: accounts };
  if (data.sc_active_account === cleanName) {
    updates.sc_active_account = null;
  }

  await chrome.storage.local.set(updates);
  await updateExtensionBadge();
  return { success: true };
}

// Importation de comptes sauvegardés
async function handleImportAccounts(importedAccounts) {
  if (!importedAccounts || typeof importedAccounts !== "object") {
    return { success: false, error: "Format de fichier invalide." };
  }

  const data = await chrome.storage.local.get(["sc_accounts"]);
  const existing = data.sc_accounts || {};

  let count = 0;
  for (const [key, acc] of Object.entries(importedAccounts)) {
    if (acc && acc.name && Array.isArray(acc.cookies) && hasSoundcloudAuthCookie(acc.cookies)) {
      existing[acc.name] = acc;
      count++;
    }
  }

  if (count === 0) {
    return { success: false, error: "Aucun profil valide trouvé dans le fichier importé." };
  }

  await chrome.storage.local.set({ sc_accounts: existing });
  await updateExtensionBadge();
  return { success: true, count: count };
}

// Bascule de compte avec actualisation cohérente des onglets SoundCloud
async function handleSwitchAccount(targetName) {
  isSwitching = true;

  try {
    const data = await chrome.storage.local.get(["sc_accounts", "sc_active_account"]);
    const accounts = data.sc_accounts || {};
    const currentActive = data.sc_active_account;

    // Sauvegarder les cookies frais du compte actuel si connecté
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

    // 1. Vider les cookies existants
    await clearSoundcloudCookies();

    // 2. Injecter les cookies du nouveau profil
    await setSoundcloudCookies(targetAccount.cookies);

    // 3. Mettre à jour le compte actif
    await chrome.storage.local.set({
      sc_accounts: accounts,
      sc_active_account: targetName
    });

    await updateExtensionBadge();

    // 4. Synchroniser tous les onglets SoundCloud ouverts
    const tabs = await chrome.tabs.query({ url: "*://*.soundcloud.com/*" });
    if (tabs.length > 0) {
      const primaryTab = tabs[0];
      await chrome.tabs.update(primaryTab.id, { url: "https://soundcloud.com/discover", active: true });
      if (primaryTab.windowId) {
        await chrome.windows.update(primaryTab.windowId, { focused: true });
      }
      // Recharger les éventuels autres onglets SoundCloud pour rafraîchir leur session
      for (let i = 1; i < tabs.length; i++) {
        try {
          await chrome.tabs.reload(tabs[i].id);
        } catch (e) {}
      }
    } else {
      await chrome.tabs.create({ url: "https://soundcloud.com/discover", active: true });
    }
  } finally {
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
    await updateExtensionBadge();

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
