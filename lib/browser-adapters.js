/**
 * PWA Icon Matcher - Browser Adapters
 *
 * Modular detection adapters for Chromium-based browsers, GNOME Web,
 * Firefox PWA tools, and generic PWA launchers.
 *
 * Each adapter verifies positive PWA signals so standard browser
 * desktop shortcuts are never misidentified as PWAs.
 */

import { parseExecArgs } from './desktop-entry.js';

/**
 * Base Browser Adapter
 */
export class BrowserAdapter {
    constructor(id, name, settingKey) {
        this.id = id;
        this.name = name;
        this.settingKey = settingKey;
    }

    /**
     * Inspects desktop entry metadata and filename.
     *
     * @param {object} desktopInfo - Parsed desktop entry
     * @param {string} filename - Basename of desktop file (e.g. brave-xyz-Default.desktop)
     * @returns {{ matched: boolean, appName: string, appId: string, browserId: string } | null}
     */
    match(desktopInfo, filename) {
        throw new Error('Adapter must implement match()');
    }

    _extractChromiumAppId(args) {
        for (let i = 0; i < args.length; i++) {
            const arg = args[i];
            if (arg.startsWith('--app-id=')) {
                return arg.substring('--app-id='.length);
            }
            if (arg.startsWith('--app=')) {
                return arg.substring('--app='.length);
            }
            if (arg.startsWith('--app-launch-url=')) {
                return arg.substring('--app-launch-url='.length);
            }
            if ((arg === '--app' || arg === '--app-id') && i + 1 < args.length) {
                return args[i + 1];
            }
        }
        return '';
    }

    _hasChromiumPwaSignals(desktopInfo, args) {
        const hasAppArg = args.some(a =>
            a.startsWith('--app-id=') ||
            a.startsWith('--app=') ||
            a.startsWith('--app-launch-url=') ||
            a === '--app' ||
            a === '--app-id'
        );

        const hasCrxWmClass = typeof desktopInfo.startupWmClass === 'string' &&
            desktopInfo.startupWmClass.startsWith('crx_');

        return hasAppArg || hasCrxWmClass;
    }
}

/**
 * Base class for Chromium-derived browsers
 */
class BaseChromiumAdapter extends BrowserAdapter {
    constructor(id, name, settingKey, binaryNames, filenamePrefixes) {
        super(id, name, settingKey);
        this.binaryNames = binaryNames;
        this.filenamePrefixes = filenamePrefixes;
    }

    match(desktopInfo, filename) {
        const args = parseExecArgs(desktopInfo.exec);
        if (args.length === 0) return null;

        // Matches binary name anywhere in non-flag arguments (supports wrappers like env or flatpak run)
        const matchesBinary = args.some(a =>
            !a.startsWith('-') && this.binaryNames.some(b => a.toLowerCase().includes(b))
        );
        const matchesFilename = this.filenamePrefixes.some(p => filename.toLowerCase().startsWith(p));

        if (!matchesBinary && !matchesFilename) {
            return null;
        }

        // Must have positive PWA signals
        if (!this._hasChromiumPwaSignals(desktopInfo, args)) {
            return null;
        }

        const appId = this._extractChromiumAppId(args);
        return {
            matched: true,
            browserId: this.id,
            browserName: this.name,
            appName: desktopInfo.name,
            appId
        };
    }
}

export class BraveAdapter extends BaseChromiumAdapter {
    constructor() {
        super('brave', 'Brave', 'browser-brave',
            ['brave', 'brave-browser', 'com.brave.browser'],
            ['brave-', 'com.brave.browser-']
        );
    }
}

export class ChromeAdapter extends BaseChromiumAdapter {
    constructor() {
        super('chrome', 'Google Chrome', 'browser-chrome',
            ['google-chrome', 'chrome', 'com.google.chrome'],
            ['chrome-', 'com.google.chrome-']
        );
    }
}

export class ChromiumAdapter extends BaseChromiumAdapter {
    constructor() {
        super('chromium', 'Chromium', 'browser-chromium',
            ['chromium', 'chromium-browser', 'ungoogled-chromium', 'org.chromium.chromium'],
            ['chromium-', 'ungoogled-chromium-', 'org.chromium.chromium-']
        );
    }
}

export class EdgeAdapter extends BaseChromiumAdapter {
    constructor() {
        super('edge', 'Microsoft Edge', 'browser-edge',
            ['msedge', 'microsoft-edge', 'com.microsoft.edge'],
            ['msedge-', 'microsoft-edge-', 'com.microsoft.edge-']
        );
    }
}

export class VivaldiAdapter extends BaseChromiumAdapter {
    constructor() {
        super('vivaldi', 'Vivaldi', 'browser-vivaldi',
            ['vivaldi', 'vivaldi-stable', 'com.vivaldi.vivaldi'],
            ['vivaldi-', 'com.vivaldi.vivaldi-']
        );
    }
}

export class OperaAdapter extends BaseChromiumAdapter {
    constructor() {
        super('opera', 'Opera', 'browser-opera',
            ['opera', 'opera-stable', 'com.opera.opera'],
            ['opera-', 'com.opera.opera-']
        );
    }
}

export class EpiphanyAdapter extends BrowserAdapter {
    constructor() {
        super('epiphany', 'GNOME Web (Epiphany)', 'browser-epiphany');
    }

    match(desktopInfo, filename) {
        const lowerFilename = filename.toLowerCase();
        const matchesFilename = lowerFilename.startsWith('org.gnome.epiphany.webapp-') ||
                                lowerFilename.startsWith('epiphany-');

        const args = parseExecArgs(desktopInfo.exec);
        if (args.length === 0) return null;

        const matchesBinary = args.some(a =>
            !a.startsWith('-') && (a.toLowerCase().includes('epiphany') || a.toLowerCase().includes('org.gnome.epiphany'))
        );

        const hasAppMode = args.some(a =>
            a.startsWith('--application-mode') ||
            a === '-a'
        );

        const hasWebappWmClass = typeof desktopInfo.startupWmClass === 'string' &&
            (desktopInfo.startupWmClass.startsWith('epiphany-') ||
             desktopInfo.startupWmClass.startsWith('org.gnome.Epiphany.WebApp-'));

        if ((matchesBinary || matchesFilename) && (hasAppMode || hasWebappWmClass || matchesFilename)) {
            // Extract app id if available from args or filename
            let appId = '';
            for (const arg of args) {
                if (arg.startsWith('--application-mode=')) {
                    appId = arg.substring('--application-mode='.length);
                }
            }
            return {
                matched: true,
                browserId: this.id,
                browserName: this.name,
                appName: desktopInfo.name,
                appId
            };
        }

        return null;
    }
}

export class FirefoxPWAAdapter extends BrowserAdapter {
    constructor() {
        super('firefox-pwa', 'Firefox PWA tools', 'browser-firefox-pwa');
    }

    match(desktopInfo, filename) {
        const lowerFilename = filename.toLowerCase();
        const matchesFilename = lowerFilename.startsWith('ffpwa-');

        const args = parseExecArgs(desktopInfo.exec);
        if (args.length === 0) return null;

        const matchesBinary = args.some(a =>
            !a.startsWith('-') && a.toLowerCase().includes('firefoxpwa')
        );

        const isSiteRun = args.includes('site') && args.includes('run');

        if ((matchesBinary || matchesFilename) && (isSiteRun || matchesFilename)) {
            const siteIdx = args.indexOf('run');
            const appId = siteIdx !== -1 && args[siteIdx + 1] ? args[siteIdx + 1] : '';
            return {
                matched: true,
                browserId: this.id,
                browserName: this.name,
                appName: desktopInfo.name,
                appId
            };
        }

        return null;
    }
}

export class GenericPWAAdapter extends BrowserAdapter {
    constructor() {
        super('generic', 'Generic PWA', 'browser-generic');
    }

    match(desktopInfo, filename) {
        const args = parseExecArgs(desktopInfo.exec);
        if (args.length === 0) return null;

        // Requires unambiguous positive PWA markers
        if (this._hasChromiumPwaSignals(desktopInfo, args)) {
            const appId = this._extractChromiumAppId(args);
            return {
                matched: true,
                browserId: this.id,
                browserName: this.name,
                appName: desktopInfo.name,
                appId
            };
        }

        return null;
    }
}

/**
 * Returns default list of all browser adapters.
 */
export function createDefaultAdapters() {
    return [
        new BraveAdapter(),
        new ChromeAdapter(),
        new ChromiumAdapter(),
        new EdgeAdapter(),
        new VivaldiAdapter(),
        new OperaAdapter(),
        new EpiphanyAdapter(),
        new FirefoxPWAAdapter(),
        new GenericPWAAdapter()
    ];
}
