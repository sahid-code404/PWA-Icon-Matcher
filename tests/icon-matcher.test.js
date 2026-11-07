/**
 * PWA Icon Matcher - Icon Resolver & Matcher Tests
 */

import { normalizeAppName, IconResolver } from '../lib/icon-resolver.js';

class MockIconTheme {
    constructor(availableIcons = []) {
        this._icons = new Set(availableIcons);
    }

    has_icon(name) {
        return this._icons.has(name);
    }
}

export async function runIconMatcherTests(assert) {
    // 1. Name normalization tests
    assert.equal(normalizeAppName('Claude'), 'claude', 'Claude normalizes to claude');
    assert.equal(normalizeAppName('WhatsApp Web'), 'whatsapp-web', 'WhatsApp Web normalizes to whatsapp-web');
    assert.equal(normalizeAppName('Google Drive'), 'google-drive', 'Google Drive normalizes to google-drive');
    assert.equal(normalizeAppName('Microsoft Teams'), 'microsoft-teams', 'Microsoft Teams normalizes to microsoft-teams');
    assert.equal(normalizeAppName('YouTube Music'), 'youtube-music', 'YouTube Music normalizes to youtube-music');
    assert.equal(normalizeAppName('ChatGPT'), 'chatgpt', 'ChatGPT normalizes to chatgpt');
    assert.equal(normalizeAppName('Reddit'), 'reddit', 'Reddit normalizes to reddit');

    // 2. Candidate generation and safety rule 5.2
    const mockTheme = new MockIconTheme(['claude', 'youtube', 'whatsapp', 'spotify']);
    const resolver = new IconResolver(mockTheme);

    const candidatesYtMusic = resolver.getCandidates('YouTube Music');
    assert.ok(candidatesYtMusic.includes('youtube-music'), 'Candidates include youtube-music');
    assert.ok(!candidatesYtMusic.includes('youtube'), 'Candidates DO NOT truncate multi-word YouTube Music to youtube');

    // 3. Fallback for Web suffix when exact isn't in theme
    const candidatesWa = resolver.getCandidates('WhatsApp Web');
    assert.ok(candidatesWa.includes('whatsapp-web'), 'Includes exact normalized whatsapp-web');
    assert.ok(candidatesWa.includes('whatsapp'), 'Includes recognized web fallback whatsapp');

    // 4. Resolution against theme
    const resolvedClaude = await resolver.resolveIcon('Claude');
    assert.equal(resolvedClaude, 'claude', 'Resolves Claude to theme icon claude');

    const resolvedWa = await resolver.resolveIcon('WhatsApp Web');
    assert.equal(resolvedWa, 'whatsapp', 'Resolves WhatsApp Web to theme icon whatsapp via fallback');

    // 5. Unavailable icon handling (Test 6)
    const resolvedUnknown = await resolver.resolveIcon('ObscureNonExistentApp12345');
    assert.equal(resolvedUnknown, null, 'Returns null when icon is not present in theme');

    // 6. Custom alias override
    const mockSettings = {
        get_value: (key) => {
            if (key === 'custom-aliases') {
                return {
                    deepUnpack: () => ({ 'Claude': 'my-custom-claude-icon' })
                };
            }
            return null;
        }
    };
    const mockThemeWithCustom = new MockIconTheme(['my-custom-claude-icon', 'claude']);
    const resolverWithAlias = new IconResolver(mockThemeWithCustom, mockSettings);

    const resolvedCustom = await resolverWithAlias.resolveIcon('Claude');
    assert.equal(resolvedCustom, 'my-custom-claude-icon', 'Custom alias takes top priority');
}
