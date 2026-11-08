/**
 * PWA Icon Matcher - Safe Dynamic Icon Resolver
 *
 * Uses native St.IconTheme and semantic token heuristics.
 * NEVER initializes GTK or accesses display servers from within GNOME Shell.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { logger } from './logger.js';

const NOISE_WORDS = new Set([
    'web', 'app', 'online', 'desktop', 'client', 'pwa', 'official', 'player',
    'browser', 'viewer', 'dashboard', 'portal', 'home', 'site', 'page', 'for'
]);

const VENDOR_PREFIXES = new Set([
    'google', 'microsoft', 'ms', 'apple', 'gnome', 'kde', 'brave', 'mozilla'
]);

/**
 * Normalizes an application name into a clean, canonical string.
 *
 * @param {string} name
 * @returns {string}
 */
export function normalizeAppName(name) {
    if (!name || typeof name !== 'string') return '';

    return name
        .normalize('NFKD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .replace(/[\s_./+]+/gu, '-')
        .replace(/[^\p{L}\p{N}-]/gu, '')
        .replace(/-+/gu, '-')
        .replace(/^-+|-+$/gu, '');
}

/**
 * Extracts core semantic tokens from an app name, filtering out generic web suffixes.
 * E.g., "WhatsApp Web" -> ['whatsapp'], "YouTube Music" -> ['youtube', 'music']
 *
 * @param {string} appName
 * @returns {string[]}
 */
export function extractCoreTokens(appName) {
    if (!appName || typeof appName !== 'string') return [];

    const raw = appName
        .normalize('NFKD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, ' ')
        .trim()
        .split(/\s+/);

    const filtered = raw.filter(token => token.length > 0 && !NOISE_WORDS.has(token));
    return filtered.length > 0 ? filtered : raw;
}

export class IconResolver {
    /**
     * @param {object} [themeBackend] - St.IconTheme instance provided by GNOME Shell
     * @param {Gio.Settings} [settings] - Extension GSettings instance
     */
    constructor(themeBackend = null, settings = null) {
        this._themeBackend = themeBackend;
        this._settings = settings;
        this._interfaceSettings = null;
        this._cache = new Map();
    }

    setThemeBackend(backend) {
        this._themeBackend = backend;
        this._cache.clear();
    }

    clearCache() {
        this._cache.clear();
    }

    destroy() {
        this._cache.clear();
        this._themeBackend = null;
        this._settings = null;
        this._interfaceSettings = null;
    }

    /**
     * Checks whether an icon name exists in the active icon theme using St.IconTheme or Gtk.IconTheme.
     * Ensures the icon belongs to the user's active theme and not a generic hicolor fallback.
     * Safe to call inside GNOME Shell main loop.
     *
     * @param {string} iconName
     * @returns {boolean}
     */
    hasThemeIcon(iconName) {
        if (!iconName || !this._themeBackend) return false;

        try {
            if (typeof this._themeBackend.rescan_if_needed === 'function') {
                this._themeBackend.rescan_if_needed();
            }

            let filename = null;

            // 1. GTK4 Gtk.IconTheme (used in prefs dialog)
            // In GTK4, lookup_icon requires 6 arguments:
            // lookup_icon(icon_name, fallbacks, size, scale, direction, flags)
            if (
                typeof this._themeBackend.has_icon === 'function' &&
                typeof this._themeBackend.lookup_icon === 'function' &&
                this._themeBackend.lookup_icon.length >= 5
            ) {
                if (!this._themeBackend.has_icon(iconName)) return false;
                try {
                    const paintable = this._themeBackend.lookup_icon(iconName, null, 48, 1, 0, 0);
                    if (!paintable) return false;
                    const file = typeof paintable.get_file === 'function' ? paintable.get_file() : null;
                    filename = file ? file.get_path() : null;
                } catch {
                    return false;
                }
            }
            // 2. GNOME Shell native St.IconTheme
            else if (typeof this._themeBackend.lookup_icon === 'function') {
                const info = this._themeBackend.lookup_icon(iconName, 48, 0);
                if (!info) return false;
                filename = typeof info.get_filename === 'function' ? info.get_filename() : null;
            }
            // 3. Simple fallback or test mock (has_icon only)
            else if (typeof this._themeBackend.has_icon === 'function') {
                return Boolean(this._themeBackend.has_icon(iconName));
            }

            if (!filename) {
                return Boolean(typeof this._themeBackend.has_icon === 'function' && this._themeBackend.has_icon(iconName));
            }

            // Ensure the icon actually belongs to the active styled theme,
            // not a generic fallback in hicolor (unless the user explicitly selected the hicolor theme)
            if (filename.includes('/icons/hicolor/') || filename.includes('/hicolor/')) {
                const activeTheme = this._getActiveThemeName();
                if (activeTheme !== 'hicolor') {
                    return false;
                }
            }

            return true;
        } catch (err) {
            logger.error(`Error querying icon theme for "${iconName}"`, err);
            return false;
        }
    }

    _getActiveThemeName() {
        try {
            if (!this._interfaceSettings) {
                this._interfaceSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
            }
            return this._interfaceSettings.get_string('icon-theme') || '';
        } catch (_) {
            return '';
        }
    }

    /**
     * Generates ordered candidate icon names for an application.
     * Zero hardcoded dictionaries: derives candidates purely through semantic tokens
     * and standard Linux application packaging conventions.
     *
     * @param {string} appName
     * @param {string} [appId]
     * @returns {string[]} Ordered candidate icon names
     */
    getCandidates(appName, appId = '') {
        const candidates = [];
        const seen = new Set();

        const addCandidate = (cand) => {
            if (cand && !seen.has(cand)) {
                seen.add(cand);
                candidates.push(cand);
            }
        };

        // 1. Explicit user-defined icon alias from settings (if configured)
        if (this._settings) {
            try {
                const aliasesVar = this._settings.get_value('custom-aliases');
                const aliases = aliasesVar.deepUnpack ? aliasesVar.deepUnpack() : {};
                if (appName && aliases[appName]) {
                    addCandidate(aliases[appName]);
                }
                if (appId && aliases[appId]) {
                    addCandidate(aliases[appId]);
                }
            } catch (err) {
                logger.error('Error reading custom-aliases setting', err);
            }
        }

        // 2. Meaningful human-readable App ID (if provided)
        if (appId && typeof appId === 'string') {
            const normalizedAppId = normalizeAppName(appId);
            if (normalizedAppId && !/^[a-p]{32}$/.test(normalizedAppId) && !/^[0-9a-f]{32,}$/.test(normalizedAppId)) {
                addCandidate(normalizedAppId);
            }
        }

        // 3. Exact normalized desktop application name (e.g. "youtube-music", "claude")
        const normalized = normalizeAppName(appName);
        if (normalized) {
            addCandidate(normalized);
        }

        // 4. Core semantic brand tokens (e.g. "WhatsApp Web" -> "whatsapp")
        const coreTokens = extractCoreTokens(appName);
        if (coreTokens.length > 0) {
            const hyphenated = coreTokens.join('-');
            const flat = coreTokens.join('');
            addCandidate(hyphenated);
            addCandidate(flat);

            // Safe company/vendor namespace stripping (e.g. "Google Keep" -> "keep", "Google Gemini" -> "gemini")
            // Note: Does not apply to multi-word products like "YouTube Music" where youtube is part of the product name
            if (coreTokens.length > 1 && VENDOR_PREFIXES.has(coreTokens[0])) {
                const withoutVendor = coreTokens.slice(1).join('-');
                if (withoutVendor.length >= 3) {
                    addCandidate(withoutVendor);
                    addCandidate(coreTokens.slice(1).join(''));
                    addCandidate(`${withoutVendor}-desktop-app`);
                    addCandidate(`${withoutVendor}-desktop`);
                    addCandidate(`${withoutVendor}-app`);
                }
            }

            // 5. Common Linux desktop client suffixes (e.g. "youtube-music-desktop-app", "github-desktop")
            addCandidate(`${hyphenated}-desktop-app`);
            addCandidate(`${hyphenated}-desktop`);
            addCandidate(`${hyphenated}-app`);
            addCandidate(`${hyphenated}-client`);
        }

        // 6. Normalized variations without hyphens
        if (normalized && normalized.includes('-')) {
            const noHyphens = normalized.replace(/-/g, '');
            if (noHyphens.length >= 3) {
                addCandidate(noHyphens);
            }
            addCandidate(`${normalized}-desktop-app`);
            addCandidate(`${normalized}-desktop`);
            addCandidate(`${normalized}-app`);
        }

        return candidates;
    }

    /**
     * Resolves the best matching icon name present in the active icon theme.
     * Purely synchronous, completely non-blocking, and 100% safe inside GNOME Shell.
     *
     * @param {string} appName
     * @param {string} [appId]
     * @returns {Promise<string|null>}
     */
    async resolveIcon(appName, appId = '') {
        const cacheKey = `${appName}::${appId}`;
        if (this._cache.has(cacheKey)) {
            return this._cache.get(cacheKey);
        }

        const candidates = this.getCandidates(appName, appId);

        for (const candidate of candidates) {
            if (this.hasThemeIcon(candidate)) {
                logger.debug(`Resolved icon for "${appName}": ${candidate}`);
                this._cache.set(cacheKey, candidate);
                return candidate;
            }
        }

        logger.debug(`No active theme icon found for "${appName}" (candidates: ${candidates.join(', ')})`);
        this._cache.set(cacheKey, null);
        return null;
    }
}
