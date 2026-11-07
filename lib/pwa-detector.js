/**
 * PWA Icon Matcher - Universal PWA Detector
 *
 * Automatically identifies any Progressive Web App or Web App launcher
 * across all browsers without requiring browser-specific toggles or configuration.
 */

import { parseDesktopEntry, parseExecArgs } from './desktop-entry.js';
import { logger } from './logger.js';

export class PwaDetector {
    constructor(settings = null) {
        this._settings = settings;
    }

    /**
     * Automatically identifies if a desktop entry is a PWA or web app.
     *
     * @param {string|object} contentOrParsed - Raw string or already parsed desktop entry
     * @param {string} filename - Filename of desktop entry
     * @returns {{
     *   isPwa: boolean,
     *   browserId?: string,
     *   appName?: string,
     *   appId?: string,
     *   originalIcon?: string
     * }}
     */
    detect(contentOrParsed, filename = '') {
        const parsed = typeof contentOrParsed === 'string'
            ? parseDesktopEntry(contentOrParsed)
            : contentOrParsed;

        if (!parsed || !parsed.isValid) {
            return { isPwa: false };
        }

        // Must be an Application
        if (parsed.type && parsed.type !== 'Application') {
            return { isPwa: false };
        }

        if (!parsed.name || !parsed.exec) {
            return { isPwa: false };
        }

        const args = parseExecArgs(parsed.exec);
        const lowerFilename = (filename || '').toLowerCase();
        const wmClass = (parsed.startupWmClass || '').toLowerCase();
        const icon = (parsed.icon || '');
        const execLower = parsed.exec.toLowerCase();

        let isPwa = false;
        let appId = '';

        // 1. Positive PWA flags in command line arguments
        for (let i = 0; i < args.length; i++) {
            const arg = args[i];
            if (arg.startsWith('--app-id=')) {
                appId = arg.substring('--app-id='.length);
                isPwa = true;
                break;
            }
            if (arg.startsWith('--app=')) {
                appId = arg.substring('--app='.length);
                isPwa = true;
                break;
            }
            if (arg.startsWith('--app-launch-url=')) {
                isPwa = true;
                break;
            }
            if ((arg === '--app' || arg === '--app-id') && i + 1 < args.length) {
                appId = args[i + 1];
                isPwa = true;
                break;
            }
            if (arg.startsWith('--application-mode=') || arg.startsWith('--app-profile=')) {
                isPwa = true;
                break;
            }
            if (arg === 'firefoxpwa' && i + 2 < args.length && args[i + 1] === 'site' && args[i + 2] === 'run') {
                appId = args[i + 3] || '';
                isPwa = true;
                break;
            }
        }

        // 2. Positive PWA WM_CLASS signals
        if (!isPwa) {
            if (
                wmClass.startsWith('crx_') ||
                wmClass.startsWith('webapp-') ||
                wmClass.startsWith('ffpwa-') ||
                wmClass.startsWith('epiphany-')
            ) {
                isPwa = true;
                if (wmClass.startsWith('ffpwa-')) {
                    appId = wmClass.substring('ffpwa-'.length);
                }
            }
        }

        // 3. Positive browser-generated PWA filename or icon path signals
        if (!isPwa) {
            const hasBrowserPrefix = /^(brave|chrome|chromium|msedge|opera|vivaldi|ffpwa|epiphany)[-_]/.test(lowerFilename);
            const hasHashPattern = /-[a-p0-9]{32}/.test(lowerFilename);
            const hasPwaIconPath = icon.includes('/hicolor/') && (
                icon.includes('chrome-') ||
                icon.includes('brave-') ||
                icon.includes('chromium-') ||
                icon.includes('msedge-') ||
                /-[a-p0-9]{32}/.test(icon)
            );

            if ((hasBrowserPrefix && hasHashPattern) || hasPwaIconPath) {
                isPwa = true;
            }
        }

        if (isPwa) {
            // Identify originating browser family
            let browserId = 'generic';
            if (execLower.includes('brave') || lowerFilename.includes('brave')) {
                browserId = 'brave';
            } else if (execLower.includes('google-chrome') || execLower.includes('chrome') || lowerFilename.includes('chrome')) {
                browserId = 'chrome';
            } else if (execLower.includes('chromium') || lowerFilename.includes('chromium')) {
                browserId = 'chromium';
            } else if (execLower.includes('msedge') || execLower.includes('edge') || lowerFilename.includes('msedge')) {
                browserId = 'edge';
            } else if (execLower.includes('vivaldi') || lowerFilename.includes('vivaldi')) {
                browserId = 'vivaldi';
            } else if (execLower.includes('opera') || lowerFilename.includes('opera')) {
                browserId = 'opera';
            } else if (execLower.includes('epiphany') || lowerFilename.includes('epiphany')) {
                browserId = 'epiphany';
            } else if (execLower.includes('firefoxpwa') || lowerFilename.includes('ffpwa') || wmClass.startsWith('ffpwa-')) {
                browserId = 'firefox-pwa';
            }

            logger.debug(`Auto-identified PWA launcher: "${parsed.name}" (${filename})`);
            return {
                isPwa: true,
                browserId,
                appName: parsed.name,
                appId: appId || '',
                originalIcon: parsed.icon
            };
        }

        return { isPwa: false };
    }
}
