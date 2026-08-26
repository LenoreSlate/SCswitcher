const SOUNDCLOUD_DOMAINS = ["soundcloud.com", ".soundcloud.com", "api.soundcloud.com", "api-v2.soundcloud.com", "m.soundcloud.com"];

// Flag pour éviter les boucles d'auto-sauvegarde pendant qu'on applique des cookies
let isSwitching = false;

// 1. Écouteur de messages venant de la popup UI
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "SWITCH_ACCOUNT") {
    handleSwitchAccount(request.accountName).then(() => {
      sendResponse({ success: true });
    }).catch((err) => {
      sendResponse({ success: false, error: err.toString() });
    });
    return true;
  }
  
  if (request.action === "CLEAN_LOGOUT") {
    handleCleanLogout().then(() => {
      sendResponse({ success: true });
    }).catch((err) => {
      sendResponse({ success: false, error: err.toString() });
    });
    return true;
  }

  if (request.action === "SAVE_ACTIVE_ACCOUNT") {
    handleManualSave(request.name).then((res) => {
      sendResponse(res);
    }).catch((err) => {
      sendResponse({ success: false, error: err.toString() });
    });
    return true;
  }
});

// 2. AUTO-SYNC EN TEMPS RÉEL
// Dès qu'un cookie SoundCloud est mis à jour / renouvelé par le site, on met à jour la sauvegarde du compte actif en mémoire
chrome.cookies.onChanged.addListener((changeInfo) => {
  if (isSwitching) return; // Ne pas interférer pendant un switch manuel
  
  const domain = changeInfo.cookie.domain;
  if (!SOUNDCLOUD_DOMAINS.some(d => domain.includes("soundcloud.com"))) return;

  // Mettre à jour les données du compte actif en arrière-plan
  debouncedSyncActiveAccount();
});

let syncTimeout = null;
function debouncedSyncActiveAccount() {
  if (syncTimeout) clearTimeout(syncTimeout);
  syncTimeout = setTimeout(async () => {
    try {
      const data = await chrome.storage.local.get(["sc_active_account", "sc_accounts"]);
      const activeName = data.sc_active_account;
      const accounts = data.sc_accounts || {};

      if (activeName && accounts[activeName]) {
        const freshCookies = await getSoundcloudCookies();
        if (freshCookies.length > 0) {
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

// Récupère tous les cookies SoundCloud
async function getSoundcloudCookies() {
  const allCookies = [];
  for (const domain of SOUNDCLOUD_DOMAINS) {
    const cookies = await chrome.cookies.getAll({ domain: domain });
    for (const c of cookies) {
      if (!allCookies.some(existing => existing.name === c.name && existing.domain === c.domain && existing.path === c.path)) {
        allCookies.push(c);
      }
    }
  }
  return allCookies;
}

// Supprime tous les cookies SoundCloud
async function clearSoundcloudCookies() {
  const cookies = await getSoundcloudCookies();
  for (const cookie of cookies) {
    const cleanDomain = cookie.domain.startsWith(".") ? cookie.domain.substring(1) : cookie.domain;
    const url = `https://${cleanDomain}${cookie.path}`;
    await chrome.cookies.remove({ url: url, name: cookie.name });
  }
}

// Applique une liste de cookies
async function setSoundcloudCookies(cookies) {
  for (const cookie of cookies) {
    const cleanDomain = cookie.domain.startsWith(".") ? cookie.domain.substring(1) : cookie.domain;
    const url = `https://${cleanDomain}${cookie.path}`;

    const cookieDetails = {
      url: url,
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      secure: true,
      httpOnly: cookie.httpOnly
    };

    if (cookie.sameSite && cookie.sameSite !== "unspecified") {
      cookieDetails.sameSite = cookie.sameSite;
    }

    if (cookie.expirationDate) {
      cookieDetails.expirationDate = cookie.expirationDate;
    }

    try {
      await chrome.cookies.set(cookieDetails);
    } catch (e) {}
  }
}

// Sauvegarde manuelle d'un nouveau profil
async function handleManualSave(name) {
  const cookies = await getSoundcloudCookies();
  if (cookies.length === 0) {
    return { success: false, error: "Aucun cookie détecté" };
  }

  const data = await chrome.storage.local.get(["sc_accounts"]);
  const accounts = data.sc_accounts || {};

  accounts[name] = {
    name: name,
    cookies: cookies,
    savedAt: new Date().toISOString(),
    lastSynced: new Date().toISOString()
  };

  await chrome.storage.local.set({
    sc_accounts: accounts,
    sc_active_account: name
  });

  return { success: true };
}

// Bascule de compte avec protection d'auto-sync et rechargement propre
async function handleSwitchAccount(targetName) {
  isSwitching = true;

  try {
    const data = await chrome.storage.local.get(["sc_accounts", "sc_active_account"]);
    const accounts = data.sc_accounts || {};
    const currentActive = data.sc_active_account;

    // 1. Sauvegarder d'abord les cookies frais du compte actuel avant de partir
    if (currentActive && accounts[currentActive]) {
      const currentCookies = await getSoundcloudCookies();
      if (currentCookies.length > 0) {
        accounts[currentActive].cookies = currentCookies;
        accounts[currentActive].lastSynced = new Date().toISOString();
      }
    }

    const targetAccount = accounts[targetName];
    if (!targetAccount) {
      isSwitching = false;
      return;
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
    // Relâcher le verrou après 1.5s (temps que le navigateur charge la page)
    setTimeout(() => {
      isSwitching = false;
    }, 1500);
  }
}

// Déconnexion propre
async function handleCleanLogout() {
  isSwitching = true;
  await clearSoundcloudCookies();
  await chrome.storage.local.remove(["sc_active_account"]);

  const tabs = await chrome.tabs.query({ url: "*://*.soundcloud.com/*" });
  if (tabs.length > 0) {
    await chrome.tabs.update(tabs[0].id, { url: "https://soundcloud.com/discover", active: true });
  } else {
    await chrome.tabs.create({ url: "https://soundcloud.com/discover" });
  }

  setTimeout(() => {
    isSwitching = false;
  }, 1000);
}
