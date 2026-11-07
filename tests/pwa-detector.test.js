/**
 * PWA Icon Matcher - PWA Detector Tests
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { PwaDetector } from '../lib/pwa-detector.js';

function readFixture(name) {
    const path = GLib.build_filenamev([GLib.get_current_dir(), 'tests', 'fixtures', name]);
    const file = Gio.File.new_for_path(path);
    const [ok, bytes] = file.load_contents(null);
    if (!ok) throw new Error(`Fixture not found: ${name}`);
    return new TextDecoder('utf-8').decode(bytes);
}

export function runPwaDetectorTests(assert) {
    const detector = new PwaDetector(null);

    // 1. Brave Claude PWA
    const braveClaude = readFixture('brave-claude.desktop');
    const resClaude = detector.detect(braveClaude, 'brave-fmpnliohjhemenmnlpbfagaolkdacoja-Default.desktop');
    assert.ok(resClaude.isPwa, 'Brave Claude is recognized as PWA');
    assert.equal(resClaude.browserId, 'brave', 'Browser identified as Brave');
    assert.equal(resClaude.appName, 'Claude', 'App name extracted as Claude');
    assert.equal(resClaude.appId, 'fmpnliohjhemenmnlpbfagaolkdacoja', 'App ID extracted');

    // 2. Brave YouTube PWA
    const braveYoutube = readFixture('brave-youtube.desktop');
    const resYoutube = detector.detect(braveYoutube, 'brave-agimnkijcaahngcdmfeangaknmldooml-Default.desktop');
    assert.ok(resYoutube.isPwa, 'Brave YouTube is recognized as PWA');
    assert.equal(resYoutube.browserId, 'brave', 'Browser identified as Brave');

    // 3. Chrome Spotify PWA
    const chromeSpotify = readFixture('chrome-spotify.desktop');
    const resSpotify = detector.detect(chromeSpotify, 'chrome-pjkljhegncpnkpknbcohdijeoejaedia-Default.desktop');
    assert.ok(resSpotify.isPwa, 'Chrome Spotify recognized as PWA');
    assert.equal(resSpotify.browserId, 'chrome', 'Browser identified as Chrome');
    assert.equal(resSpotify.appName, 'Spotify', 'App name extracted as Spotify');

    // 4. Edge Teams PWA
    const edgeTeams = readFixture('msedge-teams.desktop');
    const resTeams = detector.detect(edgeTeams, 'msedge-cgeadknapnnfllhkkhacmkchgcmigbde-Default.desktop');
    assert.ok(resTeams.isPwa, 'Edge Teams recognized as PWA');
    assert.equal(resTeams.browserId, 'edge', 'Browser identified as Edge');

    // 5. Vivaldi Notion PWA
    const vivaldiNotion = readFixture('vivaldi-notion.desktop');
    const resNotion = detector.detect(vivaldiNotion, 'vivaldi-bhehhkgiafopldgnofckbijnkcfkdfgd-Default.desktop');
    assert.ok(resNotion.isPwa, 'Vivaldi Notion recognized as PWA');
    assert.equal(resNotion.browserId, 'vivaldi', 'Browser identified as Vivaldi');

    // 6. Epiphany Web App
    const epiphanyApp = readFixture('epiphany-webapp.desktop');
    const resEpiphany = detector.detect(epiphanyApp, 'org.gnome.Epiphany.WebApp-discourse_1234.desktop');
    assert.ok(resEpiphany.isPwa, 'Epiphany Web App recognized as PWA');
    assert.equal(resEpiphany.browserId, 'epiphany', 'Browser identified as Epiphany');

    // 7. Firefox PWA tools
    const ffpwa = readFixture('firefox-pwa.desktop');
    const resFf = detector.detect(ffpwa, 'ffpwa-01HQ5678ABCD.desktop');
    assert.ok(resFf.isPwa, 'Firefox PWA recognized as PWA');
    assert.equal(resFf.browserId, 'firefox-pwa', 'Browser identified as Firefox PWA');

    // 8. Flatpak Brave PWA
    const flatpakBrave = `[Desktop Entry]
Type=Application
Name=Claude Flatpak
Exec=/usr/bin/flatpak run com.brave.Browser --app-id=flatpak123
Icon=/home/user/.local/share/icons/hicolor/256x256/apps/com.brave.Browser-flatpak123.png
StartupWMClass=crx_flatpak123
`;
    const resFlatpak = detector.detect(flatpakBrave, 'com.brave.Browser-flatpak123.desktop');
    assert.ok(resFlatpak.isPwa, 'Flatpak Brave launcher recognized as PWA');
    assert.equal(resFlatpak.browserId, 'brave', 'Flatpak Brave identified as Brave');

    // 9. Non-PWA browser launcher MUST BE REJECTED
    const regularBrowser = readFixture('brave-standard-browser.desktop');
    const resRegBrowser = detector.detect(regularBrowser, 'brave-browser.desktop');
    assert.ok(!resRegBrowser.isPwa, 'Standard Brave browser launcher is NOT considered a PWA');

    // 10. Standard non-browser app MUST BE REJECTED
    const regularApp = readFixture('regular-app.desktop');
    const resRegApp = detector.detect(regularApp, 'gimp.desktop');
    assert.ok(!resRegApp.isPwa, 'Standard desktop application (GIMP) is NOT considered a PWA');
}
