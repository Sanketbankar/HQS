

const express = require('express');
const cheerio = require('cheerio');
const axios = require('axios');

let chromium, puppeteer;

try {
    if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
        chromium = require('@sparticuz/chromium');
        puppeteer = require('puppeteer-core');
    } else {
        puppeteer = require('puppeteer');
    }

// Try to extract sources from raw HTML without a browser
function extractSourcesFromHtml(html) {
    const $ = cheerio.load(html);
    const results = [];
    // Direct <video><source> tags inside container
    const videoEl = $('div#jwd video').first();
    if (videoEl.length) {
        videoEl.find('source').each((_, el) => {
            const title = $(el).attr('title') || '';
            const src = $(el).attr('src') || '';
            if (src) results.push({ title, src });
        });
    }

    // Common JS patterns (jwplayer/setup, sources:[], file:, src:)
    if (results.length === 0) {
        const patterns = [
            /sources\s*:\s*\[(.*?)\]/is,
            /file\s*:\s*['"]([^'"\s]+)['"]/ig,
            /src\s*:\s*['"]([^'"\s]+)['"]/ig
        ];
        const text = $.root().html() || '';
        for (const re of patterns) {
            let m;
            if (re.flags.includes('g')) {
                while ((m = re.exec(text)) !== null) {
                    const url = m[1];
                    if (url && /\.(m3u8|mp4|mkv)(\?|$)/i.test(url)) {
                        results.push({ title: '', src: url });
                    }
                }
            } else {
                m = re.exec(text);
                if (m && m[1]) {
                    // Attempt to parse JSON array of sources
                    try {
                        const arrText = m[1];
                        const fileRe = /file\s*:\s*['"]([^'"\s]+)['"]/ig;
                        let fm;
                        while ((fm = fileRe.exec(arrText)) !== null) {
                            const url = fm[1];
                            if (url) results.push({ title: '', src: url });
                        }
                    } catch {}
                }
            }
        }
    }

    // If an iframe exists, return its src for caller to fetch
    const iframe = $('iframe').first();
    const iframeSrc = iframe.attr('src') || null;
    return { results, iframeSrc };
}
} catch (error) {
    console.error('Error loading puppeteer:', error);
    throw error;
}

const router = express.Router();
const BASE = 'https://hqporner.com/hdporn';

function extractIdFromUrl(url) {
    if (!url) return null;
    const parts = url.split('/');
    const lastPart = parts.pop() || parts.pop();
    return lastPart || null;
}

/**
 * Core scraping logic to extract video sources, supporting iframes.
 * @param {import('puppeteer-core').Page | import('puppeteer-core').Frame} context - The Puppeteer Page or Frame object.
 * @param {string} selector - The CSS selector for the video container (e.g., 'div#jwd').
 * @returns {Promise<Array<{ title: string, src: string }>>}
 */
async function extractSources(context, selector) {
    // Wait for the container selector to be visible (up to 10 seconds)
    await context.waitForSelector(selector, { visible: true, timeout: 10000 });

    const sources = await context.evaluate((sel) => {
        const sourceArray = [];
        // Find the video element inside the specified container
        const videoContainer = document.querySelector(sel);
        // Look for any video tag inside the container
        const videoElement = videoContainer ? videoContainer.querySelector('video') : null;

        if (videoElement) {
            // Check all child <source> elements
            videoElement.querySelectorAll('source').forEach(srcEl => {
                const title = srcEl.getAttribute('title') || '';
                // Use .src property to get the absolute URL
                const src = srcEl.src || srcEl.getAttribute('src') || '';
                if (src) sourceArray.push({ title, src });
            });
        }
        return sourceArray;
    }, selector);

    return sources;
}

router.get(/\/(.*)/, async (req, res) => {
    let browser;
    let sources = [];
    let $;
    const containerSelector = 'div#jwd';

    try {
        const videoPath = req.params[0];
        if (!videoPath) {
            return res.status(400).json({ 
                status: 'error', 
                message: 'Missing video path' 
            });
        }

        const videoUrl = `${BASE}/${videoPath}`;

        // STEP 1: Browserless-first approach
        // 1) Try static fetch + iframe follow without a browser
        let html = '';
        try {
            const resp = await axios.get(videoUrl, {
                timeout: 20000,
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36' }
            });
            html = resp.data;
        } catch (e) {
            console.log('⚠️ Initial fetch failed, will try browserless if configured:', e.message);
        }

        if (html) {
            const { results, iframeSrc } = extractSourcesFromHtml(html);
            if (results.length) {
                sources = results;
            } else if (iframeSrc) {
                try {
                    const iframeUrl = iframeSrc.startsWith('http') ? iframeSrc : (iframeSrc.startsWith('//') ? 'https:' + iframeSrc : new URL(iframeSrc, videoUrl).toString());
                    const iframeResp = await axios.get(iframeUrl, { timeout: 20000, headers: { 'User-Agent': 'Mozilla/5.0' } });
                    const iframeParsed = extractSourcesFromHtml(iframeResp.data);
                    if (iframeParsed.results.length) sources = iframeParsed.results;
                } catch (e) {
                    console.log('⚠️ Iframe fetch failed:', e.message);
                }
            }
        }

        // 2) If still no sources and Browserless endpoint provided, connect without launching local Chromium
        let page;
        if (!sources.length && process.env.BROWSERLESS_WS_URL) {
            console.log('🔌 Connecting to Browserless via WebSocket...');
            const browserless = await puppeteer.connect({ browserWSEndpoint: process.env.BROWSERLESS_WS_URL });
            browser = browserless;
            page = await browser.newPage();
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');
            await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
            await page.goto(videoUrl, { waitUntil: 'networkidle2', timeout: 60000 });
            try {
                sources = await extractSources(page, containerSelector);
            } catch {}
        }

        // 3) As a final fallback (local dev only), launch Puppeteer locally
        if (!sources.length && !(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME)) {
            console.log('💻 Fallback: launching local Puppeteer...');
            browser = await puppeteer.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox'],
            });
            page = await browser.newPage();
            await page.goto(videoUrl, { waitUntil: 'networkidle2', timeout: 60000 });
            try {
                sources = await extractSources(page, containerSelector);
            } catch {}
        }

        // ==========================================================
        // STEP 2: Scrape Dynamic Content (Video Sources) when a page exists
        // ==========================================================
        if (!sources.length && page) {
            try {
                // Attempt 1: Check in the main frame using the div#jwd selector
                sources = await extractSources(page, containerSelector);
                console.log(`✅ Sources found in main frame using ${containerSelector}.`);

            } catch (e) {
                console.log(`❌ Main frame selector failed: ${e.message}. Attempting iframe check.`);

                // Attempt 2: Check for a generic iframe and search inside it
                try {
                    const iframeElement = await page.waitForSelector('iframe', { timeout: 10000 });

                    if (iframeElement) {
                        const frame = await iframeElement.contentFrame();

                        if (frame) {
                            // Search inside the iframe's content frame
                            sources = await extractSources(frame, containerSelector);
                            console.log(`✅ Sources found inside iframe using ${containerSelector}.`);
                        } else {
                            throw new Error('Video container failed and could not access iframe content (likely cross-origin).');
                        }
                    } else {
                        throw new Error('Video container failed and no iframe was found to check.');
                    }
                } catch (iframeError) {
                    console.log(`⚠️  Could not extract sources from iframe: ${iframeError.message}`);
                    // Continue anyway - sources will be empty
                }
            }
        }

        // ==========================================================
        // STEP 3: Scrape Static Content using Cheerio
        // ==========================================================
        console.log('📄 Extracting static content...');
        let htmlContent = '';
        if (page) {
            try {
                htmlContent = await page.content();
            } catch {}
        }
        if (!htmlContent) {
            // Fallback to prior fetched HTML if available; otherwise refetch
            if (!html) {
                try {
                    const resp2 = await axios.get(videoUrl, { timeout: 20000, headers: { 'User-Agent': 'Mozilla/5.0' } });
                    htmlContent = resp2.data;
                } catch {}
            } else {
                htmlContent = html;
            }
        }
        $ = cheerio.load(htmlContent || '<html></html>');

        // 1️⃣ Video Title
        const videoTitle = $('header h1').text().trim();

        // Get meta info
        const metaUl = $('div.12u header ul');
        let uploadDate = null;
        let duration = null;
        let cast = [];

        if (metaUl.length) {
            const lis = metaUl.find('li');

            // Upload Date
            if (lis.eq(0).length) {
                uploadDate = lis.eq(0).text().trim();
            }

            // Duration
            if (lis.eq(1).length) {
                duration = lis.eq(1).text().trim();
            }

            // Cast
            if (lis.eq(2).length) {
                lis.eq(2).find('a').each((i, aEl) => {
                    const $a = $(aEl);
                    cast.push({
                        name: $a.text().trim(),
                        href: $a.attr('href') ? 'https://hqporner.com' + $a.attr('href') : null
                    });
                });
            }
        }

        const videoDetails = { videoTitle, uploadDate, duration, cast };

        // Categories
        const categories = [];
        const pageContent = $('div.box.page-content');
        
        if (pageContent.length) {
            const sections = pageContent.find('section');
            if (sections.length >= 3) {
                const thirdSection = sections.eq(2);
                const sectionTitle = thirdSection.find('h3').text().trim();

                const categoryLinks = [];
                thirdSection.find('p a').each((i, aEl) => {
                    const $a = $(aEl);
                    categoryLinks.push({
                        text: $a.text().trim(),
                        href: $a.attr('href') ? 'https://hqporner.com' + $a.attr('href') : null
                    });
                });

                categories.push({
                    sectionTitle,
                    links: categoryLinks
                });
            }
        }

        // 2️⃣ Sidebar
        const sidebarSections = [];
        $('div.sidebar section').each((i, section) => {
            const sectionTitle = $(section).find('h2').text().trim();
            const items = [];
            
            $(section).find('ul li').each((j, li) => {
                const h3 = $(li).find('h3');
                if (!h3.length) return;
                
                const href = $(li).find('a').attr('href') 
                    ? 'https://hqporner.com' + $(li).find('a').attr('href') 
                    : null;
                const id = extractIdFromUrl(href);
                const text = h3.text().trim();
                const meta = $(li).find('ul.meta li')
                    .map((k, mli) => $(mli).text().trim())
                    .get();
                
                items.push({ text, id, href, meta });
            });
            
            if (items.length > 0) {
                sidebarSections.push({ sectionTitle, items });
            }
        });

        // 3️⃣ Main video grid
        const mainSections = [];
        $('div.row > div.12u > section').each((i, section) => {
            const sectionTitle = $(section).find('h2').first().text().trim();
            const videos = [];

            $(section).find('div.4u').each((j, div4u) => {
                const sec = $(div4u).find('section').first();
                if (!sec.length) return;
                
                const a = sec.find('a').first();
                if (!a.length) return;

                const href = a.attr('href') 
                    ? 'https://hqporner.com' + a.attr('href') 
                    : null;
                const id = extractIdFromUrl(href);

                const rawH3 = sec.find('div#span-case > h3').text().trim();
                const duration = sec.find('div#span-case > span').text().trim();
                const h3Text = rawH3.replace(/\w\S*/g, txt => 
                    txt.charAt(0).toUpperCase() + txt.slice(1)
                );

                const img = a.find('img').first();
                const poster = img.length 
                    ? (img.attr('src').startsWith('//') 
                        ? 'https:' + img.attr('src') 
                        : img.attr('src')) 
                    : null;

                const preview = a.find('div.hide_noscript')
                    .map((k, hideDiv) => {
                        const match = ($(hideDiv).attr('onmouseover') || '')
                            .match(/"\/\/([^"]+\.jpg)"/);
                        return match?.[1] ? 'https://' + match[1] : null;
                    })
                    .get()
                    .filter(Boolean);

                videos.push({ 
                    title: h3Text, 
                    id, 
                    duration, 
                    link: href, 
                    poster, 
                    preview 
                });
            });

            if (videos.length > 0) {
                mainSections.push({ sectionTitle, videos });
            }
        });

        // 4️⃣ Similar links
        const similarLinks = [];
        $('div.12u').each((i, div12u) => {
            const ulActions = $(div12u).find('ul.actions');
            if (!ulActions.length) return;

            ulActions.find('li a').each((j, aEl) => {
                const $a = $(aEl);
                similarLinks.push({
                    text: $a.text().trim(),
                    href: $a.attr('href') 
                        ? 'https://hqporner.com' + $a.attr('href') 
                        : null
                });
            });
        });

        // ==========================================================
        // STEP 4: Return the result
        // ==========================================================
        console.log('✅ Scraping completed successfully');
        
        return res.json({ 
            status: 'success', 
            videoDetails, 
            sources, 
            categories, 
            sidebarSections, 
            mainSections, 
            similarLinks 
        });

    } catch (err) {
        console.error('❌ Detail scraper error:', err.message);
        console.error('Stack trace:', err.stack);
        
        if (!res.headersSent) {
            return res.status(500).json({ 
                status: 'error', 
                message: err.message,
                stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
            });
        }
    } finally {
        if (browser) {
            console.log('🔒 Closing browser...');
            await browser.close();
        }
    }
});

module.exports = router;