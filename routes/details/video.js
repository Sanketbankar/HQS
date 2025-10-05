const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');


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
 * @param {import('puppeteer').Page | import('puppeteer').Frame} context - The Puppeteer Page or Frame object.
 * @param {string} selector - The CSS selector for the video container (e.g., 'div#jwd').
 * @returns {Promise<Array<{ title: string, src: string }>>}
 */
async function extractSources(context, selector) {
    // Wait for the container selector to be visible (up to 60 seconds)
    await context.waitForSelector(selector, { visible: true, timeout: 1000 });

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
        if (!videoPath) return res.status(400).json({ status: 'error', message: 'Missing video path' });

        const videoUrl = `${BASE}/${videoPath}`;

        // ==========================================================
        // STEP 1: Launch Puppeteer with Stealth Mode
        // ==========================================================
        // Configure Chromium for serverless
        browser = await puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
        });

        const page = await browser.newPage();
        await page.goto(videoUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

        // ==========================================================
        // STEP 2: Scrape Dynamic Content (Video Sources)
        // ==========================================================
        try {
            // Attempt 1: Check in the main frame using the div#jwd selector
            sources = await extractSources(page, containerSelector);
            console.log(`✅ Sources found in main frame using ${containerSelector}.`);

        } catch (e) {
            console.log(`❌ Main frame selector failed: ${e.message}. Attempting iframe check.`);

            // Attempt 2: Check for a generic iframe and search inside it
            const iframeElement = await page.waitForSelector('iframe', { timeout: 10000 });

            if (iframeElement) {
                const frame = await iframeElement.contentFrame();

                if (frame) {
                    // Search inside the iframe's content frame
                    sources = await extractSources(frame, containerSelector);
                    console.log(`✅ Sources found inside iframe using ${containerSelector}.`);
                } else {
                    // This often happens due to cross-origin policies
                    throw new Error('Video container failed and could not access iframe content (likely cross-origin).');
                }
            } else {
                throw new Error('Video container failed and no iframe was found to check.');
            }
        }


        // ==========================================================
        // STEP 3: Scrape Static Content using Cheerio
        // Get the final rendered HTML for the rest of the elements
        // ==========================================================
        const htmlContent = await page.content();
        $ = cheerio.load(htmlContent);

        // 1️⃣ Video Title
        const videoTitle = $('header h1').text().trim();

        // Get meta info
        const metaUl = $('div.12u header ul');
        let uploadDate = null;
        let duration = null;
        let cast = [];

        if (metaUl.length) {
            const lis = metaUl.find('li');

            // 1️⃣ Upload Date
            if (lis.eq(0).length) {
                uploadDate = lis.eq(0).text().trim();
            }

            // 2️⃣ Duration
            if (lis.eq(1).length) {
                duration = lis.eq(1).text().trim();
            }


            // 3️⃣ Cast
            if (lis.eq(2).length) {
                lis.eq(2).find('a').each((i, aEl) => {
                    const $a = $(aEl);
                    const href = $a.attr('href') ? 'https://hqporner.com' + $a.attr('href') : null;
                    const id = extractIdFromUrl(href);
                    cast.push({
                        id,
                        name: $a.text().trim(),
                        href
                    });
                });
            }

        }

        const videoDetails = { videoTitle, uploadDate, duration, cast };

        const categories = [];

        const pageContent = $('div.box.page-content');
        if (pageContent.length) {
            const sections = pageContent.find('section');
            if (sections.length >= 3) {
                const thirdSection = sections.eq(2); // third section
                const sectionTitle = thirdSection.find('h3').text().trim();

                const categoryLinks = [];
                thirdSection.find('p a').each((i, aEl) => {
                    const $a = $(aEl);
                    const href = $a.attr('href') ? 'https://hqporner.com' + $a.attr('href') : null;
                    const id = extractIdFromUrl(href);
                    categoryLinks.push({
                        id,
                        text: $a.text().trim(),
                        href
                    });
                });

                categories.push({
                    sectionTitle,
                    links: categoryLinks
                });
            }
        }


        // 3️⃣ Sidebar (Scraping logic unchanged)
        const sidebarSections = [];
        $('div.sidebar section').each((i, section) => {
            const sectionTitle = $(section).find('h2').text().trim();
            const items = [];
            $(section).find('ul li').each((j, li) => {
                const h3 = $(li).find('h3');
                if (!h3.length) return;
                const href = $(li).find('a').attr('href') ? 'https://hqporner.com' + $(li).find('a').attr('href') : null;
                const id = extractIdFromUrl(href);
                const text = h3.text().trim();
                const meta = $(li).find('ul.meta li').map((k, mli) => $(mli).text().trim()).get();
                items.push({ text, id, href, meta });
            });
            if (items.length > 0) sidebarSections.push({ sectionTitle, items });
        });

        // 4️⃣ Main video grid (Scraping logic unchanged)
        const mainSections = [];
        $('div.row > div.12u > section').each((i, section) => {
            const sectionTitle = $(section).find('h2').first().text().trim();
            const videos = [];

            $(section).find('div.4u').each((j, div4u) => {
                const sec = $(div4u).find('section').first();
                if (!sec.length) return;
                const a = sec.find('a').first();
                if (!a.length) return;

                const href = a.attr('href') ? 'https://hqporner.com' + a.attr('href') : null;
                const id = extractIdFromUrl(href);

                const rawH3 = sec.find('div#span-case > h3').text().trim();
                const duration = sec.find('div#span-case > span').text().trim();
                const h3Text = rawH3.replace(/\w\S*/g, txt => txt.charAt(0).toUpperCase() + txt.slice(1));

                const img = a.find('img').first();
                const poster = img.length ? (img.attr('src').startsWith('//') ? 'https:' + img.attr('src') : img.attr('src')) : null;

                const preview = a.find('div.hide_noscript').map((k, hideDiv) => {
                    const match = ($(hideDiv).attr('onmouseover') || '').match(/"\/\/([^"]+\.jpg)"/);
                    return match?.[1] ? 'https://' + match[1] : null;
                }).get().filter(Boolean);

                videos.push({ title: h3Text, id, duration, link: href, poster, preview });
            });

            if (videos.length > 0) mainSections.push({ sectionTitle, videos });
        });

        // Similar links
        const similarLinks = [];
        $('div.12u').each((i, div12u) => {
            const ulActions = $(div12u).find('ul.actions');
            if (!ulActions.length) return;

            ulActions.find('li a').each((j, aEl) => {
                const $a = $(aEl);
                similarLinks.push({
                    text: $a.text().trim(),
                    href: $a.attr('href') ? 'https://hqporner.com' + $a.attr('href') : null
                });
            });
        });


        // ==========================================================
        // STEP 4: Return the result
        // ==========================================================
        return res.json({ status: 'success', videoDetails, sources, categories, sidebarSections, mainSections, similarLinks });

    } catch (err) {
        console.error('❌ Detail scraper error:', err.message);
        if (!res.headersSent) return res.status(500).json({ status: 'error', message: err.message });
    } finally {
        if (browser) {
            await browser.close();
        }
    }
});

module.exports = router;